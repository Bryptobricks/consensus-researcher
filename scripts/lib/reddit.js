#!/usr/bin/env node
'use strict';

/**
 * Reddit resilience layer — multi-strategy fetching with local caching.
 *
 * Strategy chain:
 *   1. JSON endpoint (reddit.com/r/{sub}/comments/{id}/.json)
 *   2. Old Reddit HTML parsing (old.reddit.com — simpler DOM)
 *   3. Generic web_fetch with text extraction
 *
 * Caches successful fetches in data/reddit-cache/ (7-day TTL for active, indefinite for saved).
 * Tracks health in data/reddit-health.json.
 */

const { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } = require('fs');
const { join, dirname, resolve } = require('path');
const crypto = require('crypto');

const REDDIT_UA = 'ConsensusResearch/5.0';
const MAX_COMMENT_LENGTH = 1000;
const CACHE_DIR = resolve(process.cwd(), 'data/reddit-cache');
const HEALTH_PATH = resolve(process.cwd(), 'data/reddit-health.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let lastRedditCall = 0;
const apiCalls = { json: 0, oldReddit: 0, webFetch: 0, cacheHits: 0, total: 0 };

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  process.stderr.write(`[reddit] ${msg}\n`);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function truncate(str, max) {
  if (!str) return '';
  return str.length <= max ? str : `${str.slice(0, max)}...`;
}

function cleanupText(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

// --- Cache ---

function cacheKeyForUrl(url) {
  return crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
}

function cacheGet(url) {
  const key = cacheKeyForUrl(url);
  const file = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(file)) return null;

  try {
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    apiCalls.cacheHits++;
    return entry;
  } catch {
    return null;
  }
}

function cacheSet(url, data) {
  ensureDir(CACHE_DIR);
  const key = cacheKeyForUrl(url);
  const file = join(CACHE_DIR, `${key}.json`);
  const entry = {
    url,
    fetchedAt: new Date().toISOString(),
    ...data
  };
  writeFileSync(file, JSON.stringify(entry), 'utf8');
}

function cachePrune() {
  if (!existsSync(CACHE_DIR)) return 0;
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  let pruned = 0;
  for (const file of files) {
    const filePath = join(CACHE_DIR, file);
    try {
      const entry = JSON.parse(readFileSync(filePath, 'utf8'));
      const age = Date.now() - new Date(entry.fetchedAt).getTime();
      if (age > CACHE_TTL_MS) {
        unlinkSync(filePath);
        pruned++;
      }
    } catch {
      unlinkSync(filePath);
      pruned++;
    }
  }
  return pruned;
}

// --- Health tracking ---

function loadHealth() {
  if (!existsSync(HEALTH_PATH)) {
    return { status: 'unknown', failures: [], lastSuccess: null, strategyStats: {} };
  }
  try {
    return JSON.parse(readFileSync(HEALTH_PATH, 'utf8'));
  } catch {
    return { status: 'unknown', failures: [], lastSuccess: null, strategyStats: {} };
  }
}

function saveHealth(health) {
  ensureDir(dirname(HEALTH_PATH));
  writeFileSync(HEALTH_PATH, JSON.stringify(health, null, 2), 'utf8');
}

function recordSuccess(strategy) {
  const health = loadHealth();
  health.status = 'healthy';
  health.lastSuccess = new Date().toISOString();
  if (!health.strategyStats) health.strategyStats = {};
  health.strategyStats[strategy] = (health.strategyStats[strategy] || 0) + 1;
  saveHealth(health);
}

function recordFailure(strategy, reason) {
  const health = loadHealth();
  if (!health.failures) health.failures = [];
  health.failures.push({ strategy, reason, at: new Date().toISOString() });
  if (health.failures.length > 50) health.failures = health.failures.slice(-50);
  const cutoff = Date.now() - 86400000;
  const recentFailures = health.failures.filter(f => new Date(f.at).getTime() > cutoff).length;
  health.status = recentFailures >= 10 ? 'blocked' : recentFailures >= 3 ? 'degraded' : 'healthy';
  saveHealth(health);
}

// --- URL parsing ---

function extractRedditIds(url) {
  const match = String(url || '').match(/reddit\.com\/r\/(\w+)\/comments\/(\w+)/);
  return match ? { subreddit: match[1], postId: match[2] } : null;
}

// --- Rate limiting ---

async function rateLimit() {
  const wait = 1000 - (Date.now() - lastRedditCall);
  if (wait > 0) await sleep(wait);
  lastRedditCall = Date.now();
}

// --- Comment parsing ---

function parseCommentTree(children, depth = 0) {
  const out = [];
  if (!Array.isArray(children)) return out;

  for (const child of children) {
    if (child.kind !== 't1') continue;
    const data = child.data;
    if (!data || !data.body || data.author === 'AutoModerator') continue;

    out.push({
      id: data.id || null,
      body: truncate(cleanupText(data.body), MAX_COMMENT_LENGTH),
      score: data.score ?? 0,
      author: data.author || '[deleted]',
      depth
    });

    if (data.replies?.data?.children) {
      out.push(...parseCommentTree(data.replies.data.children, depth + 1));
    }
  }

  return out;
}

// --- Strategy 1: JSON endpoint ---

async function tryJsonEndpoint(ids) {
  await rateLimit();
  apiCalls.json++;
  apiCalls.total++;

  const jsonUrl = `https://www.reddit.com/r/${ids.subreddit}/comments/${ids.postId}/.json?limit=100&sort=top`;
  let res;

  try {
    res = await fetch(jsonUrl, { headers: { 'User-Agent': REDDIT_UA } });
  } catch (err) {
    recordFailure('json', err.message);
    return null;
  }

  if (res.status === 429) {
    log('Reddit JSON 429, retrying in 2s...');
    await sleep(2000);
    await rateLimit();
    apiCalls.json++;
    apiCalls.total++;
    try {
      res = await fetch(jsonUrl, { headers: { 'User-Agent': REDDIT_UA } });
    } catch {
      return null;
    }
    if (!res.ok) {
      recordFailure('json', `HTTP ${res.status} after retry`);
      return null;
    }
  } else if (!res.ok) {
    recordFailure('json', `HTTP ${res.status}`);
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  if (!Array.isArray(data) || data.length < 2) return null;
  const post = data[0]?.data?.children?.[0]?.data;
  if (!post) return null;

  const comments = parseCommentTree(data[1]?.data?.children || []);
  comments.sort((a, b) => b.score - a.score);

  recordSuccess('json');
  return {
    url: `https://www.reddit.com/r/${ids.subreddit}/comments/${post.id}/`,
    postId: post.id,
    title: cleanupText(post.title || ''),
    selftext: truncate(cleanupText(post.selftext || ''), 2000),
    subreddit: ids.subreddit,
    upvotes: post.ups || 0,
    commentCount: comments.length,
    comments,
    strategy: 'json'
  };
}

// --- Strategy 2: Old Reddit HTML parsing ---

function parseOldRedditHtml(html, ids) {
  const comments = [];

  // Extract title
  const titleMatch = html.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/);
  const title = titleMatch ? cleanupText(titleMatch[1]) : '';

  // Extract self text
  const selftextMatch = html.match(/<div class="md">([\s\S]*?)<\/div>/);
  const selftext = selftextMatch
    ? truncate(cleanupText(selftextMatch[1].replace(/<[^>]+>/g, '')), 2000)
    : '';

  // Extract comments — old reddit has <div class="entry"> blocks
  const commentBlocks = html.match(/<div[^>]*class="[^"]*comment[^"]*"[^>]*>[\s\S]*?<div class="md">([\s\S]*?)<\/div>[\s\S]*?<span class="score[^"]*"[^>]*title="(\d+)\s*points?"/g) || [];

  for (const block of commentBlocks) {
    const bodyMatch = block.match(/<div class="md">([\s\S]*?)<\/div>/);
    const scoreMatch = block.match(/title="(-?\d+)\s*points?"/);
    if (bodyMatch) {
      const body = truncate(cleanupText(bodyMatch[1].replace(/<[^>]+>/g, '')), MAX_COMMENT_LENGTH);
      if (body && body.length > 10) {
        comments.push({
          id: null,
          body,
          score: scoreMatch ? parseInt(scoreMatch[1], 10) : 0,
          author: '[parsed]',
          depth: 0
        });
      }
    }
  }

  comments.sort((a, b) => b.score - a.score);

  return {
    url: `https://www.reddit.com/r/${ids.subreddit}/comments/${ids.postId}/`,
    postId: ids.postId,
    title,
    selftext,
    subreddit: ids.subreddit,
    upvotes: 0,
    commentCount: comments.length,
    comments,
    strategy: 'old-reddit'
  };
}

async function tryOldReddit(ids) {
  await rateLimit();
  apiCalls.oldReddit++;
  apiCalls.total++;

  const url = `https://old.reddit.com/r/${ids.subreddit}/comments/${ids.postId}/?sort=top&limit=100`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': REDDIT_UA,
        'Accept': 'text/html'
      }
    });
  } catch (err) {
    recordFailure('old-reddit', err.message);
    return null;
  }

  if (!res.ok) {
    recordFailure('old-reddit', `HTTP ${res.status}`);
    return null;
  }

  const html = await res.text();
  if (!html || html.length < 500) return null;

  const result = parseOldRedditHtml(html, ids);
  if (result.commentCount === 0 && !result.title) return null;

  recordSuccess('old-reddit');
  return result;
}

// --- Strategy 3: Generic web fetch (markdown-like extraction) ---

async function tryWebFetch(ids) {
  await rateLimit();
  apiCalls.webFetch++;
  apiCalls.total++;

  const url = `https://www.reddit.com/r/${ids.subreddit}/comments/${ids.postId}/`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': REDDIT_UA,
        'Accept': 'text/html'
      }
    });
  } catch (err) {
    recordFailure('web-fetch', err.message);
    return null;
  }

  if (!res.ok) {
    recordFailure('web-fetch', `HTTP ${res.status}`);
    return null;
  }

  const html = await res.text();
  if (!html || html.length < 500) return null;

  // Extract what we can from new Reddit HTML — less structured but something
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? cleanupText(titleMatch[1].replace(/\s*:\s*\w+$/, '').replace(/\s*-\s*Reddit$/, '')) : '';

  // Look for comment text in various patterns
  const textBlocks = html.match(/<p[^>]*>([^<]{20,})<\/p>/g) || [];
  const comments = textBlocks
    .map(block => {
      const text = block.replace(/<[^>]+>/g, '').trim();
      return text.length > 20 ? { id: null, body: truncate(cleanupText(text), MAX_COMMENT_LENGTH), score: 0, author: '[web-fetch]', depth: 0 } : null;
    })
    .filter(Boolean)
    .slice(0, 50);

  if (comments.length === 0 && !title) return null;

  recordSuccess('web-fetch');
  return {
    url,
    postId: ids.postId,
    title,
    selftext: '',
    subreddit: ids.subreddit,
    upvotes: 0,
    commentCount: comments.length,
    comments,
    strategy: 'web-fetch'
  };
}

// --- Main fetch function with cache + fallback chain ---

async function fetchRedditThread(url, useCache = true) {
  const ids = extractRedditIds(url);
  if (!ids) return null;

  // Check cache first
  if (useCache) {
    const cached = cacheGet(url);
    if (cached && cached.comments) {
      log(`Reddit cache hit: r/${ids.subreddit}/${ids.postId}`);
      return cached;
    }
  }

  // Strategy chain
  let result = await tryJsonEndpoint(ids);

  if (!result) {
    log(`JSON failed for r/${ids.subreddit}/${ids.postId}, trying old.reddit...`);
    result = await tryOldReddit(ids);
  }

  if (!result) {
    log(`Old Reddit failed, trying web fetch...`);
    result = await tryWebFetch(ids);
  }

  if (!result) {
    log(`All strategies failed for r/${ids.subreddit}/${ids.postId}`);
    return null;
  }

  // Cache successful result
  cacheSet(url, result);
  return result;
}

function getRedditApiCalls() {
  return { ...apiCalls };
}

function resetRedditApiCalls() {
  apiCalls.json = 0;
  apiCalls.oldReddit = 0;
  apiCalls.webFetch = 0;
  apiCalls.cacheHits = 0;
  apiCalls.total = 0;
}

function getRedditHealthSummary() {
  const health = loadHealth();
  const cutoff = Date.now() - 86400000;
  const recentFailures = (health.failures || []).filter(f => new Date(f.at).getTime() > cutoff).length;
  return `Reddit: ${health.status || 'unknown'} (${recentFailures} failures in 24h)`;
}

module.exports = {
  fetchRedditThread,
  extractRedditIds,
  cachePrune: cachePrune,
  getRedditApiCalls,
  resetRedditApiCalls,
  getRedditHealthSummary
};
