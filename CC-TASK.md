# CC Task: Build Research Runner Script

Build a research runner script at `scripts/research.js` for the consensus-research skill. Read `SKILL.md` and `references/methodology.md` first to understand the full system.

## What to Build

A Node.js CLI script that automates the data collection phase of product/service research. The AI agent still does final synthesis and judgment, but this script handles the grunt work of fetching, parsing, and normalizing data from multiple sources.

### Usage:
```
node scripts/research.js "glycine powder" --category supplement --depth standard
node scripts/research.js "Nootropics Depot lion's mane" --category supplement --depth deep
node scripts/research.js "best restaurant downtown LA" --category restaurant --depth quick
```

### CLI Arguments:
- `query` (positional, required) — what to research
- `--category` — product|supplement|restaurant|service|tech|software (auto-detect if omitted)
- `--depth` — quick|standard|deep (default: standard)
- `--output` — path to write full JSON results (default: stdout)
- `--compare` — enable head-to-head mode, auto-picks top 2 candidates from results

### Core Functions to Build:

**1. searchReddit(query, subreddits)**
- Use Brave Search API with site:reddit.com scoping
- For each result URL, extract the subreddit and post ID
- Fetch full comments via: `https://www.reddit.com/r/{sub}/comments/{id}/.json?limit=100`
- User-Agent header: `ConsensusResearch/2.0`
- Parse comment tree recursively (comments have `replies.data.children`)
- Return: `{ threads: [{ url, title, subreddit, upvotes, commentCount, comments: [{ body, score, author }], themes: [] }] }`

**2. searchWeb(query, sites)**
- Use Brave Search API for general web searches with optional site scoping
- Brave API: `GET https://api.search.brave.com/res/v1/web/search?q={query}&count=5`
- Header: `X-Subscription-Token: {BRAVE_API_KEY from env}`
- Return: `{ results: [{ title, url, snippet, source }] }`

**3. searchAmazon(query)**
- Use Brave Search with site:amazon.com scoping
- Extract from snippets: star rating, review count, price if visible
- Return: `{ products: [{ title, url, rating, reviewCount, price }] }`

**4. extractRedditThemes(comments)**
- Group semantically similar complaints/praise into themes
- Count frequency of each theme
- Extract specific quotes (best 1-2 per theme)
- Identify competitor/alternative mentions ("switched from X", "tried X and Y", "wish I got Y")
- Return: `{ strengths: [{ theme, count, quotes }], issues: [{ theme, count, quotes }], alternatives: [{ name, mentionCount }] }`

**5. normalizePrice(priceStr, servings, servingSize)**
- Calculate cost per serving
- Return: `{ priceRaw, servings, perServing, currency }`

**6. headToHead(candidateA, candidateB)**
- Takes two product result objects
- Produces a simple comparison:
  - Shared strengths (both have)
  - Unique strengths (A has, B doesn't, and vice versa)
  - Shared issues
  - Unique issues
  - Price comparison (per serving)
  - Winner per dimension + overall
- Keep it SIMPLE — just the key differentiators, not a wall of text
- Return structured JSON

**7. checkFreshness(researchDir)**
- Scan all .md files in the given directory
- Parse the date from each file (look for "Date:" or date in filename like YYYY-MM-DD)
- Compare against category-specific temporal decay half-lives from methodology.md:
  - Restaurants: 6 months
  - Software/Apps: 6 months
  - Tech/Electronics: 1 year
  - Services: 1 year
  - Supplements: 2 years
  - Durable goods: 3 years
- Return: `[{ file, product, category, researchDate, halfLife, staleness: 'fresh'|'aging'|'stale', daysOld }]`
- `aging` = past 75% of half-life, `stale` = past 100%

**8. Main orchestrator: runResearch(query, options)**
- Based on depth mode:
  - **quick:** 2-3 Brave searches, 1 Reddit deep read, skip Amazon/YouTube
  - **standard:** full loop — Reddit (2-3 threads), Amazon, expert sites, Brave general
  - **deep:** standard + YouTube transcript search (just search, don't extract — that needs python), Twitter/X complaint search
- Collect all data into a structured result object
- If `--compare` flag: run headToHead on top 2 candidates found in results
- Output the full JSON result

### Output JSON Schema:
```json
{
  "query": "glycine powder",
  "category": "supplement",
  "depth": "standard",
  "timestamp": "2026-03-06T20:00:00Z",
  "reddit": { "threads": [], "themes": {} },
  "amazon": { "products": [] },
  "web": { "results": [] },
  "alternatives": [{ "name": "", "mentionCount": 0 }],
  "priceData": [{ "brand": "", "price": 0, "servings": 0, "perServing": 0 }],
  "comparison": null,
  "freshness": null,
  "dataSufficiency": "HIGH",
  "sourceCount": { "reddit": 0, "amazon": 0, "web": 0, "youtube": 0 }
}
```

### Important Implementation Details:
- Zero npm dependencies — use only Node built-in (fetch, fs, path)
- `BRAVE_API_KEY` from `process.env.BRAVE_API_KEY`
- Rate limit Brave API calls: max 1 request per 200ms (we have 50 req/sec but be polite)
- Rate limit Reddit JSON calls: max 1 per second (they throttle aggressively)
- All fetch calls need proper error handling — if Reddit returns 429, wait 2s and retry once
- Parse Reddit comment trees recursively (`reply.data.children[].data.body`)
- Auto-detect category from query keywords if `--category` not provided (e.g., "supplement", "restaurant", "app")
- The `--compare` flag should auto-identify the top 2 products/brands from Reddit mentions and Amazon results, then run headToHead
- Include a `--freshness` flag that checks a given directory for stale research files

### File Structure:
- `scripts/research.js` — the main script, everything in one file
- Make it executable (`#!/usr/bin/env node`)

Commit when done.
