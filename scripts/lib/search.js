#!/usr/bin/env node
'use strict';

/**
 * Search provider abstraction with automatic fallback.
 * Priority: Brave (best quality) → DuckDuckGo HTML (always available, no API key).
 *
 * Tracks provider health in data/search-health.json.
 */

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { dirname, resolve } = require('path');

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const HEALTH_PATH = resolve(process.cwd(), 'data/search-health.json');

const BRAVE_COST_PER_QUERY = 0.005;

let lastBraveCall = 0;
const apiCalls = { brave: 0, ddg: 0, total: 0 };

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  process.stderr.write(`[search] ${msg}\n`);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function safeHostname(urlStr) {
  try { return new URL(urlStr).hostname; } catch { return ''; }
}

// --- Health tracking ---

function loadHealth() {
  if (!existsSync(HEALTH_PATH)) {
    return {
      providers: {
        brave: { status: 'unknown', failures: [], lastSuccess: null },
        ddg: { status: 'unknown', failures: [], lastSuccess: null }
      },
      lastUpdated: null
    };
  }
  try {
    return JSON.parse(readFileSync(HEALTH_PATH, 'utf8'));
  } catch {
    return { providers: { brave: { status: 'unknown', failures: [], lastSuccess: null }, ddg: { status: 'unknown', failures: [], lastSuccess: null } }, lastUpdated: null };
  }
}

function saveHealth(health) {
  ensureDir(dirname(HEALTH_PATH));
  health.lastUpdated = new Date().toISOString();
  writeFileSync(HEALTH_PATH, JSON.stringify(health, null, 2), 'utf8');
}

function recordSuccess(providerName) {
  const health = loadHealth();
  const provider = health.providers[providerName] || { status: 'unknown', failures: [], lastSuccess: null };
  provider.status = 'healthy';
  provider.lastSuccess = new Date().toISOString();
  health.providers[providerName] = provider;
  saveHealth(health);
}

function recordFailure(providerName, reason) {
  const health = loadHealth();
  const provider = health.providers[providerName] || { status: 'unknown', failures: [], lastSuccess: null };
  provider.failures.push({ reason, at: new Date().toISOString() });
  // Keep last 20 failures
  if (provider.failures.length > 20) provider.failures = provider.failures.slice(-20);
  // Count failures in last 24h
  const cutoff = Date.now() - 86400000;
  const recentFailures = provider.failures.filter(f => new Date(f.at).getTime() > cutoff).length;
  provider.status = recentFailures >= 5 ? 'blocked' : recentFailures >= 2 ? 'degraded' : 'healthy';
  health.providers[providerName] = provider;
  saveHealth(health);
}

function getProviderStatus(providerName) {
  const health = loadHealth();
  return health.providers[providerName]?.status || 'unknown';
}

// --- Brave Search ---

async function searchBrave(query, count = 5) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;

  // Rate limit: 200ms between calls
  const wait = 200 - (Date.now() - lastBraveCall);
  if (wait > 0) await sleep(wait);
  lastBraveCall = Date.now();

  const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${count}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'X-Subscription-Token': key,
        'Accept': 'application/json'
      }
    });
  } catch (err) {
    log(`Brave fetch error: ${err.message}`);
    recordFailure('brave', err.message);
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log(`Brave API ${res.status}: ${body.slice(0, 200)}`);
    recordFailure('brave', `HTTP ${res.status}`);
    return null;
  }

  apiCalls.brave++;
  apiCalls.total++;
  recordSuccess('brave');

  const data = await res.json();
  return (data.web?.results || []).map(result => ({
    title: result.title || '',
    url: result.url,
    snippet: result.description || '',
    source: safeHostname(result.url),
    age: result.age || null
  }));
}

// --- DuckDuckGo HTML fallback (no API key needed) ---

function parseDDGHtml(html) {
  const results = [];
  // Match result blocks: <a class="result__a" href="...">title</a> and <a class="result__snippet" ...>snippet</a>
  const resultBlocks = html.split(/class="result\s/g).slice(1);

  for (const block of resultBlocks) {
    if (results.length >= 10) break;

    // Extract URL from result__a href
    const urlMatch = block.match(/class="result__a"\s+href="([^"]+)"/);
    if (!urlMatch) continue;

    let url = urlMatch[1];
    // DDG wraps URLs in redirect: //duckduckgo.com/l/?uddg=ENCODED_URL
    if (url.includes('uddg=')) {
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
    }

    // Extract title
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
    const title = titleMatch ? titleMatch[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim() : '';

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    let snippet = '';
    if (snippetMatch) {
      snippet = snippetMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (url && title) {
      results.push({
        title,
        url,
        snippet,
        source: safeHostname(url),
        age: null
      });
    }
  }

  return results;
}

async function searchDDG(query, count = 5) {
  const body = `q=${encodeURIComponent(query)}&b=`;
  let res;
  try {
    res = await fetch(DDG_HTML_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ConsensusResearch/5.0'
      },
      body
    });
  } catch (err) {
    log(`DDG fetch error: ${err.message}`);
    recordFailure('ddg', err.message);
    return null;
  }

  if (!res.ok) {
    log(`DDG ${res.status}`);
    recordFailure('ddg', `HTTP ${res.status}`);
    return null;
  }

  apiCalls.ddg++;
  apiCalls.total++;
  recordSuccess('ddg');

  const html = await res.text();
  return parseDDGHtml(html).slice(0, count);
}

// --- Unified search with fallback ---

let _fallbackWarned = false;

async function search(query, count = 5) {
  // Try Brave first (best quality)
  const braveStatus = getProviderStatus('brave');
  if (braveStatus !== 'blocked' && process.env.BRAVE_API_KEY) {
    const results = await searchBrave(query, count);
    if (results && results.length > 0) {
      return { provider: 'brave', results };
    }
  }

  // Fallback to DDG
  if (!_fallbackWarned) {
    log('Brave unavailable — falling back to DuckDuckGo');
    _fallbackWarned = true;
  }
  const ddgResults = await searchDDG(query, count);
  if (ddgResults && ddgResults.length > 0) {
    return { provider: 'ddg', results: ddgResults };
  }

  return { provider: null, results: [] };
}

function getSearchApiCalls() {
  return { ...apiCalls };
}

function resetSearchApiCalls() {
  apiCalls.brave = 0;
  apiCalls.ddg = 0;
  apiCalls.total = 0;
}

function getSearchCost() {
  return {
    braveCalls: apiCalls.brave,
    ddgCalls: apiCalls.ddg,
    totalCalls: apiCalls.total,
    estimatedUSD: Math.round(apiCalls.brave * BRAVE_COST_PER_QUERY * 1000) / 1000
  };
}

function getHealthSummary() {
  const health = loadHealth();
  const lines = [];
  for (const [name, provider] of Object.entries(health.providers)) {
    const cutoff = Date.now() - 86400000;
    const recentFailures = (provider.failures || []).filter(f => new Date(f.at).getTime() > cutoff).length;
    lines.push(`${name}: ${provider.status || 'unknown'} (${recentFailures} failures in 24h)`);
  }
  return lines.join(' | ');
}

module.exports = {
  search,
  searchBrave,
  searchDDG,
  getSearchApiCalls,
  resetSearchApiCalls,
  getSearchCost,
  getHealthSummary,
  getProviderStatus,
  BRAVE_COST_PER_QUERY
};
