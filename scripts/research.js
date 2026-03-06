#!/usr/bin/env node
'use strict';

const { readFileSync, readdirSync, writeFileSync, statSync, existsSync } = require('fs');
const { join } = require('path');

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_KEY = process.env.BRAVE_API_KEY;
const REDDIT_UA = 'ConsensusResearch/2.0';
const MAX_COMMENT_LENGTH = 1000;

const CATEGORY_KEYWORDS = {
  supplement: ['supplement', 'vitamin', 'nootropic', 'nootropics', 'protein', 'creatine',
    'glycine', 'magnesium', 'ashwagandha', 'omega', 'probiotic', 'collagen', 'melatonin',
    'cbd', "lion's mane", 'amino acid', 'bcaa', 'pre-workout', 'whey', 'powder',
    'capsule', 'tincture', 'extract', 'peptide'],
  restaurant: ['restaurant', 'food', 'dining', 'eat', 'brunch', 'lunch', 'dinner',
    'cafe', 'bistro', 'sushi', 'pizza', 'tacos', 'bar', 'steakhouse', 'ramen',
    'bakery', 'deli'],
  tech: ['laptop', 'phone', 'monitor', 'keyboard', 'mouse', 'headphone', 'earbuds',
    'speaker', 'camera', 'gpu', 'cpu', 'ssd', 'router', 'tablet', 'smartwatch',
    'tv', 'charger', 'microphone', 'webcam', 'nas'],
  software: ['app', 'software', 'saas', 'platform', 'extension', 'plugin', 'ide',
    'editor', 'browser', 'vpn', 'antivirus', 'ai tool', 'api'],
  service: ['service', 'provider', 'doctor', 'dentist', 'coach', 'therapist',
    'plumber', 'contractor', 'insurance', 'bank', 'gym', 'subscription',
    'mechanic', 'lawyer']
};

const CATEGORY_SUBREDDITS = {
  supplement: ['supplements', 'nootropics', 'biohackers', 'nutrition', 'fitness'],
  restaurant: ['food', 'FoodLosAngeles', 'AskLosAngeles', 'foodnyc'],
  tech: ['headphones', 'buildapc', 'homeautomation', 'gadgets', 'BuyItForLife'],
  software: ['software', 'selfhosted', 'webdev', 'SaaS'],
  service: ['personalfinance', 'HomeImprovement', 'Dentistry'],
  product: ['BuyItForLife', 'goodvalue']
};

const CATEGORY_EXPERT_SITES = {
  supplement: ['examine.com', 'consumerlab.com', 'labdoor.com'],
  tech: ['rtings.com', 'wirecutter.com', 'tomshardware.com'],
  software: ['g2.com', 'capterra.com', 'news.ycombinator.com'],
  restaurant: ['eater.com', 'infatuation.com'],
  service: ['bbb.org', 'trustpilot.com'],
  product: ['wirecutter.com', 'consumerreports.org']
};

const TEMPORAL_DECAY_DAYS = {
  restaurant: 180,
  software: 180,
  tech: 365,
  service: 365,
  supplement: 730,
  product: 1095
};

// Words that look like brands in Amazon titles but aren't
const BRAND_BLACKLIST = new Set([
  'the', 'and', 'for', 'with', 'new', 'best', 'top', 'all', 'one', 'now',
  'get', 'set', 'pack', 'box', 'lot', 'kit', 'pro', 'max', 'plus', 'ultra',
  'mini', 'lite', 'day', 'use', 'two', 'per', 'non', 'free', 'pure', 'raw',
  'organic', 'natural', 'premium', 'original', 'extra', 'super', 'advanced',
  'essential', 'complete', 'total', 'daily', 'made', 'high', 'low', 'great',
  'good', 'each', 'full', 'real', 'true', 'bulk', 'amazon', 'brand'
]);

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let _lastBrave = 0;
let _lastReddit = 0;

async function braveRateLimit() {
  const wait = 200 - (Date.now() - _lastBrave);
  if (wait > 0) await sleep(wait);
  _lastBrave = Date.now();
}

async function redditRateLimit() {
  const wait = 1000 - (Date.now() - _lastReddit);
  if (wait > 0) await sleep(wait);
  _lastReddit = Date.now();
}

function log(msg) {
  process.stderr.write(`[research] ${msg}\n`);
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + '…';
}

// ─────────────────────────────────────────────
// CLI Parsing
// ─────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    query: null,
    category: null,
    depth: 'standard',
    output: null,
    compare: false,
    compareExplicit: null,
    freshness: null
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--category' && argv[i + 1]) {
      opts.category = argv[++i];
    } else if (arg === '--depth' && argv[i + 1]) {
      opts.depth = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (arg === '--compare') {
      opts.compare = true;
      // Check for explicit brand args: --compare "Brand A" "Brand B"
      if (argv[i + 1] && !argv[i + 1].startsWith('--') &&
          argv[i + 2] && !argv[i + 2].startsWith('--')) {
        opts.compareExplicit = [argv[i + 1], argv[i + 2]];
        i += 2;
      }
    } else if (arg === '--freshness') {
      opts.freshness = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '.';
    } else if (arg === '--help' || arg === '-h') {
      // handled in main
    } else if (!arg.startsWith('--') && !opts.query) {
      opts.query = arg;
    }
    i++;
  }

  return opts;
}

// ─────────────────────────────────────────────
// Category Detection
// ─────────────────────────────────────────────

function detectCategory(query) {
  const q = query.toLowerCase();
  let best = 'product';
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (q.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }

  return best;
}

// ─────────────────────────────────────────────
// Brave Search API
// ─────────────────────────────────────────────

async function braveSearch(query, count = 5) {
  if (!BRAVE_KEY) throw new Error('BRAVE_API_KEY not set');

  await braveRateLimit();

  const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${count}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'X-Subscription-Token': BRAVE_KEY,
        'Accept': 'application/json'
      }
    });
  } catch (e) {
    log(`Brave fetch error: ${e.message}`);
    return [];
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log(`Brave API ${res.status}: ${body.slice(0, 200)}`);
    return [];
  }

  const data = await res.json();
  return (data.web?.results || []).map(r => ({
    title: r.title || '',
    url: r.url,
    snippet: r.description || '',
    source: safeHostname(r.url),
    age: r.age || null
  }));
}

function safeHostname(urlStr) {
  try { return new URL(urlStr).hostname; } catch { return ''; }
}

// ─────────────────────────────────────────────
// Reddit
// ─────────────────────────────────────────────

function extractRedditIds(url) {
  const m = url.match(/reddit\.com\/r\/(\w+)\/comments\/(\w+)/);
  return m ? { subreddit: m[1], postId: m[2] } : null;
}

function parseCommentTree(children, depth = 0) {
  const out = [];
  if (!Array.isArray(children)) return out;

  for (const child of children) {
    if (child.kind !== 't1') continue;
    const d = child.data;
    if (!d || !d.body || d.author === 'AutoModerator') continue;

    out.push({
      body: truncate(d.body, MAX_COMMENT_LENGTH),
      score: d.score ?? 0,
      author: d.author || '[deleted]',
      depth
    });

    if (d.replies?.data?.children) {
      out.push(...parseCommentTree(d.replies.data.children, depth + 1));
    }
  }
  return out;
}

async function fetchRedditThread(url) {
  const ids = extractRedditIds(url);
  if (!ids) return null;

  await redditRateLimit();

  const jsonUrl = `https://www.reddit.com/r/${ids.subreddit}/comments/${ids.postId}/.json?limit=100&sort=top`;

  let res;
  try {
    res = await fetch(jsonUrl, { headers: { 'User-Agent': REDDIT_UA } });
  } catch (e) {
    log(`Reddit fetch error: ${e.message}`);
    return null;
  }

  // Retry once on 429
  if (res.status === 429) {
    log('Reddit 429 — retrying in 2s...');
    await sleep(2000);
    await redditRateLimit();
    try {
      res = await fetch(jsonUrl, { headers: { 'User-Agent': REDDIT_UA } });
    } catch { return null; }
    if (!res.ok) { log(`Reddit retry failed: ${res.status}`); return null; }
  } else if (!res.ok) {
    log(`Reddit ${res.status} for r/${ids.subreddit}/${ids.postId}`);
    return null;
  }

  let data;
  try { data = await res.json(); } catch { return null; }
  if (!Array.isArray(data) || data.length < 2) return null;

  const post = data[0]?.data?.children?.[0]?.data;
  if (!post) return null;

  const comments = parseCommentTree(data[1]?.data?.children || []);
  comments.sort((a, b) => b.score - a.score);

  return {
    url: `https://www.reddit.com/r/${ids.subreddit}/comments/${post.id}/`,
    title: post.title || '',
    selftext: truncate(post.selftext || '', 2000),
    subreddit: ids.subreddit,
    upvotes: post.ups || 0,
    commentCount: comments.length,
    comments
  };
}

async function searchReddit(query, category = 'product', maxThreads = 3) {
  const subreddits = CATEGORY_SUBREDDITS[category] || CATEGORY_SUBREDDITS.product;

  // Parallel Brave searches: general + subreddit-scoped
  const searches = [braveSearch(`${query} review site:reddit.com`, 5)];

  if (subreddits.length > 0) {
    const subScope = subreddits.slice(0, 2).map(s => `site:reddit.com/r/${s}`).join(' OR ');
    searches.push(braveSearch(`${query} (${subScope})`, 3));
  }

  const allResults = (await Promise.all(searches)).flat();

  // Deduplicate by post ID
  const seen = new Set();
  const unique = [];
  for (const r of allResults) {
    const ids = extractRedditIds(r.url);
    if (!ids || seen.has(ids.postId)) continue;
    seen.add(ids.postId);
    unique.push(r);
  }

  // Fetch threads sequentially (rate limiting)
  const threads = [];
  for (const result of unique.slice(0, maxThreads)) {
    log(`Reddit: ${result.title.slice(0, 70)}...`);
    const thread = await fetchRedditThread(result.url);
    if (thread && thread.commentCount > 0) threads.push(thread);
  }

  return { threads };
}

// ─────────────────────────────────────────────
// Amazon (via Brave)
// ─────────────────────────────────────────────

async function searchAmazon(query) {
  const results = await braveSearch(`${query} site:amazon.com`, 5);

  const products = results
    .filter(r => r.url.includes('amazon.com') && (r.url.includes('/dp/') || r.url.includes('/gp/')))
    .map(r => {
      const ratingMatch = r.snippet.match(/(\d\.?\d?)\s*out of\s*5\s*stars?/i);
      const reviewMatch = r.snippet.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
      const priceMatch = r.snippet.match(/\$(\d+\.?\d{0,2})/);

      return {
        title: r.title.replace(/ - Amazon\.com.*$/i, '').replace(/^Amazon\.com:\s*/i, ''),
        url: r.url,
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null,
        price: priceMatch ? parseFloat(priceMatch[1]) : null,
        snippet: r.snippet
      };
    });

  return { products };
}

// ─────────────────────────────────────────────
// General Web Search
// ─────────────────────────────────────────────

async function searchWeb(query, sites = []) {
  const siteScope = sites.length > 0
    ? sites.map(s => `site:${s}`).join(' OR ')
    : '';
  const fullQuery = siteScope ? `${query} (${siteScope})` : query;
  const results = await braveSearch(fullQuery, 5);
  return { results };
}

// ─────────────────────────────────────────────
// Brand Analysis
// ─────────────────────────────────────────────

function extractBrandsFromAmazon(products) {
  const brands = new Map(); // name → longest form

  for (const p of products) {
    const words = p.title.split(/\s+/);
    if (words.length < 2) continue;

    const first = words[0];
    if (!first || first.length < 2 || !/^[A-Z]/.test(first)) continue;
    if (BRAND_BLACKLIST.has(first.toLowerCase())) continue;

    const second = words[1];
    const twoWord = (second && /^[A-Z]/.test(second) && second.length > 1 &&
      !BRAND_BLACKLIST.has(second.toLowerCase()));

    if (twoWord) {
      const full = `${first} ${second}`;
      brands.set(full.toLowerCase(), full);
    }

    // Only use single word if it's distinctive (all-caps like GNC, or 4+ chars)
    if (first === first.toUpperCase() || first.length >= 4) {
      if (!brands.has(first.toLowerCase())) {
        brands.set(first.toLowerCase(), first);
      }
    }
  }

  return [...brands.values()];
}

function countBrandMentions(allText, brandNames) {
  const counts = {};

  for (const brand of brandNames) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = allText.match(regex);
    if (matches && matches.length > 0) {
      counts[brand] = matches.length;
    }
  }

  return counts;
}

function findTopBrands(redditThreads, amazonProducts) {
  const brandNames = extractBrandsFromAmazon(amazonProducts);

  // Also extract brand-like proper nouns from Reddit that appear 3+ times
  const allComments = redditThreads.flatMap(t => t.comments.map(c => c.body));
  const allText = [
    ...redditThreads.map(t => t.title),
    ...redditThreads.map(t => t.selftext || ''),
    ...allComments
  ].join('\n');

  // Count known brands
  const mentions = countBrandMentions(allText, brandNames);

  // Boost brands that appear in Amazon titles
  for (const p of amazonProducts) {
    for (const brand of brandNames) {
      if (p.title.toLowerCase().startsWith(brand.toLowerCase())) {
        mentions[brand] = (mentions[brand] || 0) + 1;
      }
    }
  }

  return Object.entries(mentions)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));
}

// ─────────────────────────────────────────────
// Data Sufficiency
// ─────────────────────────────────────────────

function calcDataSufficiency(data) {
  const redditCount = data.reddit?.threads?.length || 0;
  const totalComments = (data.reddit?.threads || [])
    .reduce((sum, t) => sum + t.commentCount, 0);

  const sourceTypes = new Set();
  if (redditCount > 0) sourceTypes.add('reddit');
  if ((data.amazon?.products?.length || 0) > 0) sourceTypes.add('amazon');
  if ((data.web?.results?.length || 0) > 0) sourceTypes.add('web');
  if ((data.youtube?.results?.length || 0) > 0) sourceTypes.add('youtube');

  const otherSourceCount = sourceTypes.size - (sourceTypes.has('reddit') ? 1 : 0);

  // HIGH: 3+ Reddit threads with 20+ total comments AND 2+ other source types
  if (redditCount >= 3 && totalComments >= 20 && otherSourceCount >= 2) return 'HIGH';

  // MEDIUM: 1-2 Reddit threads OR 10+ comments, at least 1 other source type
  if ((redditCount >= 1 || totalComments >= 10) && otherSourceCount >= 1) return 'MEDIUM';

  // LOW: everything else
  return 'LOW';
}

// ─────────────────────────────────────────────
// Head-to-Head Comparison
// ─────────────────────────────────────────────

function buildComparison(data, brandA, brandB) {
  if (!brandA || !brandB) return null;

  const allComments = (data.reddit?.threads || []).flatMap(t => t.comments);

  function brandComments(brand) {
    return allComments
      .filter(c => c.body.toLowerCase().includes(brand.toLowerCase()))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(c => ({ body: c.body, score: c.score }));
  }

  function brandAmazon(brand) {
    const match = (data.amazon?.products || [])
      .find(p => p.title.toLowerCase().includes(brand.toLowerCase()));
    if (!match) return null;
    return { title: match.title, rating: match.rating, reviewCount: match.reviewCount, price: match.price };
  }

  return {
    candidateA: {
      name: brandA,
      topComments: brandComments(brandA),
      amazon: brandAmazon(brandA)
    },
    candidateB: {
      name: brandB,
      topComments: brandComments(brandB),
      amazon: brandAmazon(brandB)
    }
  };
}

// ─────────────────────────────────────────────
// Freshness Checker
// ─────────────────────────────────────────────

function checkFreshness(dir) {
  if (!existsSync(dir)) {
    log(`Directory not found: ${dir}`);
    return [];
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  const results = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath, 'utf8');

    // Extract date from content or filename
    let date = null;
    const datePatterns = [
      /(?:Date|Research Date):\s*(\d{4}-\d{2}-\d{2})/i,
      /(\d{4}-\d{2}-\d{2})/
    ];
    for (const pat of datePatterns) {
      const m = content.match(pat);
      if (m) {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime())) { date = d; break; }
      }
    }
    if (!date) {
      const fnm = file.match(/(\d{4}-\d{2}-\d{2})/);
      if (fnm) date = new Date(fnm[1]);
    }
    if (!date || isNaN(date.getTime())) {
      date = statSync(filePath).mtime;
    }

    // Detect category
    let category = 'product';
    const catMatch = content.match(/Category:\s*(\w+)/i);
    if (catMatch) {
      category = catMatch[1].toLowerCase();
    } else {
      category = detectCategory(content.slice(0, 500));
    }

    const halfLife = TEMPORAL_DECAY_DAYS[category] || TEMPORAL_DECAY_DAYS.product;
    const daysOld = Math.floor((Date.now() - date.getTime()) / 86400000);

    let staleness = 'fresh';
    if (daysOld >= halfLife) staleness = 'stale';
    else if (daysOld >= halfLife * 0.75) staleness = 'aging';

    // Product name from heading or filename
    let product = file.replace(/\.md$/, '').replace(/-/g, ' ');
    const heading = content.match(/^#\s+.*?:\s*(.+)/m) || content.match(/^#\s+(.+)/m);
    if (heading) product = heading[1].trim();

    results.push({ file, product, category, researchDate: date.toISOString().split('T')[0], halfLife, staleness, daysOld });
  }

  return results;
}

// ─────────────────────────────────────────────
// Price Normalization
// ─────────────────────────────────────────────

function normalizePrice(price, servings) {
  if (!price || !servings || servings <= 0) return null;
  return {
    priceRaw: price,
    servings,
    perServing: Math.round((price / servings) * 100) / 100,
    currency: 'USD'
  };
}

// ─────────────────────────────────────────────
// Main Orchestrator
// ─────────────────────────────────────────────

async function runResearch(query, opts) {
  const category = opts.category || detectCategory(query);
  const depth = opts.depth || 'standard';
  const maxRedditThreads = depth === 'quick' ? 1 : 3;

  log(`Query: "${query}" | category: ${category} | depth: ${depth}`);

  const result = {
    query,
    category,
    depth,
    timestamp: new Date().toISOString(),
    reddit: { threads: [], totalComments: 0 },
    amazon: { products: [] },
    web: { results: [] },
    youtube: { results: [] },
    twitter: { results: [] },
    alternatives: [],
    priceData: [],
    comparison: null,
    freshness: null,
    dataSufficiency: 'LOW',
    sourceCount: { reddit: 0, amazon: 0, web: 0, youtube: 0, twitter: 0 }
  };

  // ── Phase 1: Source Collection ──

  // Reddit (all depths)
  log('Searching Reddit...');
  try {
    result.reddit = await searchReddit(query, category, maxRedditThreads);
    result.reddit.totalComments = result.reddit.threads
      .reduce((s, t) => s + t.commentCount, 0);
  } catch (e) {
    log(`Reddit failed: ${e.message}`);
  }

  if (depth === 'quick') {
    // Quick: one general web search only
    log('Quick web search...');
    try {
      result.web = await searchWeb(`${query} review best`);
    } catch (e) {
      log(`Web search failed: ${e.message}`);
    }
  } else {
    // Standard + Deep: Amazon + expert sites

    // Run Amazon and expert searches in parallel (they're independent Brave calls)
    const expertSites = CATEGORY_EXPERT_SITES[category] || CATEGORY_EXPERT_SITES.product;
    log(`Searching Amazon + expert sites (${expertSites.join(', ')})...`);

    const [amazonResult, webResult] = await Promise.all([
      searchAmazon(query).catch(e => { log(`Amazon failed: ${e.message}`); return { products: [] }; }),
      searchWeb(`${query} review`, expertSites).catch(e => { log(`Web failed: ${e.message}`); return { results: [] }; })
    ]);

    result.amazon = amazonResult;
    result.web = webResult;
  }

  if (depth === 'deep') {
    // YouTube search
    log('Searching YouTube...');
    try {
      const yt = await braveSearch(`${query} review site:youtube.com`, 5);
      result.youtube = { results: yt };
    } catch (e) {
      log(`YouTube failed: ${e.message}`);
    }

    // Twitter/X complaint search
    log('Searching Twitter/X complaints...');
    try {
      const tw = await braveSearch(
        `"${query}" (broken OR terrible OR worst OR disappointed OR refund) site:twitter.com OR site:x.com`, 5
      );
      result.twitter = { results: tw };
    } catch (e) {
      log(`Twitter failed: ${e.message}`);
    }
  }

  // ── Phase 2: Source Counts ──

  result.sourceCount = {
    reddit: result.reddit.threads.length,
    amazon: result.amazon.products.length,
    web: result.web.results?.length || 0,
    youtube: result.youtube.results?.length || 0,
    twitter: result.twitter.results?.length || 0
  };

  // ── Phase 3: Brand Analysis ──

  const brands = findTopBrands(result.reddit.threads, result.amazon.products);
  result.alternatives = brands.slice(0, 10);

  // ── Phase 4: Price Data ──

  result.priceData = result.amazon.products
    .filter(p => p.price)
    .map(p => ({
      brand: extractBrandsFromAmazon([p])[0] || p.title.split(/\s+/).slice(0, 2).join(' '),
      title: p.title,
      price: p.price,
      rating: p.rating,
      reviewCount: p.reviewCount
    }));

  // ── Phase 5: Data Sufficiency ──

  result.dataSufficiency = calcDataSufficiency(result);

  // ── Phase 6: Comparison ──

  if (opts.compare) {
    let brandA, brandB;

    if (opts.compareExplicit) {
      [brandA, brandB] = opts.compareExplicit;
      log(`Explicit compare: "${brandA}" vs "${brandB}"`);
    } else {
      // Auto-detect from top mentioned brands
      if (brands.length >= 2) {
        brandA = brands[0].name;
        brandB = brands[1].name;
        log(`Auto-compare: "${brandA}" (${brands[0].count}) vs "${brandB}" (${brands[1].count})`);
      } else {
        log('Not enough brands found for auto-comparison');
      }
    }

    if (brandA && brandB) {
      result.comparison = buildComparison(result, brandA, brandB);
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────

const HELP = `Usage: research.js <query> [options]

Options:
  --category <type>     product|supplement|restaurant|service|tech|software
                        Auto-detected from query if omitted
  --depth <level>       quick|standard|deep (default: standard)
  --output <path>       Write JSON results to file (default: stdout)
  --compare [A B]       Compare brands. No args = auto-detect top 2.
                        With args = explicit: --compare "Sony" "Bose"
  --freshness <dir>     Check research files for staleness (separate mode)
  --help, -h            Show this help

Depth modes:
  quick       2-3 searches, 1 Reddit thread, no Amazon/YouTube
  standard    Full loop: Reddit (3 threads), Amazon, expert sites
  deep        Standard + YouTube + Twitter/X complaints

Environment:
  BRAVE_API_KEY         Required. Get one free at https://brave.com/search/api/

Examples:
  research.js "glycine powder" --category supplement
  research.js "best restaurant downtown LA" --depth quick
  research.js "protein powder" --compare
  research.js "headphones" --compare "Sony WH-1000XM5" "Bose QC Ultra"
  research.js --freshness ./memory/research/`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  // Freshness mode
  if (args.freshness) {
    const results = checkFreshness(args.freshness);
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Research mode
  if (!args.query) {
    console.error('Error: query required. Use --help for usage.');
    process.exit(1);
  }

  if (!BRAVE_KEY) {
    console.error('Error: BRAVE_API_KEY environment variable required.');
    console.error('Get a free key at: https://brave.com/search/api/');
    process.exit(1);
  }

  if (!['quick', 'standard', 'deep'].includes(args.depth)) {
    console.error(`Error: invalid depth "${args.depth}". Use quick|standard|deep.`);
    process.exit(1);
  }

  try {
    const result = await runResearch(args.query, args);
    const json = JSON.stringify(result, null, 2);

    if (args.output) {
      writeFileSync(args.output, json, 'utf8');
      log(`Results written to ${args.output}`);
    } else {
      console.log(json);
    }
  } catch (e) {
    console.error(`Fatal: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
}

main();
