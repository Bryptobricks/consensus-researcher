#!/usr/bin/env node
'use strict';

const {
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  existsSync,
  mkdirSync,
  unlinkSync
} = require('fs');
const { dirname, join, resolve } = require('path');
const crypto = require('crypto');

// --- Lib modules (search fallback, Reddit resilience, feedback) ---
const { search, getSearchCost, resetSearchApiCalls, getHealthSummary: getSearchHealth } = require('./lib/search');
const { fetchRedditThread, extractRedditIds, getRedditApiCalls, resetRedditApiCalls, getRedditHealthSummary, cachePrune: pruneRedditCache } = require('./lib/reddit');
const { addFeedback, getCalibrationNote, getFeedbackSummary, loadFeedback } = require('./lib/feedback');

const SCHEMA_VERSION = 'v5';
const BRAND_INTEL_SCHEMA_VERSION = 1;

const REDDIT_UA = 'ConsensusResearch/5.0';
const MAX_CLAIM_QUOTE_LENGTH = 150;

const CACHE_DIR = resolve(process.cwd(), 'data/cache');
const WATCHLIST_PATH = resolve(process.cwd(), 'data/watchlist.json');
const CONFIG_PATH = resolve(process.cwd(), 'data/config.json');
const DEFAULT_SAVE_DIR = resolve(process.cwd(), 'memory/research');
const BRAND_INTEL_JSON_PATH = resolve(process.cwd(), 'references/brand-intel.json');
const BRAND_INTEL_MD_PATH = resolve(process.cwd(), 'references/brand-intel.md');
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_TTL_QUICK_MS = 2 * 60 * 60 * 1000;

const SUPPORTED_CATEGORIES = new Set([
  'product',
  'supplement',
  'restaurant',
  'service',
  'software',
  'tech'
]);

const UNSUPPORTED_CATEGORY_MESSAGES = {
  crypto: [
    'Category "crypto" is not supported by consensus-research.',
    'Use on-chain tools (Helius, Zerion, DEXScreener) for crypto research.'
  ].join('\n'),
  local: [
    'Category "local" is not supported by consensus-research.',
    'Use Google Maps, Yelp, or local-review tools for local service research.'
  ].join('\n')
};

const CATEGORY_KEYWORDS = {
  supplement: [
    'supplement', 'vitamin', 'nootropic', 'nootropics', 'protein', 'creatine',
    'glycine', 'magnesium', 'ashwagandha', 'omega', 'probiotic', 'collagen',
    'melatonin', 'cbd', "lion's mane", 'amino acid', 'bcaa', 'pre-workout',
    'whey', 'powder', 'capsule', 'tincture', 'extract', 'peptide'
  ],
  restaurant: [
    'restaurant', 'food', 'dining', 'eat', 'brunch', 'lunch', 'dinner',
    'cafe', 'bistro', 'sushi', 'pizza', 'tacos', 'bar', 'steakhouse',
    'ramen', 'bakery', 'deli'
  ],
  tech: [
    'laptop', 'phone', 'monitor', 'keyboard', 'mouse', 'headphone', 'earbuds',
    'speaker', 'camera', 'gpu', 'cpu', 'ssd', 'router', 'tablet',
    'smartwatch', 'tv', 'charger', 'microphone', 'webcam', 'nas'
  ],
  software: [
    'app', 'software', 'saas', 'platform', 'extension', 'plugin', 'ide',
    'editor', 'browser', 'vpn', 'antivirus', 'ai tool', 'api'
  ],
  service: [
    'service', 'provider', 'doctor', 'dentist', 'coach', 'therapist',
    'plumber', 'contractor', 'insurance', 'bank', 'gym', 'subscription',
    'mechanic', 'lawyer'
  ]
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

const POSITIVE_RE = /\b(recommend|great|best|love|solid|excellent|amazing|perfect|reliable|top.?notch|go.?to|switched to|worth it|favorite|fantastic)\b/i;
const NEGATIVE_RE = /\b(avoid|terrible|worst|returned|refund|broken|broke|recall|garbage|awful|disappointed|stopped|issue|issues|problem|complaint|failed|sick|nausea|headache|contaminat|lead|buggy|crash|slow)\b/i;

const GLOBAL_DIMENSION_ALIASES = {
  'third party tested': 'testing',
  'third-party tested': 'testing',
  'lab tested': 'testing',
  'coa': 'testing',
  'certificate of analysis': 'testing',
  'tested': 'testing',
  'purity': 'purity',
  'contamination': 'quality',
  'contaminated': 'quality',
  'recall': 'quality',
  'lead': 'quality',
  'heavy metal': 'quality',
  'cheap': 'value',
  'cheaper': 'value',
  'expensive': 'value',
  'overpriced': 'value',
  'price': 'value',
  'pricing': 'pricing',
  'cost': 'value',
  'value': 'value',
  'stomach': 'side-effects',
  'nausea': 'side-effects',
  'headache': 'side-effects',
  'side effect': 'side-effects',
  'side effects': 'side-effects',
  'made me sick': 'side-effects',
  'taste': 'taste',
  'flavor': 'taste',
  'dissolve': 'taste',
  'solubility': 'taste',
  'comfort': 'comfort',
  'comfortable': 'comfort',
  'battery': 'battery',
  'display': 'display',
  'screen': 'display',
  'build quality': 'build',
  'build': 'build',
  'durability': 'durability',
  'durable': 'durability',
  'lasted': 'durability',
  'broke': 'durability',
  'broken': 'durability',
  'stopped working': 'durability',
  'performance': 'performance',
  'fast': 'performance',
  'slow': 'performance',
  'lag': 'performance',
  'bug': 'bugs',
  'bugs': 'bugs',
  'crash': 'bugs',
  'crashes': 'bugs',
  'docs': 'docs',
  'documentation': 'docs',
  'ux': 'ux',
  'ui': 'ux',
  'support': 'support',
  'customer service': 'support',
  'service': 'service',
  'food': 'food',
  'ambiance': 'ambiance',
  'wait': 'wait-time',
  'wait time': 'wait-time',
  'adoption': 'adoption',
  'stars': 'adoption',
  'maintenance': 'maintenance'
};

const CATEGORY_DIMENSION_ALIASES = {
  supplement: {
    'dosage': 'dosage',
    'serving': 'dosage',
    'amino acid': 'purity'
  },
  product: {
    'design': 'design',
    'features': 'features'
  },
  tech: {
    'anc': 'noise cancellation',
    'noise cancellation': 'noise cancellation',
    'sound quality': 'sound quality',
    'sound': 'sound quality',
    'features': 'features'
  },
  software: {
    'pricing': 'pricing',
    'workflow': 'ux',
    'editor': 'ux',
    'api': 'features'
  },
  restaurant: {
    'menu': 'food',
    'staff': 'service'
  },
  service: {
    'response time': 'support',
    'billing': 'pricing'
  }
};

const DIMENSION_SEVERITY_FAMILY = {
  'side-effects': 'safety',
  'safety': 'safety',
  'purity': 'quality',
  'testing': 'quality',
  'quality': 'quality',
  'build': 'quality',
  'durability': 'effectiveness',
  'performance': 'effectiveness',
  'battery': 'effectiveness',
  'bugs': 'effectiveness',
  'noise cancellation': 'effectiveness',
  'sound quality': 'effectiveness',
  'support': 'quality',
  'service': 'quality',
  'food': 'quality',
  'value': 'value',
  'pricing': 'value',
  'price': 'value',
  'taste': 'taste',
  'comfort': 'taste',
  'ux': 'other',
  'docs': 'other',
  'ambiance': 'other',
  'wait-time': 'other',
  'adoption': 'other',
  'maintenance': 'other'
};

const NEGATIVE_SCORE_WEIGHTS = {
  safety: 1.5,
  effectiveness: 1.0,
  quality: 0.5,
  value: 0.25,
  taste: 0.25,
  other: 0.25
};

const SEVERITY_RANK = {
  safety: 5,
  quality: 4,
  effectiveness: 3,
  value: 2,
  taste: 1,
  other: 1
};

const BRAND_BLACKLIST = new Set([
  'the', 'and', 'for', 'with', 'new', 'best', 'top', 'all', 'one', 'now',
  'get', 'set', 'pack', 'box', 'lot', 'kit', 'pro', 'max', 'plus', 'ultra',
  'mini', 'lite', 'day', 'use', 'two', 'per', 'non', 'free', 'pure', 'raw',
  'organic', 'natural', 'premium', 'original', 'extra', 'super', 'advanced',
  'essential', 'complete', 'total', 'daily', 'made', 'high', 'low', 'great',
  'good', 'each', 'full', 'real', 'true', 'bulk', 'amazon', 'brand', 'review',
  'reddit', 'github', 'youtube', 'twitter', 'wirecutter', 'consumerlab',
  'labdoor', 'trustpilot', 'hackernews', 'news', 'issue', 'issues',
  'switched', 'tried', 'used', 'bought', 'found', 'started', 'recommend',
  'compared', 'tested', 'prefer', 'mentioned', 'using', 'bought', 'ordered',
  'returned', 'received', 'noticed', 'heard', 'read', 'looking', 'thinking',
  'considered', 'wanted', 'needed', 'like', 'love', 'hate', 'just', 'also',
  'really', 'very', 'much', 'been', 'have', 'had', 'was', 'were', 'will',
  'would', 'could', 'should', 'might', 'may', 'can', 'did', 'does', 'than',
  'from', 'into', 'this', 'that', 'they', 'them', 'then', 'what', 'which',
  'where', 'when', 'how', 'why', 'but', 'not', 'any', 'some', 'other',
  'after', 'before', 'about', 'over', 'only', 'most', 'same', 'both',
  'here', 'there', 'even', 'still', 'back', 'down', 'well', 'way', 'own'
]);

function sleep(ms) {
  return new Promise(resolveFn => setTimeout(resolveFn, ms));
}

function log(msg) {
  process.stderr.write(`[research] ${msg}\n`);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function truncate(str, max) {
  if (!str) return '';
  return str.length <= max ? str : `${str.slice(0, max)}...`;
}

function cleanupText(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function slugify(str, maxLen = 60) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniq(arr) {
  return [...new Set(arr)];
}

function uniqBy(arr, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toDateOnly(value = new Date().toISOString()) {
  return String(value).split('T')[0];
}

function parseCompactNumber(str) {
  if (!str) return null;
  const raw = String(str).trim().replace(/,/g, '');
  const match = raw.match(/^([\d.]+)\s*([kKmMbB])?$/);
  if (!match) return null;
  const base = parseFloat(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2] ? match[2].toLowerCase() : '';
  const multiplier = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1;
  return Math.round(base * multiplier);
}

function formatCompactNumber(value) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  if (value >= 1e6) return `${round(value / 1e6, 1)}M`;
  if (value >= 1e3) return `${round(value / 1e3, 1)}k`;
  return String(value);
}

function safeHostname(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return '';
  }
}

function normalizeEntityKey(value) {
  return cleanupText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayNameForTerm(term) {
  return cleanupText(term)
    .split(/\s+/)
    .filter(Boolean)
    .map(token => {
      if (/[0-9-]/.test(token)) return token.toUpperCase();
      if (token.length <= 3) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');
}

function resetApiCalls() {
  resetSearchApiCalls();
  resetRedditApiCalls();
}

function getApiCost() {
  const searchCost = getSearchCost();
  const redditCalls = getRedditApiCalls();
  return {
    braveCalls: searchCost.braveCalls,
    ddgCalls: searchCost.ddgCalls || 0,
    redditCalls: redditCalls.total,
    totalCalls: searchCost.totalCalls + redditCalls.total,
    estimatedUSD: searchCost.estimatedUSD,
    searchProvider: searchCost.braveCalls > 0 ? 'brave' : searchCost.ddgCalls > 0 ? 'ddg' : 'none'
  };
}

function toApiCostSummary(cost) {
  return {
    brave: cost.braveCalls,
    ddg: cost.ddgCalls || 0,
    reddit: cost.redditCalls,
    total: cost.totalCalls,
    estimatedUSD: cost.estimatedUSD,
    searchProvider: cost.searchProvider || 'unknown'
  };
}

function logApiCost() {
  const cost = getApiCost();
  const provider = cost.searchProvider === 'ddg' ? ' (DDG fallback)' : '';
  log(`API calls: ${cost.braveCalls} Brave + ${cost.ddgCalls} DDG + ${cost.redditCalls} Reddit = ${cost.totalCalls} total${provider} | Est. cost: ~$${cost.estimatedUSD.toFixed(3)}`);
}

function cacheKey(query, category, depth, opts = {}) {
  const parts = [query, category, depth, SCHEMA_VERSION];
  if (opts.minScore != null) parts.push(`ms${opts.minScore}`);
  if (opts.compare) parts.push('cmp');
  if (opts.compareExplicit?.length) parts.push(`ce:${opts.compareExplicit.join('~')}`);
  return crypto.createHash('md5').update(parts.join('|')).digest('hex').slice(0, 12);
}

function cacheGet(query, category, depth, ttlMs, opts = {}) {
  const key = cacheKey(query, category, depth, opts);
  const file = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(file)) return null;

  try {
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    const age = Date.now() - new Date(entry.timestamp).getTime();
    if (age > ttlMs) return null;
    return entry.rawResult || null;
  } catch {
    return null;
  }
}

function cacheSet(query, category, depth, opts, rawResult) {
  ensureDir(CACHE_DIR);
  const key = cacheKey(query, category, depth, opts);
  const file = join(CACHE_DIR, `${key}.json`);
  const entry = {
    query,
    category,
    depth,
    schemaVersion: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    rawResult
  };
  writeFileSync(file, JSON.stringify(entry), 'utf8');
}

function cachePrune(ttlMs = CACHE_TTL_MS) {
  if (!existsSync(CACHE_DIR)) return 0;

  const files = readdirSync(CACHE_DIR).filter(file => file.endsWith('.json'));
  let pruned = 0;
  for (const file of files) {
    const filePath = join(CACHE_DIR, file);
    try {
      const entry = JSON.parse(readFileSync(filePath, 'utf8'));
      const age = Date.now() - new Date(entry.timestamp).getTime();
      if (age > ttlMs) {
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

function cacheClear() {
  if (!existsSync(CACHE_DIR)) return 0;
  const files = readdirSync(CACHE_DIR).filter(file => file.endsWith('.json'));
  for (const file of files) unlinkSync(join(CACHE_DIR, file));
  return files.length;
}

const SUBCOMMANDS = new Set(['cache', 'watchlist', 'feedback', 'status']);

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function saveConfig(data) {
  ensureDir(dirname(CONFIG_PATH));
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function parseArgs(argv) {
  const opts = {
    query: null,
    category: null,
    depth: 'standard',
    output: null,
    compare: false,
    compareExplicit: null,
    freshness: null,
    noCache: false,
    save: false,
    saveDir: null,
    minScore: null,
    format: 'structured',
    location: null,
    deep: false,
    budget: null,
    satisfaction: null,
    notes: null,
    brand: null,
    subcommand: null,
    subAction: null,
    subArgs: [],
    note: null
  };

  if (argv.length > 0 && SUBCOMMANDS.has(argv[0])) {
    opts.subcommand = argv[0];
    opts.subAction = argv[1] || null;
    let i = 2;
    while (i < argv.length) {
      const arg = argv[i];
      if (arg === '--note' && argv[i + 1]) {
        opts.note = argv[++i];
      } else if (arg === '--notes' && argv[i + 1]) {
        opts.notes = argv[++i];
      } else if (arg === '--category' && argv[i + 1]) {
        opts.category = argv[++i];
      } else if (arg === '--satisfaction' && argv[i + 1]) {
        opts.satisfaction = parseInt(argv[++i], 10);
      } else if (arg === '--brand' && argv[i + 1]) {
        opts.brand = argv[++i];
      } else if (arg === '--deep') {
        opts.deep = true;
      } else if (arg === '--budget' && argv[i + 1]) {
        opts.budget = parseInt(argv[++i], 10);
      } else if (!arg.startsWith('--')) {
        opts.subArgs.push(arg);
      }
      i++;
    }
    return opts;
  }

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
      if (
        argv[i + 1] && !argv[i + 1].startsWith('--') &&
        argv[i + 2] && !argv[i + 2].startsWith('--')
      ) {
        opts.compareExplicit = [argv[i + 1], argv[i + 2]];
        i += 2;
      }
    } else if (arg === '--freshness') {
      opts.freshness = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '.';
    } else if (arg === '--no-cache') {
      opts.noCache = true;
    } else if (arg === '--save') {
      opts.save = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        opts.saveDir = argv[++i];
      }
    } else if (arg === '--min-score' && argv[i + 1]) {
      opts.minScore = parseInt(argv[++i], 10);
    } else if (arg === '--format' && argv[i + 1]) {
      opts.format = argv[++i];
    } else if (arg === '--raw') {
      opts.format = 'raw';
    } else if (arg === '--format' && argv[i + 1] === 'json') {
      opts.format = 'json';
      i++;
    } else if (arg === '--location' && argv[i + 1]) {
      opts.location = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      // handled in main
    } else if (!arg.startsWith('--') && !opts.query) {
      opts.query = arg;
    }

    i++;
  }

  return opts;
}

function detectCategory(query) {
  const q = String(query || '').toLowerCase();
  let best = 'product';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (q.includes(keyword)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }

  return best;
}

function validateCategory(category) {
  if (!category) return null;
  if (SUPPORTED_CATEGORIES.has(category)) return null;
  if (UNSUPPORTED_CATEGORY_MESSAGES[category]) return UNSUPPORTED_CATEGORY_MESSAGES[category];
  return `Error: invalid category "${category}". Use product|supplement|restaurant|service|software|tech.`;
}

// braveSearch, fetchText, extractRedditIds, parseCommentTree, fetchRedditThread
// moved to lib/search.js and lib/reddit.js

async function braveSearch(query, count = 5) {
  const result = await search(query, count);
  return result.results || [];
}

async function fetchText(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': REDDIT_UA,
        ...headers
      }
    });
  } catch (err) {
    log(`Fetch failed for ${url}: ${err.message}`);
    return '';
  }

  if (!res.ok) {
    log(`Fetch ${res.status} for ${url}`);
    return '';
  }

  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function searchReddit(query, category = 'product', maxThreads = 3, minScore = null) {
  const subreddits = CATEGORY_SUBREDDITS[category] || CATEGORY_SUBREDDITS.product;
  const searches = [braveSearch(`${query} review site:reddit.com`, 5)];

  if (subreddits.length > 0) {
    const subScope = subreddits.slice(0, 2).map(sub => `site:reddit.com/r/${sub}`).join(' OR ');
    searches.push(braveSearch(`${query} (${subScope})`, 3));
  }

  const allResults = (await Promise.all(searches)).flat();
  const unique = uniqBy(
    allResults.filter(result => extractRedditIds(result.url)),
    result => extractRedditIds(result.url).postId
  );

  const threads = [];
  for (const result of unique.slice(0, maxThreads)) {
    log(`Reddit: ${truncate(result.title, 70)}`);
    const thread = await fetchRedditThread(result.url);
    if (!thread || thread.commentCount === 0) continue;

    if (minScore != null) {
      const before = thread.comments.length;
      thread.comments = thread.comments.filter(comment => comment.score >= minScore);
      thread.commentCount = thread.comments.length;
      const filtered = before - thread.commentCount;
      if (filtered > 0) {
        log(`Filtered ${filtered} comments below score ${minScore} (${thread.commentCount} remaining)`);
      }
    }

    if (thread.commentCount > 0) threads.push(thread);
  }

  return { threads };
}

async function searchAmazon(query) {
  const results = await braveSearch(`${query} site:amazon.com`, 5);
  const products = results
    .filter(result => result.url.includes('amazon.com') && (result.url.includes('/dp/') || result.url.includes('/gp/')))
    .map(result => {
      const ratingMatch = result.snippet.match(/(\d\.?\d?)\s*out of\s*5\s*stars?/i);
      const reviewMatch = result.snippet.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
      const priceMatch = result.snippet.match(/\$(\d+\.?\d{0,2})/);

      return {
        title: cleanupText(result.title.replace(/ - Amazon\.com.*$/i, '').replace(/^Amazon\.com:\s*/i, '')),
        url: result.url,
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ''), 10) : null,
        price: priceMatch ? parseFloat(priceMatch[1]) : null,
        snippet: cleanupText(result.snippet)
      };
    });

  return { products: uniqBy(products, product => product.url) };
}

async function searchWeb(query, sites = []) {
  const siteScope = sites.length > 0 ? sites.map(site => `site:${site}`).join(' OR ') : '';
  const fullQuery = siteScope ? `${query} (${siteScope})` : query;
  const results = await braveSearch(fullQuery, 5);
  return { results: uniqBy(results, result => result.url) };
}

function normalizeGitHubRepoUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    if (['issues', 'pulls', 'actions', 'releases', 'wiki'].includes(parts[2])) return null;
    if (parts[0] === 'topics' || parts[0] === 'search') return null;
    return `https://github.com/${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

function parseGitHubRepoMetrics(html) {
  const starPatterns = [
    /"stargazerCount":\s*(\d+)/i,
    /aria-label="([\d,.kKmMbB]+)\s+stars"/i,
    />\s*([\d,.kKmMbB]+)\s*stars?\s*</i
  ];
  const issuePatterns = [
    /"issues":\{"totalCount":(\d+)/i,
    /"openIssuesCount":\s*(\d+)/i,
    /Issues\s*([\d,.kKmMbB]+)/i
  ];
  const closedIssuePatterns = [
    /"closedIssuesCount":\s*(\d+)/i,
    /Closed\s*([\d,.kKmMbB]+)\s*issues/i
  ];

  let stars = null;
  for (const pattern of starPatterns) {
    const match = html.match(pattern);
    if (match) {
      stars = parseCompactNumber(match[1]);
      if (stars != null) break;
    }
  }

  let openIssues = null;
  for (const pattern of issuePatterns) {
    const match = html.match(pattern);
    if (match) {
      openIssues = parseCompactNumber(match[1]);
      if (openIssues != null) break;
    }
  }

  let closedIssues = null;
  for (const pattern of closedIssuePatterns) {
    const match = html.match(pattern);
    if (match) {
      closedIssues = parseCompactNumber(match[1]);
      if (closedIssues != null) break;
    }
  }

  const commitMatch = html.match(/<relative-time[^>]*datetime="([^"]+)"/i);
  return {
    stars,
    openIssues,
    closedIssues,
    lastCommitDate: commitMatch ? commitMatch[1] : null
  };
}

async function fetchGitHubRepo(repoUrl, searchResult = {}) {
  const html = await fetchText(repoUrl, {
    'Accept': 'text/html',
    'User-Agent': REDDIT_UA
  });

  const url = new URL(repoUrl);
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  const metrics = html ? parseGitHubRepoMetrics(html) : {};

  return {
    name: displayNameForTerm(repo.replace(/[-_]+/g, ' ')),
    owner,
    repo,
    url: repoUrl,
    description: cleanupText(searchResult.snippet || ''),
    stars: metrics.stars ?? null,
    openIssues: metrics.openIssues ?? null,
    closedIssues: metrics.closedIssues ?? null,
    lastCommitDate: metrics.lastCommitDate ?? null
  };
}

async function searchGitHub(query, compareExplicit = [], limit = 3) {
  const searchTerms = uniq(
    [...(compareExplicit || []), query]
      .map(term => cleanupText(term))
      .filter(Boolean)
  ).slice(0, compareExplicit?.length ? 3 : 1);

  const searchResults = [];
  for (const term of searchTerms) {
    const results = await braveSearch(`${term} site:github.com`, 5);
    searchResults.push(...results);
  }

  const repoResults = [];
  const seen = new Set();
  for (const result of searchResults) {
    const repoUrl = normalizeGitHubRepoUrl(result.url);
    if (!repoUrl || seen.has(repoUrl)) continue;
    seen.add(repoUrl);
    repoResults.push(result);
  }

  const repos = [];
  for (const result of repoResults.slice(0, limit)) {
    log(`GitHub: ${truncate(result.title, 70)}`);
    repos.push(await fetchGitHubRepo(normalizeGitHubRepoUrl(result.url), result));
  }

  return { repos };
}

function mergeThreadSets(sets) {
  const threads = uniqBy(
    sets.flatMap(set => set?.threads || []),
    thread => thread.url
  );
  return { threads };
}

function mergeProductSets(sets) {
  return {
    products: uniqBy(
      sets.flatMap(set => set?.products || []),
      product => product.url
    )
  };
}

function mergeResultSets(sets, key = 'results') {
  return {
    [key]: uniqBy(
      sets.flatMap(set => set?.[key] || []),
      item => item.url
    )
  };
}

function buildEmptyRawResult(query, category, depth) {
  return {
    query,
    category,
    depth,
    timestamp: new Date().toISOString(),
    reddit: { threads: [], totalComments: 0 },
    amazon: { products: [] },
    web: { results: [] },
    youtube: { results: [] },
    twitter: { results: [] },
    github: { repos: [] },
    alternatives: [],
    priceData: [],
    comparison: null,
    freshness: null,
    dataSufficiency: 'LOW',
    sourceCount: { reddit: 0, amazon: 0, web: 0, youtube: 0, twitter: 0, github: 0 },
    apiCost: null
  };
}

function inferSourceTypeFromWebResult(result) {
  const host = safeHostname(result.url);
  if (host.includes('news.ycombinator.com')) return 'hn';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('github.com')) return 'github';
  if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
  return 'expert';
}

function calcDataSufficiency(raw) {
  const redditCount = raw.reddit?.threads?.length || 0;
  const totalComments = (raw.reddit?.threads || []).reduce((sum, thread) => sum + thread.commentCount, 0);

  const sourceTypes = new Set();
  if (redditCount > 0) sourceTypes.add('reddit');
  if ((raw.amazon?.products?.length || 0) > 0) sourceTypes.add('amazon');
  if ((raw.web?.results?.length || 0) > 0) sourceTypes.add('web');
  if ((raw.youtube?.results?.length || 0) > 0) sourceTypes.add('youtube');
  if ((raw.twitter?.results?.length || 0) > 0) sourceTypes.add('twitter');
  if ((raw.github?.repos?.length || 0) > 0) sourceTypes.add('github');

  const otherSourceCount = sourceTypes.size - (sourceTypes.has('reddit') ? 1 : 0);

  if (redditCount >= 3 && totalComments >= 20 && otherSourceCount >= 2) return 'HIGH';
  if ((redditCount >= 1 || totalComments >= 10) && otherSourceCount >= 1) return 'MEDIUM';
  if ((raw.github?.repos?.length || 0) > 0 && otherSourceCount >= 1) return 'MEDIUM';
  return 'LOW';
}

function buildPriceData(products) {
  return products
    .filter(product => product.price)
    .map(product => ({
      brand: extractBrandsFromAmazon([product])[0] || cleanupText(product.title.split(/\s+/).slice(0, 2).join(' ')),
      title: product.title,
      price: product.price,
      rating: product.rating,
      reviewCount: product.reviewCount
    }));
}

function extractBrandsFromAmazon(products) {
  const brands = new Map();

  for (const product of products) {
    const words = cleanupText(product.title).split(/\s+/);
    if (words.length < 2) continue;

    const first = words[0];
    if (!first || first.length < 2 || !/^[A-Z0-9]/.test(first)) continue;
    if (BRAND_BLACKLIST.has(first.toLowerCase())) continue;

    const second = words[1];
    const twoWord =
      second &&
      /^[A-Z0-9]/.test(second) &&
      second.length > 1 &&
      !BRAND_BLACKLIST.has(second.toLowerCase());

    if (twoWord) brands.set(`${first} ${second}`.toLowerCase(), `${first} ${second}`);
    if (first === first.toUpperCase() || first.length >= 4) brands.set(first.toLowerCase(), first);
  }

  return [...brands.values()];
}

function extractCompareTermsFromQuery(query) {
  const parts = String(query || '')
    .split(/\b(?:vs|versus)\b/i)
    .map(part => cleanupText(part))
    .filter(Boolean);

  if (parts.length === 2) return parts.map(displayNameForTerm);
  return [];
}

const LOCATION_DEPENDENT_CATEGORIES = new Set(['restaurant', 'service']);

function resolveLocation(opts) {
  if (opts.location) return opts.location;
  const config = loadConfig();
  if (config.defaultLocation) {
    return typeof config.defaultLocation === 'string'
      ? config.defaultLocation
      : config.defaultLocation.city
        ? `${config.defaultLocation.city}${config.defaultLocation.state ? ', ' + config.defaultLocation.state : ''}`
        : null;
  }
  return null;
}

function locationScopedQuery(query, location) {
  if (!location) return query;
  return `${query} ${location}`;
}

async function collectRawData(query, opts) {
  const category = opts.category || detectCategory(query);
  const depth = opts.depth || 'standard';
  const minScore = opts.minScore ?? null;
  const raw = buildEmptyRawResult(query, category, depth);

  // Geographic awareness
  const location = LOCATION_DEPENDENT_CATEGORIES.has(category) ? resolveLocation(opts) : (opts.location || null);
  if (LOCATION_DEPENDENT_CATEGORIES.has(category) && !location) {
    log(`Warning: location-dependent category "${category}" without location — results may be generic`);
  }
  raw.location = location || null;

  const compareTerms = opts.compareExplicit?.length === 2
    ? opts.compareExplicit.map(cleanupText)
    : [];
  const compareMode = Boolean(opts.compare && compareTerms.length === 2);
  const baseQuery = compareMode ? `${compareTerms[0]} vs ${compareTerms[1]}` : query;
  const focusQuery = location ? locationScopedQuery(baseQuery, location) : baseQuery;
  const maxRedditThreads = depth === 'quick' ? 1 : 3;

  log(`Query: "${query}" | category: ${category} | depth: ${depth}${location ? ` | location: ${location}` : ''}`);

  log('Searching Reddit...');
  try {
    if (compareMode) {
      const redditSets = [];
      for (const searchQuery of uniq([focusQuery, ...compareTerms])) {
        redditSets.push(await searchReddit(searchQuery, category, 1, minScore));
      }
      raw.reddit = mergeThreadSets(redditSets);
    } else {
      raw.reddit = await searchReddit(focusQuery, category, maxRedditThreads, minScore);
    }
    raw.reddit.totalComments = raw.reddit.threads.reduce((sum, thread) => sum + thread.commentCount, 0);
  } catch (err) {
    log(`Reddit failed: ${err.message}`);
  }

  const expertSites = CATEGORY_EXPERT_SITES[category] || CATEGORY_EXPERT_SITES.product;

  if (depth === 'quick') {
    log('Quick web search...');
    try {
      const webQuery = compareMode ? `${focusQuery} review` : `${focusQuery} review best`;
      raw.web = await searchWeb(webQuery);
    } catch (err) {
      log(`Web search failed: ${err.message}`);
    }
  } else if (compareMode) {
    log(`Searching Amazon + expert sites (${expertSites.join(', ')})...`);
    try {
      const amazonSets = [];
      for (const term of compareTerms) {
        amazonSets.push(await searchAmazon(term));
      }
      raw.amazon = mergeProductSets(amazonSets);
    } catch (err) {
      log(`Amazon failed: ${err.message}`);
    }

    try {
      const webSets = [];
      for (const searchQuery of uniq([`${focusQuery} review`, ...compareTerms.map(term => `${term} review`)])) {
        webSets.push(await searchWeb(searchQuery, expertSites));
      }
      raw.web = mergeResultSets(webSets, 'results');
    } catch (err) {
      log(`Web search failed: ${err.message}`);
    }
  } else {
    log(`Searching Amazon + expert sites (${expertSites.join(', ')})...`);
    const [amazonResult, webResult] = await Promise.all([
      searchAmazon(focusQuery).catch(err => {
        log(`Amazon failed: ${err.message}`);
        return { products: [] };
      }),
      searchWeb(`${focusQuery} review`, expertSites).catch(err => {
        log(`Web failed: ${err.message}`);
        return { results: [] };
      })
    ]);

    raw.amazon = amazonResult;
    raw.web = webResult;
  }

  if (category === 'software' || category === 'tech') {
    log('Searching GitHub...');
    try {
      raw.github = await searchGitHub(focusQuery, compareTerms, depth === 'quick' ? 2 : 3);
    } catch (err) {
      log(`GitHub failed: ${err.message}`);
    }
  }

  if (depth === 'deep') {
    log('Searching YouTube...');
    try {
      raw.youtube = {
        results: await braveSearch(`${focusQuery} review site:youtube.com`, 5)
      };
    } catch (err) {
      log(`YouTube failed: ${err.message}`);
    }

    log('Searching Twitter/X complaints...');
    try {
      raw.twitter = {
        results: await braveSearch(`"${focusQuery}" (broken OR terrible OR worst OR disappointed OR refund) site:twitter.com OR site:x.com`, 5)
      };
    } catch (err) {
      log(`Twitter failed: ${err.message}`);
    }
  }

  raw.priceData = buildPriceData(raw.amazon.products);
  raw.sourceCount = {
    reddit: raw.reddit.threads.length,
    amazon: raw.amazon.products.length,
    web: raw.web.results.length,
    youtube: raw.youtube.results.length,
    twitter: raw.twitter.results.length,
    github: raw.github.repos.length
  };
  raw.dataSufficiency = calcDataSufficiency(raw);
  raw.apiCost = getApiCost();
  return raw;
}

function buildDimensionAliasEntries(category) {
  const aliases = {
    ...GLOBAL_DIMENSION_ALIASES,
    ...(CATEGORY_DIMENSION_ALIASES[category] || {})
  };
  return Object.entries(aliases).sort((a, b) => b[0].length - a[0].length);
}

function detectDimensions(text, category) {
  const normalized = cleanupText(text).toLowerCase();
  const dimensions = [];

  for (const [alias, dimension] of buildDimensionAliasEntries(category)) {
    if (normalized.includes(alias.toLowerCase())) dimensions.push(dimension);
  }

  if (/refund|returned|returning/i.test(text) && (category === 'product' || category === 'tech')) dimensions.push('durability');
  if (/recommend|best|worth it|go-to/i.test(text) && category === 'supplement') dimensions.push('value');
  if (/recommend|best|worth it|go-to/i.test(text) && category === 'software') dimensions.push('ux');

  return uniq(dimensions);
}

function inferFallbackDimension(text, category) {
  const normalized = cleanupText(text).toLowerCase();

  if (/stomach|nausea|headache|made me sick|side effect/.test(normalized)) return 'side-effects';
  if (/recall|contaminat|lead|quality/.test(normalized)) return 'quality';
  if (/broken|broke|stopped working|failed|return|refund|died/.test(normalized)) {
    if (category === 'software') return 'bugs';
    if (category === 'tech' || category === 'product') return 'durability';
    return 'quality';
  }
  if (/bug|bugs|crash|lag|slow|freeze/.test(normalized)) return 'bugs';
  if (/cheap|expensive|overpriced|price|pricing|cost|value/.test(normalized)) return category === 'software' ? 'pricing' : 'value';
  if (/comfortable|comfort/.test(normalized)) return 'comfort';
  if (/battery/.test(normalized)) return 'battery';
  if (/sound|anc|noise cancellation/.test(normalized)) return 'sound quality';
  if (/support|customer service/.test(normalized)) return 'support';
  if (/docs|documentation/.test(normalized)) return 'docs';
  if (/food|delicious|menu/.test(normalized)) return 'food';
  if (/service|staff/.test(normalized)) return 'service';
  if (/recommend|best|love|great|solid|excellent|amazing|perfect|reliable|favorite/.test(normalized)) return 'general';
  return 'other';
}

function detectPolarity(text) {
  const positive = POSITIVE_RE.test(text);
  const negative = NEGATIVE_RE.test(text);
  if (positive && negative) return 'mixed';
  if (positive) return 'positive';
  if (negative) return 'negative';
  return null;
}

function splitIntoSentences(text) {
  const normalized = cleanupText(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map(sentence => cleanupText(sentence))
    .filter(Boolean);
}

function generateEntityAliases(name) {
  const cleaned = cleanupText(name);
  if (!cleaned) return [];

  const aliases = new Set([cleaned]);
  const tokens = cleaned.split(/\s+/);
  if (tokens.length >= 2) aliases.add(tokens.slice(0, 2).join(' '));
  if (tokens.length >= 1) {
    const first = tokens[0];
    if (!BRAND_BLACKLIST.has(first.toLowerCase()) && first.length > 2) aliases.add(first);
  }

  for (const token of tokens) {
    if (/[0-9-]/.test(token) && token.length > 2) aliases.add(token);
  }

  return [...aliases]
    .map(alias => cleanupText(alias))
    .filter(alias => alias.length > 1);
}

function addCatalogEntry(catalog, canonical, aliases = []) {
  const cleanedCanonical = cleanupText(canonical);
  const key = normalizeEntityKey(cleanedCanonical);
  if (!key || key.length < 2) return;

  const existing = catalog.get(key) || {
    canonical: cleanedCanonical,
    aliases: new Set()
  };

  if (cleanedCanonical.length > existing.canonical.length) existing.canonical = cleanedCanonical;
  for (const alias of [...generateEntityAliases(cleanedCanonical), ...aliases]) {
    const normalizedAlias = normalizeEntityKey(alias);
    if (!normalizedAlias || normalizedAlias.length < 2) continue;
    const tokens = normalizedAlias.split(' ');
    if (tokens.every(token => BRAND_BLACKLIST.has(token))) continue;
    existing.aliases.add(cleanupText(alias));
  }

  if (existing.aliases.size > 0) catalog.set(key, existing);
}

function extractCapitalizedCandidates(text) {
  const matches = cleanupText(text).match(/\b(?:[A-Z][A-Za-z0-9+-]+(?:\s+[A-Z0-9][A-Za-z0-9+-]+){0,2}|[A-Z]{2,}(?:\s+[A-Z0-9][A-Za-z0-9+-]+){0,2})\b/g) || [];
  return uniq(matches.filter(candidate => {
    const normalized = normalizeEntityKey(candidate);
    if (!normalized) return false;
    const tokens = normalized.split(' ');
    if (tokens.every(token => BRAND_BLACKLIST.has(token))) return false;
    return tokens.join('').length >= 3;
  }));
}

function buildEntityCatalog(raw, compareExplicit, brandIntel) {
  const catalog = new Map();

  for (const brand of Object.keys(brandIntel.brands || {})) {
    addCatalogEntry(catalog, brand);
  }

  for (const brand of extractBrandsFromAmazon(raw.amazon.products || [])) {
    addCatalogEntry(catalog, brand);
  }

  for (const repo of raw.github?.repos || []) {
    addCatalogEntry(catalog, repo.name, [repo.repo, repo.owner]);
  }

  for (const item of compareExplicit || []) {
    addCatalogEntry(catalog, item);
  }

  for (const term of extractCompareTermsFromQuery(raw.query)) {
    addCatalogEntry(catalog, term);
  }

  const textSources = [
    ...(raw.reddit?.threads || []).flatMap(thread => [thread.title, thread.selftext, ...thread.comments.map(comment => comment.body)]),
    ...(raw.web?.results || []).flatMap(result => [result.title, result.snippet]),
    ...(raw.amazon?.products || []).flatMap(product => [product.title, product.snippet]),
    ...(raw.youtube?.results || []).flatMap(result => [result.title, result.snippet]),
    ...(raw.twitter?.results || []).flatMap(result => [result.title, result.snippet])
  ];

  for (const text of textSources) {
    for (const candidate of extractCapitalizedCandidates(text)) {
      addCatalogEntry(catalog, candidate);
    }
  }

  return catalog;
}

function buildAliasIndex(catalog) {
  const aliases = [];
  for (const entry of catalog.values()) {
    for (const alias of entry.aliases) {
      aliases.push({
        canonical: entry.canonical,
        alias,
        normalized: normalizeEntityKey(alias)
      });
    }
  }
  aliases.sort((a, b) => b.normalized.length - a.normalized.length);
  return aliases;
}

function findEntityMatches(text, aliasIndex) {
  const normalizedText = normalizeEntityKey(text);
  if (!normalizedText) return [];

  const matches = [];
  const seenCanonical = new Set();
  for (const entry of aliasIndex) {
    if (seenCanonical.has(entry.canonical)) continue;
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(entry.normalized)}(?=\\s|$)`, 'i');
    const match = normalizedText.match(pattern);
    if (!match) continue;
    seenCanonical.add(entry.canonical);
    matches.push({
      canonical: entry.canonical,
      alias: entry.alias,
      index: match.index || 0
    });
  }

  return matches.sort((a, b) => a.index - b.index);
}

function buildClaim(meta, brand, dimension, polarity, quote, overrides = {}) {
  return {
    brand: brand || null,
    dimension: dimension || 'other',
    polarity: polarity || 'mixed',
    sourceType: meta.sourceType,
    sourceId: meta.sourceId,
    independentSourceId: meta.independentSourceId,
    subreddit: meta.subreddit || null,
    score: meta.score ?? null,
    scoreKind: meta.scoreKind || null,
    quote: truncate(cleanupText(quote), MAX_CLAIM_QUOTE_LENGTH),
    url: meta.url || null,
    ...overrides
  };
}

function extractComparativeClaims(sentence, matches, meta) {
  if (matches.length < 2) return [];

  const ordered = matches.slice().sort((a, b) => a.index - b.index);
  const lower = sentence.toLowerCase();
  const dimension = detectDimensions(sentence, meta.category)[0] || inferFallbackDimension(sentence, meta.category);

  const beforeIndex = index => {
    let winner = null;
    for (const match of ordered) {
      if (match.index < index) winner = match;
    }
    return winner;
  };

  const afterIndex = index => ordered.find(match => match.index > index) || null;

  const betterIdx = lower.indexOf('better than');
  if (betterIdx !== -1) {
    const winner = beforeIndex(betterIdx);
    const loser = afterIndex(betterIdx);
    if (winner && loser && winner.canonical !== loser.canonical) {
      return [
        buildClaim(meta, winner.canonical, dimension, 'positive', sentence),
        buildClaim(meta, loser.canonical, dimension, 'negative', sentence)
      ];
    }
  }

  const preferIdx = lower.indexOf('prefer ');
  const overIdx = lower.indexOf(' over ');
  if (preferIdx !== -1 && overIdx !== -1) {
    const winner = beforeIndex(overIdx);
    const loser = afterIndex(overIdx);
    if (winner && loser && winner.canonical !== loser.canonical) {
      return [
        buildClaim(meta, winner.canonical, dimension, 'positive', sentence),
        buildClaim(meta, loser.canonical, dimension, 'negative', sentence)
      ];
    }
  }

  const fromIdx = lower.indexOf('switched from');
  const toIdx = lower.indexOf('switched to');
  if (fromIdx !== -1 && toIdx !== -1) {
    const loser = afterIndex(fromIdx);
    const winner = afterIndex(toIdx);
    if (winner && loser && winner.canonical !== loser.canonical) {
      return [
        buildClaim(meta, winner.canonical, dimension, 'positive', sentence),
        buildClaim(meta, loser.canonical, dimension, 'negative', sentence)
      ];
    }
  }

  return [];
}

function extractClaimsFromText(meta) {
  const text = cleanupText(meta.text);
  if (!text) return [];

  const claims = [];
  for (const sentence of splitIntoSentences(text)) {
    const matches = findEntityMatches(sentence, meta.aliasIndex);
    const comparativeClaims = extractComparativeClaims(sentence, matches, meta);
    if (comparativeClaims.length > 0) {
      claims.push(...comparativeClaims);
      continue;
    }

    const polarity = detectPolarity(sentence);
    const dimensions = detectDimensions(sentence, meta.category);
    if (!polarity && dimensions.length === 0) continue;

    const normalizedDimensions = dimensions.length > 0
      ? dimensions
      : [inferFallbackDimension(sentence, meta.category)];

    if (matches.length === 0) {
      for (const dimension of normalizedDimensions) {
        claims.push(buildClaim(meta, null, dimension, polarity || 'mixed', sentence));
      }
      continue;
    }

    const targetBrands = matches.map(m => m.canonical);
    for (const brand of targetBrands) {
      for (const dimension of normalizedDimensions) {
        claims.push(buildClaim(meta, brand, dimension, polarity || 'mixed', sentence));
      }
    }
  }

  return claims;
}

function dedupeClaims(claims) {
  const seen = new Map();
  for (const claim of claims) {
    const key = [
      claim.brand || '',
      claim.dimension,
      claim.polarity,
      claim.sourceId
    ].join('|');
    const existing = seen.get(key);
    if (!existing || (claim.score ?? -Infinity) > (existing.score ?? -Infinity)) {
      seen.set(key, claim);
    }
  }
  return [...seen.values()];
}

function extractGitHubClaims(repos, aliasIndex, category) {
  const claims = [];

  for (const repo of repos || []) {
    const matchText = [repo.name, repo.repo, repo.owner, repo.description].filter(Boolean).join(' ');
    const brand = findEntityMatches(matchText, aliasIndex)[0]?.canonical || repo.name;
    const baseMeta = {
      sourceType: 'github',
      sourceId: repo.url,
      independentSourceId: repo.url,
      score: repo.stars,
      scoreKind: 'stars',
      url: repo.url,
      category
    };

    if (repo.stars != null) {
      const quote = `${brand} shows ${formatCompactNumber(repo.stars)} GitHub stars` +
        (repo.openIssues != null ? ` and ${formatCompactNumber(repo.openIssues)} open issues` : '');
      claims.push(buildClaim(baseMeta, brand, 'adoption', 'positive', quote));
    }

    if (repo.lastCommitDate) {
      const daysSinceCommit = Math.floor((Date.now() - new Date(repo.lastCommitDate).getTime()) / 86400000);
      if (Number.isFinite(daysSinceCommit)) {
        if (daysSinceCommit <= 90) {
          claims.push(buildClaim(baseMeta, brand, 'maintenance', 'positive', `${brand} has recent GitHub activity (${daysSinceCommit} days since last visible commit)`));
        } else if (daysSinceCommit >= 365) {
          claims.push(buildClaim(baseMeta, brand, 'maintenance', 'negative', `${brand} looks stale on GitHub (${daysSinceCommit} days since last visible commit)`));
        }
      }
    }
  }

  return claims;
}

function extractClaims(raw, brandIntel, opts) {
  const catalog = buildEntityCatalog(raw, opts.compareExplicit || [], brandIntel);
  const aliasIndex = buildAliasIndex(catalog);
  const claims = [];

  for (const thread of raw.reddit?.threads || []) {
    const threadId = thread.url || `reddit:${thread.postId || thread.subreddit}`;
    const postText = [thread.title, thread.selftext].filter(Boolean).join('. ');
    if (postText) {
      claims.push(...extractClaimsFromText({
        text: postText,
        sourceType: 'reddit',
        sourceId: `${threadId}#post`,
        independentSourceId: threadId,
        subreddit: `r/${thread.subreddit}`,
        score: thread.upvotes,
        scoreKind: 'upvotes',
        url: thread.url,
        category: raw.category,
        aliasIndex
      }));
    }

    thread.comments.forEach((comment, index) => {
      claims.push(...extractClaimsFromText({
        text: comment.body,
        sourceType: 'reddit',
        sourceId: `${threadId}#${comment.id || index}`,
        independentSourceId: threadId,
        subreddit: `r/${thread.subreddit}`,
        score: comment.score,
        scoreKind: 'upvotes',
        url: thread.url,
        category: raw.category,
        aliasIndex
      }));
    });
  }

  for (const product of raw.amazon?.products || []) {
    claims.push(...extractClaimsFromText({
      text: [product.title, product.snippet].filter(Boolean).join('. '),
      sourceType: 'amazon',
      sourceId: product.url,
      independentSourceId: product.url,
      score: product.rating,
      scoreKind: 'stars',
      url: product.url,
      category: raw.category,
      aliasIndex
    }));
  }

  for (const result of raw.web?.results || []) {
    const sourceType = inferSourceTypeFromWebResult(result);
    claims.push(...extractClaimsFromText({
      text: [result.title, result.snippet].filter(Boolean).join('. '),
      sourceType,
      sourceId: result.url,
      independentSourceId: result.url,
      score: null,
      scoreKind: null,
      url: result.url,
      category: raw.category,
      aliasIndex
    }));
  }

  for (const result of raw.youtube?.results || []) {
    claims.push(...extractClaimsFromText({
      text: [result.title, result.snippet].filter(Boolean).join('. '),
      sourceType: 'youtube',
      sourceId: result.url,
      independentSourceId: result.url,
      score: null,
      scoreKind: null,
      url: result.url,
      category: raw.category,
      aliasIndex
    }));
  }

  for (const result of raw.twitter?.results || []) {
    claims.push(...extractClaimsFromText({
      text: [result.title, result.snippet].filter(Boolean).join('. '),
      sourceType: 'twitter',
      sourceId: result.url,
      independentSourceId: result.url,
      score: null,
      scoreKind: null,
      url: result.url,
      category: raw.category,
      aliasIndex
    }));
  }

  claims.push(...extractGitHubClaims(raw.github?.repos || [], aliasIndex, raw.category));

  return {
    claims: dedupeClaims(claims),
    catalog
  };
}

function chooseMajorityPolarity(positiveCount, negativeCount, mixedCount) {
  if (positiveCount === negativeCount && positiveCount === 0 && mixedCount > 0) return 'mixed';
  if (positiveCount === negativeCount && positiveCount > 0) return 'mixed';
  if (positiveCount > negativeCount && positiveCount >= mixedCount) return 'positive';
  if (negativeCount > positiveCount && negativeCount >= mixedCount) return 'negative';
  return 'mixed';
}

function buildSignalGroup(groupClaims, brand, dimension) {
  const claims = groupClaims.slice().sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const positiveCount = claims.filter(claim => claim.polarity === 'positive').length;
  const negativeCount = claims.filter(claim => claim.polarity === 'negative').length;
  const mixedCount = claims.filter(claim => claim.polarity === 'mixed').length;
  const polarity = chooseMajorityPolarity(positiveCount, negativeCount, mixedCount);
  const majorityCount = Math.max(positiveCount, negativeCount, mixedCount, 1);
  const independentClaims = uniqBy(claims, claim => claim.independentSourceId || claim.sourceId);
  const frequency = independentClaims.length;

  return {
    brand,
    dimension,
    polarity,
    positiveCount,
    negativeCount,
    mixedCount,
    frequency,
    sourceTypes: independentClaims.map(claim => claim.sourceType),
    convergence: round(majorityCount / claims.length, 2),
    claims
  };
}

function groupThemes(claims) {
  const grouped = new Map();
  const weakSignals = [];

  for (const claim of claims) {
    if (!claim.brand) {
      weakSignals.push(buildSignalGroup([claim], null, claim.dimension));
      continue;
    }

    const key = `${claim.brand}::${claim.dimension}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(claim);
  }

  const themes = [];
  for (const [key, groupClaims] of grouped.entries()) {
    const [brand, dimension] = key.split('::');
    const signalGroup = buildSignalGroup(groupClaims, brand, dimension);
    if (signalGroup.frequency >= 2) themes.push(signalGroup);
    else weakSignals.push(signalGroup);
  }

  themes.sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    if (b.convergence !== a.convergence) return b.convergence - a.convergence;
    return a.brand.localeCompare(b.brand);
  });

  weakSignals.sort((a, b) => {
    const aScore = (a.claims?.[0]?.score ?? 0);
    const bScore = (b.claims?.[0]?.score ?? 0);
    return bScore - aScore;
  });

  return { themes, weakSignals };
}

function buildCrossBrandThemes(themes) {
  const byDimension = new Map();

  for (const theme of themes) {
    if (!byDimension.has(theme.dimension)) byDimension.set(theme.dimension, []);
    byDimension.get(theme.dimension).push(theme);
  }

  const crossBrandThemes = [];
  for (const [dimension, dimensionThemes] of byDimension.entries()) {
    const brands = uniq(dimensionThemes.map(theme => theme.brand));
    if (brands.length < 2) continue;

    const polarityCounts = {
      positive: dimensionThemes.filter(theme => theme.polarity === 'positive').length,
      negative: dimensionThemes.filter(theme => theme.polarity === 'negative').length,
      mixed: dimensionThemes.filter(theme => theme.polarity === 'mixed').length
    };

    const polarity = chooseMajorityPolarity(
      polarityCounts.positive,
      polarityCounts.negative,
      polarityCounts.mixed
    );

    crossBrandThemes.push({
      dimension,
      polarity,
      brands,
      mentions: dimensionThemes.reduce((sum, theme) => sum + theme.frequency, 0),
      summary: `${dimension} keeps surfacing across ${brands.length} brands in this query`
    });
  }

  crossBrandThemes.sort((a, b) => b.mentions - a.mentions);
  return crossBrandThemes;
}

function severityFamilyForDimension(dimension) {
  return DIMENSION_SEVERITY_FAMILY[dimension] || 'other';
}

function trustLevelFromSentiment(sentiment) {
  if (sentiment === 'positive') return 'high';
  if (sentiment === 'negative') return 'low';
  if (sentiment === 'flagged') return 'caution';
  return 'medium';
}

function summarizeTheme(theme) {
  const topClaim = theme.claims?.[0];
  if (topClaim?.quote) return topClaim.quote;
  return `${theme.dimension} signal across ${theme.frequency} sources`;
}

function buildBrandSignals(themes, claims, priorIntel) {
  const byBrand = new Map();

  for (const claim of claims) {
    if (!claim.brand) continue;
    if (!byBrand.has(claim.brand)) {
      byBrand.set(claim.brand, {
        brand: claim.brand,
        mentionSources: new Set(),
        claimCount: 0,
        positiveClaimCount: 0,
        negativeClaimCount: 0,
        mixedClaimCount: 0,
        themes: [],
        flags: []
      });
    }

    const entry = byBrand.get(claim.brand);
    entry.claimCount++;
    entry.mentionSources.add(claim.independentSourceId || claim.sourceId);
    if (claim.polarity === 'positive') entry.positiveClaimCount++;
    else if (claim.polarity === 'negative') entry.negativeClaimCount++;
    else entry.mixedClaimCount++;
  }

  for (const theme of themes) {
    if (!byBrand.has(theme.brand)) continue;
    const entry = byBrand.get(theme.brand);
    entry.themes.push({
      dimension: theme.dimension,
      polarity: theme.polarity,
      frequency: theme.frequency,
      convergence: theme.convergence,
      severity: SEVERITY_RANK[severityFamilyForDimension(theme.dimension)] || 1,
      summary: summarizeTheme(theme)
    });
    if (theme.polarity === 'negative' && theme.frequency >= 2) {
      entry.flags.push(`${theme.dimension}: ${summarizeTheme(theme)}`);
    }
  }

  const brandSignals = [];
  for (const entry of byBrand.values()) {
    const prior = priorIntel.get(entry.brand) || null;
    const themePositive = entry.themes.filter(theme => theme.polarity === 'positive').length;
    const themeNegative = entry.themes.filter(theme => theme.polarity === 'negative').length;

    let sentiment = 'mixed';
    if (entry.flags.length > 0 && entry.themes.some(theme => severityFamilyForDimension(theme.dimension) === 'safety')) {
      sentiment = 'flagged';
    } else if (themePositive > themeNegative) {
      sentiment = 'positive';
    } else if (themeNegative > themePositive) {
      sentiment = 'negative';
    }

    brandSignals.push({
      brand: entry.brand,
      sentiment,
      mentions: entry.claimCount,
      independentSources: entry.mentionSources.size,
      flags: entry.flags,
      trustLevel: prior?.trustLevel || trustLevelFromSentiment(sentiment),
      themes: entry.themes.sort((a, b) => b.frequency - a.frequency),
      priorIntel: prior ? {
        trustLevel: prior.trustLevel,
        lastUpdated: prior.lastUpdated || null
      } : null
    });
  }

  brandSignals.sort((a, b) => {
    if (b.mentions !== a.mentions) return b.mentions - a.mentions;
    return a.brand.localeCompare(b.brand);
  });

  return brandSignals;
}

function agreementMultiplier(frequency) {
  if (frequency >= 3) return 1;
  if (frequency === 2) return 0.5;
  return 0;
}

function positiveThemeBonus(theme) {
  let bonus = theme.frequency >= 3 ? 0.5 : 0.25;
  if (['testing', 'purity', 'maintenance', 'adoption'].includes(theme.dimension) && theme.frequency >= 3) {
    bonus += 0.25;
  }
  return bonus;
}

function negativeThemePenalty(theme) {
  const family = severityFamilyForDimension(theme.dimension);
  const weight = NEGATIVE_SCORE_WEIGHTS[family] || NEGATIVE_SCORE_WEIGHTS.other;
  return weight * agreementMultiplier(theme.frequency);
}

function themeToReasoning(theme) {
  return {
    dimension: theme.dimension,
    convergence: theme.convergence,
    sources: theme.frequency,
    summary: summarizeTheme(theme)
  };
}

function computeDraftScore(themes, brandSignals, dataSufficiency) {
  const byBrand = new Map();
  for (const signal of brandSignals) {
    byBrand.set(signal.brand, {
      brand: signal.brand,
      score: 5,
      positiveThemes: [],
      negativeThemes: [],
      disqualifiers: []
    });
  }

  for (const theme of themes) {
    if (!byBrand.has(theme.brand)) continue;
    const entry = byBrand.get(theme.brand);

    if (theme.polarity === 'positive') {
      entry.score += positiveThemeBonus(theme);
      entry.positiveThemes.push(theme);
    } else if (theme.polarity === 'negative') {
      entry.score -= negativeThemePenalty(theme);
      entry.negativeThemes.push(theme);
      if (severityFamilyForDimension(theme.dimension) === 'safety' && theme.frequency >= 2) {
        entry.disqualifiers.push(theme);
      }
    }
  }

  const ranked = [...byBrand.values()]
    .map(entry => ({
      ...entry,
      score: round(clamp(entry.score, 1, 10), 2)
    }))
    .sort((a, b) => b.score - a.score || a.brand.localeCompare(b.brand));

  if (ranked.length === 0) {
    return {
      topPick: null,
      confidence: dataSufficiency.toLowerCase(),
      reasoning: {
        strengths: [],
        concerns: [],
        disqualifiers: []
      },
      runnerUp: null,
      brandScores: {},
      methodology: 'convergence-severity (references/methodology.md)'
    };
  }

  const eligible = ranked.filter(entry => entry.disqualifiers.length === 0);
  const topPick = (eligible[0] || ranked[0]);
  const runnerUpEntry = (eligible[1] || ranked.find(entry => entry.brand !== topPick.brand)) || null;

  return {
    topPick: topPick.brand,
    confidence: dataSufficiency.toLowerCase(),
    reasoning: {
      strengths: topPick.positiveThemes.slice(0, 3).map(themeToReasoning),
      concerns: topPick.negativeThemes.slice(0, 3).map(themeToReasoning),
      disqualifiers: topPick.disqualifiers.slice(0, 3).map(themeToReasoning)
    },
    runnerUp: runnerUpEntry ? {
      brand: runnerUpEntry.brand,
      reasoning: runnerUpEntry.positiveThemes[0]
        ? summarizeTheme(runnerUpEntry.positiveThemes[0])
        : 'Next-best signal in the available sources'
    } : null,
    brandScores: Object.fromEntries(ranked.map(entry => [entry.brand, entry.score])),
    methodology: 'convergence-severity (references/methodology.md)'
  };
}

function collectPriorIntel(brands, brandIntel) {
  return uniq(brands)
    .filter(brand => brand && brandIntel.brands[brand])
    .map(brand => {
      const entry = brandIntel.brands[brand];
      return {
        brand,
        sentiment: entry.sentiment || 'mixed',
        trustLevel: entry.trustLevel || 'medium',
        signals: entry.signals || [],
        lastResearched: entry.lastUpdated || null
      };
    })
    .sort((a, b) => a.brand.localeCompare(b.brand));
}

function getCatalogEntry(catalog, canonical) {
  return catalog.get(normalizeEntityKey(canonical)) || null;
}

function textMentionsEntity(text, canonical, catalog) {
  const entry = getCatalogEntry(catalog, canonical);
  if (!entry) return normalizeEntityKey(text).includes(normalizeEntityKey(canonical));
  return [...entry.aliases].some(alias => {
    const normalizedAlias = normalizeEntityKey(alias);
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedAlias)}(?=\\s|$)`, 'i');
    return pattern.test(normalizeEntityKey(text));
  });
}

function buildRawComparison(raw, itemA, itemB, catalog) {
  if (!itemA || !itemB) return null;

  const allComments = (raw.reddit?.threads || []).flatMap(thread => thread.comments || []);

  function entityComments(entity) {
    return allComments
      .filter(comment => textMentionsEntity(comment.body, entity, catalog))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(comment => ({ body: comment.body, score: comment.score }));
  }

  function entityAmazon(entity) {
    const match = (raw.amazon?.products || []).find(product => textMentionsEntity(product.title, entity, catalog));
    if (!match) return null;
    return {
      title: match.title,
      rating: match.rating,
      reviewCount: match.reviewCount,
      price: match.price
    };
  }

  return {
    candidateA: {
      name: itemA,
      topComments: entityComments(itemA),
      amazon: entityAmazon(itemA)
    },
    candidateB: {
      name: itemB,
      topComments: entityComments(itemB),
      amazon: entityAmazon(itemB)
    }
  };
}

function summarizeDimensionThemes(itemThemes) {
  let net = 0;
  let evidence = 0;
  for (const theme of itemThemes) {
    const contribution = theme.frequency * theme.convergence;
    if (theme.polarity === 'positive') {
      net += contribution;
      evidence += theme.positiveCount || theme.frequency;
    } else if (theme.polarity === 'negative') {
      net -= contribution;
      evidence += theme.negativeCount || theme.frequency;
    }
  }
  return { net: round(net, 2), evidence };
}

function marginFromScores(winnerScore, loserScore) {
  if (winnerScore <= 0) return 'slight';
  if (loserScore <= 0) return 'strong';
  const ratio = winnerScore / Math.max(loserScore, 1e-9);
  if (ratio >= 3) return 'strong';
  if (ratio >= 2) return 'moderate';
  return 'slight';
}

function buildTradeoffString(byDimension, itemA, itemB) {
  const winsA = byDimension.filter(entry => entry.winner === itemA).map(entry => entry.dimension);
  const winsB = byDimension.filter(entry => entry.winner === itemB).map(entry => entry.dimension);

  if (winsA.length > 0 && winsB.length > 0) {
    return `${itemA} wins ${winsA.slice(0, 2).join(' + ')}. ${itemB} wins ${winsB.slice(0, 2).join(' + ')}.`;
  }
  if (winsA.length > 0) return `${itemA} leads on ${winsA.slice(0, 2).join(' + ')}.`;
  if (winsB.length > 0) return `${itemB} leads on ${winsB.slice(0, 2).join(' + ')}.`;
  return 'Tradeoffs are weak or too mixed in the available claims.';
}

function buildStructuredComparison(themes, items, draftScore, confidence) {
  if (!items || items.length !== 2) return null;

  const [itemA, itemB] = items;
  const dimensions = uniq(
    themes
      .filter(theme => theme.brand === itemA || theme.brand === itemB)
      .map(theme => theme.dimension)
  );

  const byDimension = [];
  for (const dimension of dimensions) {
    const aThemes = themes.filter(theme => theme.brand === itemA && theme.dimension === dimension);
    const bThemes = themes.filter(theme => theme.brand === itemB && theme.dimension === dimension);
    if (aThemes.length === 0 && bThemes.length === 0) continue;

    const aSummary = summarizeDimensionThemes(aThemes);
    const bSummary = summarizeDimensionThemes(bThemes);
    if (aSummary.net === bSummary.net) continue;
    if (aSummary.net <= 0 && bSummary.net <= 0) continue;

    const winner = aSummary.net > bSummary.net ? itemA : itemB;
    const winnerScore = Math.max(aSummary.net, bSummary.net);
    const loserScore = Math.max(Math.min(aSummary.net, bSummary.net), 0);
    byDimension.push({
      dimension,
      winner,
      evidence: {
        [itemA]: aSummary.evidence,
        [itemB]: bSummary.evidence
      },
      margin: marginFromScores(winnerScore, loserScore)
    });
  }

  const wins = {
    [itemA]: byDimension.filter(entry => entry.winner === itemA).length,
    [itemB]: byDimension.filter(entry => entry.winner === itemB).length
  };

  let overall = null;
  if (draftScore?.topPick && [itemA, itemB].includes(draftScore.topPick)) {
    overall = draftScore.topPick;
  } else if (wins[itemA] !== wins[itemB]) {
    overall = wins[itemA] > wins[itemB] ? itemA : itemB;
  } else if ((draftScore?.brandScores?.[itemA] ?? 0) !== (draftScore?.brandScores?.[itemB] ?? 0)) {
    overall = (draftScore.brandScores[itemA] || 0) > (draftScore.brandScores[itemB] || 0) ? itemA : itemB;
  }

  return {
    items: [itemA, itemB],
    byDimension,
    verdict: {
      overall,
      tradeoff: buildTradeoffString(byDimension, itemA, itemB),
      confidence: confidence.toLowerCase()
    }
  };
}

function buildSourceSummary(raw) {
  const summary = {
    reddit: raw.sourceCount.reddit,
    amazon: raw.sourceCount.amazon,
    expert: 0,
    hn: 0,
    youtube: raw.sourceCount.youtube,
    github: raw.sourceCount.github,
    twitter: raw.sourceCount.twitter
  };

  for (const result of raw.web.results) {
    if (inferSourceTypeFromWebResult(result) === 'hn') summary.hn++;
    else summary.expert++;
  }

  return summary;
}

function analyzeRawResult(raw, brandIntel, opts) {
  const { claims, catalog } = extractClaims(raw, brandIntel, opts);
  const { themes, weakSignals } = groupThemes(claims);
  const crossBrandThemes = buildCrossBrandThemes(themes);
  const priorIntel = collectPriorIntel(
    claims.filter(claim => claim.brand).map(claim => claim.brand),
    brandIntel
  );
  const priorIntelMap = new Map(priorIntel.map(entry => [entry.brand, entry]));
  const brandSignals = buildBrandSignals(themes, claims, priorIntelMap);
  const draftScore = computeDraftScore(themes, brandSignals, raw.dataSufficiency);

  raw.alternatives = brandSignals.map(signal => ({
    name: signal.brand,
    count: signal.mentions
  }));

  let comparisonItems = null;
  if (opts.compare) {
    if (opts.compareExplicit?.length === 2) {
      comparisonItems = opts.compareExplicit;
    } else if (brandSignals.length >= 2) {
      comparisonItems = [brandSignals[0].brand, brandSignals[1].brand];
    }
  }

  raw.comparison = comparisonItems
    ? buildRawComparison(raw, comparisonItems[0], comparisonItems[1], catalog)
    : null;

  const calibrationNote = getCalibrationNote();

  const structured = {
    schema: 'consensus-research/v5',
    schemaVersion: 5,
    query: raw.query,
    category: raw.category,
    depth: raw.depth,
    timestamp: raw.timestamp,
    location: raw.location || null,
    dataSufficiency: raw.dataSufficiency.toLowerCase(),
    sourceCount: raw.sourceCount,
    sourceSummary: buildSourceSummary(raw),
    apiCost: toApiCostSummary(raw.apiCost),
    calibrationNote: calibrationNote || null,
    priorIntel,
    claims,
    themes,
    weakSignals,
    crossBrandThemes,
    brandSignals,
    draftScore,
    comparison: comparisonItems
      ? buildStructuredComparison(themes, comparisonItems, draftScore, raw.dataSufficiency)
      : null
  };

  return {
    raw,
    structured,
    catalog
  };
}

function emptyBrandIntel() {
  return {
    schemaVersion: BRAND_INTEL_SCHEMA_VERSION,
    brands: {}
  };
}

function ensureBrandIntelShape(data) {
  const normalized = emptyBrandIntel();
  normalized.schemaVersion = Number(data?.schemaVersion) || BRAND_INTEL_SCHEMA_VERSION;
  normalized.brands = {};

  for (const [brand, entry] of Object.entries(data?.brands || {})) {
    normalized.brands[brand] = {
      sentiment: entry.sentiment || 'mixed',
      categories: uniq((entry.categories || []).map(cleanupText).filter(Boolean)),
      trustLevel: entry.trustLevel || trustLevelFromSentiment(entry.sentiment || 'mixed'),
      signals: (entry.signals || []).map(signal => ({
        dimension: signal.dimension || 'other',
        polarity: signal.polarity || 'mixed',
        detail: cleanupText(signal.detail || ''),
        date: signal.date || toDateOnly(),
        source: signal.source || 'auto'
      })),
      notes: cleanupText(entry.notes || ''),
      lastUpdated: entry.lastUpdated || null,
      researchCount: Number(entry.researchCount) || 0
    };
  }

  return normalized;
}

function splitLegacySignals(text) {
  return cleanupText(text)
    .split(/(?<=\.)\s+/)
    .map(part => cleanupText(part))
    .filter(Boolean);
}

function inferCategoryFromBrandIntelText(text) {
  const normalized = String(text || '').toLowerCase();
  if (/supplement|glycine|nootropic|amino|consumerlab|labdoor/.test(normalized)) return ['supplement'];
  if (/software|saas|github|hackernews/.test(normalized)) return ['software'];
  return ['product'];
}

function mapLegacyTrustLevel(rawTrust) {
  const trust = String(rawTrust || '').toLowerCase();
  if (trust.includes('flagged')) return { sentiment: 'flagged', trustLevel: 'caution' };
  if (trust.includes('high')) return { sentiment: 'positive', trustLevel: 'high' };
  if (trust.includes('low')) return { sentiment: 'negative', trustLevel: 'low' };
  return { sentiment: 'mixed', trustLevel: 'medium' };
}

function parseLegacyBrandIntelMarkdown(content) {
  const result = emptyBrandIntel();
  const sections = String(content || '').split(/^##\s+/m).slice(1);

  for (const section of sections) {
    const lines = section.split('\n');
    const brand = cleanupText(lines.shift() || '');
    const body = lines.join('\n');
    if (!brand) continue;

    const trustMatch = body.match(/\*\*Trust Level:\*\*\s*(.+)/i) || body.match(/\*\*Sentiment:\*\*\s*(.+)/i);
    const signalsMatch = body.match(/\*\*(?:Key signals|Flags|Notes):\*\*\s*(.+)/i);
    const sourceMatch = body.match(/\*\*Source:\*\*\s*(.+)/i);
    const dateMatch = body.match(/\*\*(?:Date|Last updated):\*\*\s*(\d{4}-\d{2}-\d{2})/i);
    const notesMatch = body.match(/\*\*Notes:\*\*\s*(.+)/i);

    const trustMeta = mapLegacyTrustLevel(trustMatch ? trustMatch[1] : '');
    const signalLines = splitLegacySignals(signalsMatch ? signalsMatch[1] : '')
      .map(detail => ({
        dimension: detectDimensions(detail, 'product')[0] || inferFallbackDimension(detail, 'product'),
        polarity: detectPolarity(detail) || (trustMeta.sentiment === 'positive' ? 'positive' : trustMeta.sentiment === 'negative' || trustMeta.sentiment === 'flagged' ? 'negative' : 'mixed'),
        detail,
        date: dateMatch ? dateMatch[1] : toDateOnly(),
        source: 'manual'
      }));

    result.brands[brand] = {
      sentiment: trustMeta.sentiment,
      categories: inferCategoryFromBrandIntelText([body, sourceMatch ? sourceMatch[1] : ''].join(' ')),
      trustLevel: trustMeta.trustLevel,
      signals: signalLines,
      notes: cleanupText(notesMatch ? notesMatch[1] : ''),
      lastUpdated: dateMatch ? dateMatch[1] : null,
      researchCount: 1
    };
  }

  return ensureBrandIntelShape(result);
}

function loadBrandIntel() {
  if (existsSync(BRAND_INTEL_JSON_PATH)) {
    try {
      return ensureBrandIntelShape(JSON.parse(readFileSync(BRAND_INTEL_JSON_PATH, 'utf8')));
    } catch (err) {
      log(`Failed to parse brand-intel.json: ${err.message}`);
    }
  }

  if (existsSync(BRAND_INTEL_MD_PATH)) {
    try {
      return parseLegacyBrandIntelMarkdown(readFileSync(BRAND_INTEL_MD_PATH, 'utf8'));
    } catch (err) {
      log(`Failed to parse legacy brand-intel.md: ${err.message}`);
    }
  }

  return emptyBrandIntel();
}

function normalizeSignalKey(signal) {
  return [
    signal.dimension || 'other',
    signal.polarity || 'mixed',
    normalizeEntityKey(signal.detail || '')
  ].join('|');
}

function generateBrandIntelMd(data) {
  const normalized = ensureBrandIntelShape(data);
  let md = '# Brand Intel Database\n\n';
  md += '*Auto-generated from brand-intel.json. Preserve manual notes in the JSON sidecar.*\n\n';

  for (const brand of Object.keys(normalized.brands).sort((a, b) => a.localeCompare(b))) {
    const entry = normalized.brands[brand];
    md += `## ${brand}\n`;
    md += `- **Trust level:** ${entry.trustLevel}\n`;
    md += `- **Sentiment:** ${entry.sentiment}\n`;
    if (entry.categories.length > 0) {
      md += `- **Categories:** ${entry.categories.join(', ')}\n`;
    }
    for (const signal of entry.signals.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
      md += `- **${signal.polarity === 'negative' ? 'Flag' : signal.polarity === 'positive' ? 'Signal' : 'Note'}:** ${signal.detail} (${signal.date}, ${signal.source})\n`;
    }
    if (entry.notes) md += `- **Notes:** ${entry.notes}\n`;
    md += `- **Last updated:** ${entry.lastUpdated || 'n/a'}\n`;
    md += `- **Research count:** ${entry.researchCount}\n\n`;
  }

  return md;
}

function saveBrandIntel(data) {
  const normalized = ensureBrandIntelShape(data);
  ensureDir(dirname(BRAND_INTEL_JSON_PATH));
  writeFileSync(BRAND_INTEL_JSON_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  writeFileSync(BRAND_INTEL_MD_PATH, generateBrandIntelMd(normalized), 'utf8');
}

function detailFromBrandTheme(theme) {
  return `${theme.frequency} independent sources mentioned ${theme.dimension}: ${summarizeTheme(theme)}`;
}

function deriveBrandSentiment(signal) {
  if (signal.flags.length > 0 && signal.themes.some(theme => severityFamilyForDimension(theme.dimension) === 'safety')) {
    return 'flagged';
  }
  if (signal.sentiment === 'flagged') return 'flagged';
  return signal.sentiment;
}

function deriveTrustLevel(signal) {
  if (signal.flags.length > 0 && signal.themes.some(theme => severityFamilyForDimension(theme.dimension) === 'safety')) {
    return 'caution';
  }
  if (signal.sentiment === 'positive') return signal.flags.length === 0 ? 'high' : 'medium';
  if (signal.sentiment === 'negative') return 'low';
  if (signal.sentiment === 'flagged') return 'caution';
  return 'medium';
}

function updateBrandIntel(data, structured, category) {
  const next = ensureBrandIntelShape(data);
  const today = toDateOnly(structured.timestamp);

  for (const signal of structured.brandSignals) {
    if (signal.mentions < 2) continue;

    const brand = signal.brand;
    const existing = next.brands[brand] || {
      sentiment: 'mixed',
      categories: [],
      trustLevel: 'medium',
      signals: [],
      notes: '',
      lastUpdated: null,
      researchCount: 0
    };

    existing.sentiment = deriveBrandSentiment(signal);
    existing.trustLevel = deriveTrustLevel(signal);
    existing.categories = uniq([...existing.categories, category]);
    existing.lastUpdated = today;
    existing.researchCount = (existing.researchCount || 0) + 1;

    const seenSignals = new Set(existing.signals.map(normalizeSignalKey));
    const candidateSignals = signal.themes
      .filter(theme => theme.frequency >= 2)
      .slice(0, 4)
      .map(theme => ({
        dimension: theme.dimension,
        polarity: theme.polarity === 'mixed' ? 'mixed' : theme.polarity,
        detail: detailFromBrandTheme(theme),
        date: today,
        source: 'auto'
      }));

    for (const newSignal of candidateSignals) {
      const key = normalizeSignalKey(newSignal);
      if (seenSignals.has(key)) continue;
      existing.signals.push(newSignal);
      seenSignals.add(key);
    }

    next.brands[brand] = existing;
  }

  return next;
}

function generateMarkdownReport(structured) {
  const lines = [];
  lines.push(`# Research: ${structured.query}`);
  lines.push(`**Date:** ${toDateOnly(structured.timestamp)}`);
  lines.push(`**Category:** ${structured.category}`);
  lines.push(`**Depth:** ${structured.depth}`);
  lines.push(`**Data sufficiency:** ${structured.dataSufficiency.toUpperCase()}`);
  lines.push('');

  if (structured.draftScore?.topPick) {
    lines.push('## Draft Score');
    lines.push(`- Top pick: ${structured.draftScore.topPick}`);
    lines.push(`- Confidence: ${structured.draftScore.confidence}`);
    if (structured.draftScore.runnerUp) {
      lines.push(`- Runner-up: ${structured.draftScore.runnerUp.brand} (${structured.draftScore.runnerUp.reasoning})`);
    }
    lines.push('');
  }

  if (structured.priorIntel?.length) {
    lines.push('## Prior Intel');
    for (const intel of structured.priorIntel) {
      lines.push(`- ${intel.brand}: ${intel.trustLevel} (${intel.lastResearched || 'unknown date'})`);
    }
    lines.push('');
  }

  if (structured.draftScore?.reasoning?.strengths?.length) {
    lines.push('## Strengths');
    for (const strength of structured.draftScore.reasoning.strengths) {
      lines.push(`- ${strength.dimension}: ${strength.summary} (${strength.sources} sources, convergence ${strength.convergence})`);
    }
    lines.push('');
  }

  if (structured.draftScore?.reasoning?.concerns?.length) {
    lines.push('## Concerns');
    for (const concern of structured.draftScore.reasoning.concerns) {
      lines.push(`- ${concern.dimension}: ${concern.summary} (${concern.sources} sources, convergence ${concern.convergence})`);
    }
    lines.push('');
  }

  if (structured.brandSignals?.length) {
    lines.push('## Brand Signals');
    for (const signal of structured.brandSignals.slice(0, 8)) {
      const flags = signal.flags.length > 0 ? ` | flags: ${signal.flags.length}` : '';
      lines.push(`- ${signal.brand}: ${signal.sentiment} | ${signal.mentions} claims${flags}`);
    }
    lines.push('');
  }

  if (structured.weakSignals?.length) {
    lines.push('## Weak Signals');
    for (const weak of structured.weakSignals.slice(0, 8)) {
      const brand = weak.brand || 'category-level';
      lines.push(`- ${brand} / ${weak.dimension}: ${summarizeTheme(weak)}`);
    }
    lines.push('');
  }

  if (structured.comparison?.byDimension?.length) {
    lines.push('## Comparison');
    lines.push(`- Overall: ${structured.comparison.verdict.overall || 'mixed'}`);
    lines.push(`- Tradeoff: ${structured.comparison.verdict.tradeoff}`);
    for (const dimension of structured.comparison.byDimension) {
      lines.push(`- ${dimension.dimension}: ${dimension.winner} (${dimension.margin})`);
    }
    lines.push('');
  }

  lines.push('## Sources');
  for (const [source, count] of Object.entries(structured.sourceSummary)) {
    lines.push(`- ${source}: ${count}`);
  }
  lines.push('');

  lines.push(`**API cost:** ${structured.apiCost.total} calls (~$${structured.apiCost.estimatedUSD.toFixed(3)})`);
  lines.push('');
  lines.push(`*Generated by consensus-research ${SCHEMA_VERSION}*`);

  return lines.join('\n');
}

function saveResearch(result, saveDir) {
  const dir = saveDir || DEFAULT_SAVE_DIR;
  ensureDir(dir);

  const date = toDateOnly(result.structured.timestamp);
  const slug = slugify(result.structured.query);
  const baseName = `${slug}-${date}`;

  const mdPath = join(dir, `${baseName}.md`);
  const jsonPath = join(dir, `${baseName}.json`);

  writeFileSync(mdPath, generateMarkdownReport(result.structured), 'utf8');
  writeFileSync(jsonPath, JSON.stringify(result.structured, null, 2), 'utf8');

  log(`Saved: ${mdPath}`);
  log(`Saved: ${jsonPath}`);
  return { mdPath, jsonPath };
}

function buildV5Json(structured, raw) {
  const cost = structured.apiCost || {};
  const topPick = structured.draftScore?.topPick || null;
  const topScore = topPick && structured.draftScore?.brandScores?.[topPick]
    ? structured.draftScore.brandScores[topPick]
    : null;

  const scoreInterpretation = score => {
    if (score == null) return 'insufficient data';
    if (score >= 8) return 'Strong Buy';
    if (score >= 6.5) return 'Buy with Caveats';
    if (score >= 4.5) return 'Mixed';
    return 'Avoid';
  };

  return {
    schema: 'consensus-research/v5',
    meta: {
      query: structured.query,
      category: structured.category,
      depth: structured.depth,
      temporalScope: null,
      location: structured.location || null,
      researchDate: toDateOnly(structured.timestamp),
      sourceDateRange: { oldest: null, newest: null },
      searchProvider: cost.searchProvider || 'unknown',
      searchCost: {
        brave: cost.brave || 0,
        ddg: cost.ddg || 0,
        reddit: cost.reddit || 0,
        estimatedUsd: cost.estimatedUSD || 0
      }
    },
    verdict: {
      score: topScore,
      confidence: (structured.dataSufficiency || 'low').toLowerCase(),
      interpretation: scoreInterpretation(topScore),
      topPick,
      runnerUp: structured.draftScore?.runnerUp || null,
      calibrationNote: structured.calibrationNote || null
    },
    claims: (structured.themes || []).map(theme => ({
      theme: theme.dimension,
      brand: theme.brand || null,
      sentiment: theme.polarity || 'mixed',
      agreement: theme.frequency >= 3 ? 'confirmed' : theme.frequency >= 2 ? 'notable' : 'anecdotal',
      sourceCount: theme.frequency,
      sources: uniq(theme.sourceTypes || []),
      quotes: (theme.claims || []).slice(0, 3).map(c => c.quote).filter(Boolean)
    })),
    brands: (structured.brandSignals || []).map(signal => ({
      name: signal.brand,
      score: structured.draftScore?.brandScores?.[signal.brand] || null,
      strengths: signal.themes.filter(t => t.polarity === 'positive').map(t => t.dimension),
      issues: signal.themes.filter(t => t.polarity === 'negative').map(t => t.dimension),
      flags: signal.flags || []
    })),
    alternatives: (structured.brandSignals || []).slice(1).map(signal => ({
      name: signal.brand,
      mentionCount: signal.mentions,
      reason: signal.themes[0] ? summarizeTheme(signal.themes[0]) : null
    })),
    patterns: null,
    sourceBreakdown: Object.fromEntries(
      Object.entries(structured.sourceSummary || {}).map(([k, v]) => [k, { count: v, signal: v > 2 ? 'HIGH' : v > 0 ? 'MEDIUM' : 'NONE' }])
    ),
    comparison: structured.comparison || null,
    location: structured.location || null
  };
}

function serializeResult(result, format) {
  if (format === 'raw') return result.raw;
  if (format === 'json') return buildV5Json(result.structured, result.raw);
  if (format === 'both') {
    return {
      schemaVersion: SCHEMA_VERSION,
      structured: result.structured,
      raw: result.raw
    };
  }
  return result.structured;
}

function watchlistLoad() {
  if (!existsSync(WATCHLIST_PATH)) return { items: [] };
  try {
    return JSON.parse(readFileSync(WATCHLIST_PATH, 'utf8'));
  } catch {
    return { items: [] };
  }
}

function watchlistSave(data) {
  ensureDir(dirname(WATCHLIST_PATH));
  writeFileSync(WATCHLIST_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function watchlistAdd(query, category, note) {
  const categoryError = validateCategory(category);
  if (categoryError) {
    console.log(categoryError);
    return;
  }

  const watchlist = watchlistLoad();
  if (watchlist.items.some(item => item.query.toLowerCase() === query.toLowerCase())) {
    console.log(`Already on watchlist: "${query}"`);
    return;
  }

  watchlist.items.push({
    query,
    category: category || detectCategory(query),
    note: note || null,
    addedAt: new Date().toISOString(),
    lastChecked: null,
    lastScore: null,
    lastSourceCount: null
  });

  watchlistSave(watchlist);
  console.log(`Added to watchlist: "${query}"`);
}

function watchlistRemove(query) {
  const watchlist = watchlistLoad();
  const before = watchlist.items.length;
  watchlist.items = watchlist.items.filter(item => item.query.toLowerCase() !== query.toLowerCase());

  if (watchlist.items.length === before) {
    console.log(`Not found on watchlist: "${query}"`);
    return;
  }

  watchlistSave(watchlist);
  console.log(`Removed from watchlist: "${query}"`);
}

function watchlistList() {
  const watchlist = watchlistLoad();
  if (watchlist.items.length === 0) {
    console.log('Watchlist is empty.');
    return;
  }

  console.log(`Watchlist (${watchlist.items.length} items)\n`);
  for (const item of watchlist.items) {
    const checked = item.lastChecked ? `last checked ${item.lastChecked.split('T')[0]}` : 'never checked';
    const score = item.lastScore ? ` (${item.lastScore})` : '';
    const note = item.note ? ` - ${item.note}` : '';
    console.log(`  ${item.query} [${item.category}]${score} - ${checked}${note}`);
  }
}

async function watchlistCheck(deep = false, budget = 3) {
  const watchlist = watchlistLoad();
  if (watchlist.items.length === 0) {
    console.log('Watchlist is empty.');
    return;
  }

  const itemsToCheck = deep ? watchlist.items.slice(0, budget) : watchlist.items;
  const mode = deep ? 'Deep' : 'Quick';
  console.log(`Watchlist ${mode} Check (${itemsToCheck.length}${deep ? `/${watchlist.items.length}` : ''} items)\n`);

  for (let index = 0; index < itemsToCheck.length; index++) {
    const item = itemsToCheck[index];
    const itemIndex = watchlist.items.indexOf(item);
    resetApiCalls();

    try {
      const result = await runResearch(item.query, {
        category: item.category,
        depth: deep ? 'standard' : 'quick',
        noCache: deep,
        compare: false,
        minScore: null,
        format: 'structured'
      });

      const newScore = result.dataSufficiency;
      const newSourceCount = result.sourceCount;
      const oldSourceCount = item.lastSourceCount;

      let status = 'no change';
      let icon = '[ok]';
      let recommendation = null;

      if (!item.lastChecked) {
        status = `first check (${newScore})`;
        icon = '[new]';
      } else if (oldSourceCount) {
        const newReddit = newSourceCount.reddit;
        const oldReddit = oldSourceCount.reddit;
        if (newReddit > oldReddit) {
          status = `new Reddit activity (${newReddit - oldReddit} new threads since last check)`;
          icon = '[warn]';
        } else if (newScore !== item.lastScore) {
          status = `sufficiency changed: ${item.lastScore} -> ${newScore}`;
          icon = '[warn]';
        }
      }

      // Deep check: compare themes to original
      if (deep && item.themes && item.themes.length > 0 && result.structured) {
        const newThemes = (result.structured.themes || [])
          .filter(t => t.frequency >= 2)
          .map(t => ({
            dimension: t.dimension,
            polarity: t.polarity,
            frequency: t.frequency,
            brand: t.brand
          }));

        const oldThemeSet = new Set(item.themes.map(t => typeof t === 'string' ? t : t.dimension || t));
        const newIssues = newThemes.filter(t => t.polarity === 'negative' && !oldThemeSet.has(t.dimension));
        const newStrengths = newThemes.filter(t => t.polarity === 'positive' && !oldThemeSet.has(t.dimension));

        // Check for reformulation keywords
        const allCommentText = (result.raw?.reddit?.threads || [])
          .flatMap(t => t.comments.map(c => c.body))
          .join(' ')
          .toLowerCase();
        const reformulationKeywords = ['new formula', 'they changed', 'not the same', 'reformulat', 'different now'];
        const reformulationDetected = reformulationKeywords.some(kw => allCommentText.includes(kw));

        if (reformulationDetected) {
          icon = '[!!!]';
          status += ' | REFORMULATION detected in new sources';
          recommendation = 'Re-research urgently (possible product change)';
        }

        if (newIssues.length > 0) {
          icon = icon === '[ok]' ? '[warn]' : icon;
          status += ` | NEW ISSUES: ${newIssues.map(t => t.dimension).join(', ')}`;
          recommendation = recommendation || 'Re-research (new complaint patterns found)';
        }

        if (newStrengths.length > 0 && icon === '[ok]') {
          status += ` | new positive signals: ${newStrengths.map(t => t.dimension).join(', ')}`;
        }

        // Score shift detection
        const oldBrandScore = item.lastBrandScore;
        const newBrandScore = result.structured.draftScore?.brandScores
          ? Math.max(...Object.values(result.structured.draftScore.brandScores))
          : null;
        if (oldBrandScore != null && newBrandScore != null && Math.abs(newBrandScore - oldBrandScore) >= 0.5) {
          icon = icon === '[ok]' ? '[shift]' : icon;
          status += ` | SCORE SHIFT: ${oldBrandScore} -> ${newBrandScore}`;
          recommendation = recommendation || `Score shifted by ${round(newBrandScore - oldBrandScore)} points`;
        }

        // Save new themes
        watchlist.items[itemIndex].themes = newThemes.map(t => t.dimension);
        watchlist.items[itemIndex].lastBrandScore = newBrandScore;
      }

      console.log(`${icon} ${item.query} - ${status} (${newScore}, ${newSourceCount.reddit} Reddit threads)`);
      if (recommendation) console.log(`     RECOMMENDATION: ${recommendation}`);

      watchlist.items[itemIndex].lastChecked = new Date().toISOString();
      watchlist.items[itemIndex].lastScore = newScore;
      watchlist.items[itemIndex].lastSourceCount = newSourceCount;
      if (deep) watchlist.items[itemIndex].lastDeepCheck = new Date().toISOString();
    } catch (err) {
      console.log(`[err] ${item.query} - error: ${err.message}`);
    }
  }

  watchlistSave(watchlist);
  logApiCost();
}

function checkFreshness(dir) {
  if (!existsSync(dir)) {
    log(`Directory not found: ${dir}`);
    return [];
  }

  const files = readdirSync(dir).filter(file => file.endsWith('.md'));
  const results = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath, 'utf8');

    let date = null;
    const datePatterns = [
      /(?:Date|Research Date):\s*(\d{4}-\d{2}-\d{2})/i,
      /(\d{4}-\d{2}-\d{2})/
    ];
    for (const pattern of datePatterns) {
      const match = content.match(pattern);
      if (match) {
        const candidate = new Date(match[1]);
        if (!Number.isNaN(candidate.getTime())) {
          date = candidate;
          break;
        }
      }
    }

    if (!date) {
      const fileDateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
      if (fileDateMatch) date = new Date(fileDateMatch[1]);
    }

    if (!date || Number.isNaN(date.getTime())) date = statSync(filePath).mtime;

    let category = 'product';
    const categoryMatch = content.match(/Category:\s*(\w+)/i);
    if (categoryMatch) category = categoryMatch[1].toLowerCase();
    else category = detectCategory(content.slice(0, 500));

    const halfLife = TEMPORAL_DECAY_DAYS[category] || TEMPORAL_DECAY_DAYS.product;
    const daysOld = Math.floor((Date.now() - date.getTime()) / 86400000);

    let staleness = 'fresh';
    if (daysOld >= halfLife) staleness = 'stale';
    else if (daysOld >= halfLife * 0.75) staleness = 'aging';

    let product = file.replace(/\.md$/, '').replace(/-/g, ' ');
    const heading = content.match(/^#\s+.*?:\s*(.+)/m) || content.match(/^#\s+(.+)/m);
    if (heading) product = heading[1].trim();

    results.push({
      file,
      product,
      category,
      researchDate: date.toISOString().split('T')[0],
      halfLife,
      staleness,
      daysOld
    });
  }

  return results;
}

async function runResearch(query, opts) {
  const category = opts.category || detectCategory(query);
  const categoryError = validateCategory(category);
  if (categoryError) throw new Error(categoryError);

  const depth = opts.depth || 'standard';
  const ttl = depth === 'quick' ? CACHE_TTL_QUICK_MS : CACHE_TTL_MS;
  const brandIntel = loadBrandIntel();

  let raw;
  if (!opts.noCache) {
    raw = cacheGet(query, category, depth, ttl, opts);
    if (raw) {
      raw = {
        ...raw,
        apiCost: getApiCost()
      };
      log('(cached raw collection - rebuilding structured output)');
    }
  }

  if (!raw) {
    raw = await collectRawData(query, { ...opts, category, depth });
    if (!opts.noCache) {
      cacheSet(query, category, depth, opts, raw);
    }
  }

  const analyzed = analyzeRawResult(raw, brandIntel, opts);
  return {
    ...analyzed,
    query,
    category,
    depth,
    sourceCount: analyzed.raw.sourceCount,
    dataSufficiency: analyzed.raw.dataSufficiency,
    apiCost: analyzed.raw.apiCost
  };
}

const HELP = `Usage: research.js <query> [options]
       research.js --compare "Item A" "Item B" [options]
       research.js cache <clear|prune>
       research.js watchlist [add|remove|check] [query] [--note "..."]
       research.js feedback <product> --satisfaction <1-10> [--notes "..."] [--brand "..."]
       research.js status

Options:
  --category <type>     product|supplement|restaurant|service|software|tech
                        Auto-detected from query if omitted
  --depth <level>       quick|standard|deep (default: standard)
  --output <path>       Write JSON results to file (default: stdout)
  --compare [A B]       Compare brands or products. No args = auto-detect top 2.
  --freshness <dir>     Check research files for staleness (separate mode)
  --format <type>       structured|raw|both|json (default: structured)
                        json = canonical v5 JSON schema for machine consumption
  --no-cache            Skip cache, force fresh API calls
  --save [dir]          Save markdown report + structured JSON to directory
                        Default: ./memory/research/
  --min-score <N>       Filter Reddit comments below N upvotes
  --location <place>    Scope results to a location (auto-used for restaurants/services)
  --help, -h            Show this help

Subcommands:
  cache clear           Delete all cached results
  cache prune           Delete expired cache entries
  watchlist             List all watched items
  watchlist add <q>     Add query to watchlist (--note "..." --category X)
  watchlist remove <q>  Remove query from watchlist
  watchlist check       Quick-research all watchlist items, report changes
  watchlist check --deep  Deep check: compare themes, detect reformulations (budget: 3 items)
  watchlist check --deep --budget N  Deep check with custom item budget
  feedback <product>    Record satisfaction feedback for a researched product
    --satisfaction <1-10>  Your satisfaction score
    --notes "..."          Optional notes about your experience
    --brand "..."          Brand you purchased (auto-detected from research if omitted)
  status                Show system health, calibration data, search provider status

Depth modes:
  quick       2-3 searches, limited sources, structured output only
  standard    Full loop: Reddit, Amazon, expert sites, GitHub for software/tech
  deep        Standard + YouTube + Twitter/X complaints

Environment:
  BRAVE_API_KEY         Recommended for research. Falls back to DuckDuckGo if unavailable.
  SERPAPI_KEY            Optional SerpAPI key (future use)

Examples:
  research.js "glycine powder" --category supplement --save
  research.js "cursor vs zed" --category software
  research.js --compare "Sony WH-1000XM5" "Bose QC Ultra" --category tech --save
  research.js "protein powder" --format json
  research.js "best ramen" --location "Los Angeles"
  research.js cache prune
  research.js watchlist add "Nutricost glycine" --note "daily supplement"
  research.js watchlist check --deep
  research.js feedback "creatine monohydrate" --satisfaction 8 --notes "dissolved well"
  research.js status
  research.js --freshness ./memory/research/`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  if (existsSync(CACHE_DIR)) {
    const pruned = cachePrune();
    if (pruned > 0) log(`Auto-pruned ${pruned} expired cache entries`);
  }

  if (args.subcommand === 'cache') {
    if (args.subAction === 'clear') {
      const count = cacheClear();
      console.log(`Cleared ${count} cache entries.`);
      return;
    }
    if (args.subAction === 'prune') {
      const count = cachePrune();
      console.log(`Pruned ${count} expired cache entries.`);
      return;
    }
    console.error('Usage: research.js cache <clear|prune>');
    process.exit(1);
  }

  if (args.subcommand === 'watchlist') {
    if (!args.subAction || args.subAction === 'list') {
      watchlistList();
      return;
    }
    if (args.subAction === 'add') {
      const query = args.subArgs[0];
      if (!query) {
        console.error('Usage: research.js watchlist add <query> [--note "..."]');
        process.exit(1);
      }
      watchlistAdd(query, args.category, args.note);
      return;
    }
    if (args.subAction === 'remove') {
      const query = args.subArgs[0];
      if (!query) {
        console.error('Usage: research.js watchlist remove <query>');
        process.exit(1);
      }
      watchlistRemove(query);
      return;
    }
    if (args.subAction === 'check') {
      await watchlistCheck(args.deep, args.budget || 3);
      return;
    }
    console.error('Usage: research.js watchlist [add|remove|check]');
    process.exit(1);
  }

  if (args.subcommand === 'feedback') {
    const product = args.subArgs[0] || args.subAction;
    if (!product) {
      console.error('Usage: research.js feedback <product> --satisfaction <1-10> [--notes "..."] [--brand "..."]');
      process.exit(1);
    }
    if (!args.satisfaction || args.satisfaction < 1 || args.satisfaction > 10) {
      console.error('Error: --satisfaction <1-10> required.');
      process.exit(1);
    }
    try {
      const entry = addFeedback(product, args.satisfaction, {
        notes: args.notes || args.note || null,
        brand: args.brand || null
      });
      console.log(`Feedback recorded: ${product} = ${entry.satisfaction}/10`);
      if (entry.deltaFromPrediction != null) {
        const dir = entry.deltaFromPrediction > 0 ? '+' : '';
        console.log(`  Delta from prediction: ${dir}${entry.deltaFromPrediction} (research predicted ${entry.researchScore})`);
      }
      console.log(`  After purchase, this data improves future scoring accuracy.`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (args.subcommand === 'status') {
    console.log('=== Consensus Research Status ===\n');
    console.log(`Schema version: ${SCHEMA_VERSION}`);
    console.log(`Search: ${getSearchHealth()}`);
    console.log(`${getRedditHealthSummary()}`);
    console.log('');
    console.log(getFeedbackSummary());
    console.log('');

    // Watchlist summary
    const watchlist = watchlistLoad();
    console.log(`Watchlist: ${watchlist.items.length} items`);
    if (watchlist.items.length > 0) {
      const unchecked = watchlist.items.filter(i => !i.lastChecked).length;
      if (unchecked > 0) console.log(`  ${unchecked} never checked`);
    }
    console.log('');

    // Cache summary
    if (existsSync(CACHE_DIR)) {
      const cacheFiles = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json')).length;
      console.log(`Cache: ${cacheFiles} entries`);
    } else {
      console.log('Cache: empty');
    }

    // Config
    const config = loadConfig();
    if (config.defaultLocation) {
      const loc = typeof config.defaultLocation === 'string'
        ? config.defaultLocation
        : `${config.defaultLocation.city || '?'}, ${config.defaultLocation.state || '?'}`;
      console.log(`Default location: ${loc}`);
    }
    return;
  }

  if (args.freshness) {
    console.log(JSON.stringify(checkFreshness(args.freshness), null, 2));
    return;
  }

  if (!['quick', 'standard', 'deep'].includes(args.depth)) {
    console.error(`Error: invalid depth "${args.depth}". Use quick|standard|deep.`);
    process.exit(1);
  }

  if (!['structured', 'raw', 'both', 'json'].includes(args.format)) {
    console.error(`Error: invalid format "${args.format}". Use structured|raw|both|json.`);
    process.exit(1);
  }

  if (!args.query && args.compareExplicit?.length === 2) {
    args.query = `${args.compareExplicit[0]} vs ${args.compareExplicit[1]}`;
    args.compare = true;
  }

  if (!args.query) {
    console.error('Error: query required. Use --help for usage.');
    process.exit(1);
  }

  const requestedCategory = args.category || detectCategory(args.query);
  const categoryError = validateCategory(requestedCategory);
  if (categoryError) {
    console.log(categoryError);
    process.exit(0);
  }

  if (!process.env.BRAVE_API_KEY) {
    log('Warning: BRAVE_API_KEY not set — using DuckDuckGo fallback (lower quality results)');
  }

  try {
    resetApiCalls();
    const result = await runResearch(args.query, args);
    const output = serializeResult(result, args.format);
    const json = JSON.stringify(output, null, 2);

    if (args.output) {
      ensureDir(dirname(resolve(args.output)));
      writeFileSync(args.output, json, 'utf8');
      log(`Results written to ${args.output}`);
    } else {
      console.log(json);
    }

    if (args.save) {
      const currentBrandIntel = loadBrandIntel();
      const updatedBrandIntel = updateBrandIntel(currentBrandIntel, result.structured, result.category);
      saveBrandIntel(updatedBrandIntel);
      saveResearch(result, args.saveDir);
    }

    logApiCost();
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    analyzeRawResult,
    buildEntityCatalog,
    buildStructuredComparison,
    buildV5Json,
    cacheKey,
    computeDraftScore,
    extractClaims,
    generateBrandIntelMd,
    groupThemes,
    loadBrandIntel,
    loadConfig,
    parseLegacyBrandIntelMarkdown,
    runResearch,
    saveConfig,
    serializeResult,
    updateBrandIntel,
    validateCategory
  };
}
