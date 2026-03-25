# Consensus Research v5 — Improvement Spec

*For: Claude Code implementation*
*Author: Clawd*
*Date: 2026-03-25*
*Repo: `/Users/jj/clawd/skills/consensus-research/`*

---

## Context

The consensus research skill is an OpenClaw agent skill that does multi-source product/service research using weighted convergence scoring. It aggregates Reddit, Amazon, X, YouTube, expert reviews, and niche forums, then scores based on cross-platform agreement.

**Current state (v4):** Working well. Core convergence scoring is solid. Recently added temporal scoping, X dual-pass (positive + negative signal), and pattern extraction for software/tools. Brand intel database persists across runs. CLI runner at `scripts/research.js` handles data collection.

**What this spec covers:** 8 improvements ranked by impact. Build in order — each is independently shippable.

---

## Improvement 1: Scoring Calibration & Feedback Loop

### Why
Every research run is independent. We score a product 7.5/10 but never check if the user was actually satisfied. Over time, we should learn whether our scoring weights are right. This is the single highest-impact improvement because it makes the entire system get smarter with use.

### What to Build

**1a. Feedback capture command:**
```bash
node scripts/research.js feedback "creatine monohydrate" --satisfaction 8 --notes "dissolved well, no taste, good results after 4 weeks"
```

**1b. Feedback storage** — `data/feedback.json`:
```json
{
  "entries": [
    {
      "id": "fb-001",
      "product": "creatine monohydrate",
      "researchSlug": "creatine-monohydrate-2026-03-06",
      "researchScore": 7.5,
      "researchConfidence": "HIGH",
      "satisfaction": 8,
      "notes": "dissolved well, no taste, good results after 4 weeks",
      "purchasedBrand": "Nutricost",
      "feedbackDate": "2026-03-25",
      "deltaFromPrediction": 0.5
    }
  ],
  "calibration": {
    "avgDelta": 0.3,
    "avgAbsDelta": 0.4,
    "sampleSize": 12,
    "lastCalibrated": "2026-03-25",
    "weightAdjustments": {
      "reddit": 0.0,
      "amazon": -0.1,
      "expert": 0.0
    }
  }
}
```

**1c. Calibration logic:**
- After 5+ feedback entries, compute average delta (predicted score - satisfaction)
- If consistently over-predicting (delta > +0.5 avg): note that the scoring is optimistic, surface this as a caveat on future runs
- If a specific source consistently misleads (e.g., Amazon reviews predicted high but satisfaction was low): reduce that source's weight in the methodology
- Run calibration automatically when new feedback is added
- Surface calibration state in `research.js status` output

**1d. Integration with SKILL.md:**
Add to Phase 5 (Save to History):
- After delivering results, prompt: "After purchase, run `feedback '[product]' --satisfaction [1-10]` to improve future accuracy"
- When displaying results, if calibration data exists: show "Calibration: based on N past purchases, scores tend to be [optimistic/pessimistic/accurate] by X points"

### Files to Touch
- `scripts/research.js` — add `feedback` and `status` subcommands
- `data/feedback.json` — new file (create on first feedback entry)
- `SKILL.md` — add feedback prompt to Phase 5, calibration note to Phase 4 output
- `references/methodology.md` — add calibration section

---

## Improvement 2: Reddit Resilience Layer

### Why
60%+ of our signal comes from Reddit's JSON endpoint (`reddit.com/r/{sub}/comments/{id}/.json`). Reddit has been cracking down on unofficial API use. If this endpoint gets blocked or rate-limited, the entire skill degrades. Single point of failure = unacceptable for a core research tool.

### What to Build

**2a. Multi-strategy Reddit fetching** in `scripts/research.js`:

```javascript
async function fetchRedditThread(url) {
  // Strategy 1: JSON endpoint (current, fastest)
  const jsonResult = await tryJsonEndpoint(url);
  if (jsonResult) return jsonResult;
  
  // Strategy 2: Old Reddit HTML parsing (old.reddit.com is simpler DOM)
  const oldRedditResult = await tryOldRedditParse(url);
  if (oldRedditResult) return oldRedditResult;
  
  // Strategy 3: web_fetch with markdown extraction
  const webFetchResult = await tryWebFetch(url);
  if (webFetchResult) return webFetchResult;
  
  // Strategy 4: Google cache of the thread
  const cacheResult = await tryGoogleCache(url);
  if (cacheResult) return cacheResult;
  
  return null; // All strategies failed
}
```

**2b. Reddit content cache** — `data/reddit-cache/`:
- After successfully fetching a Reddit thread, cache the parsed content as JSON
- Key: MD5 of the thread URL
- TTL: 7 days for active research, indefinite for saved research (the thread won't change much)
- On subsequent research for the same product, check cache first
- Format:
```json
{
  "url": "https://reddit.com/r/supplements/comments/abc123/...",
  "subreddit": "supplements",
  "title": "Best creatine brand?",
  "fetchedAt": "2026-03-25T20:00:00Z",
  "commentCount": 87,
  "comments": [
    {"author": "user1", "score": 45, "body": "...", "depth": 0},
    {"author": "user2", "score": 23, "body": "...", "depth": 1}
  ]
}
```

**2c. Lemmy/Fediverse fallback:**
- For product categories where Reddit is primary, add a Lemmy search as supplementary source
- `https://lemmy.world/search?q=[product]&type=Posts&sort=TopAll`
- Lower weight than Reddit (MEDIUM vs HIGH) but adds redundancy
- Parse via web_fetch — Lemmy pages are simpler HTML

**2d. Rate limit detection:**
- If Reddit returns 429 or connection refused, log it and switch to fallback strategies for the rest of the session
- Track failure rate in `data/reddit-health.json`
- Surface in `research.js status`: "Reddit: healthy / degraded (3 failures in last 24h) / blocked"

### Files to Touch
- `scripts/research.js` — refactor Reddit fetching into multi-strategy function, add caching layer
- `data/reddit-cache/` — new directory (auto-created)
- `data/reddit-health.json` — new file (auto-created)
- `SKILL.md` — update Phase 1 Reddit section to mention fallback chain
- `references/methodology.md` — add Lemmy to source hierarchy (Tier 2, MEDIUM weight)

---

## Improvement 3: Research Update Triggers (Smart Watchlist)

### Why
Current watchlist checks source counts but doesn't read new content. If you researched creatine 3 months ago and 5 new Reddit threads appeared with "reformulation" complaints, you'd never know. Past research should stay alive.

### What to Build

**3a. Deep watchlist check:**
```bash
# Current behavior (shallow): just counts new sources
node scripts/research.js watchlist check

# New behavior (deep): reads new sources, compares themes to original
node scripts/research.js watchlist check --deep
```

Deep check for each watchlist item:
1. Search for new Reddit/Amazon/X content since `lastResearchDate`
2. Extract themes from new content using the same Phase 2 normalization
3. Compare against original research themes
4. Flag divergences:
   - **NEW ISSUE:** A complaint theme that didn't exist in original research
   - **RESOLVED:** A former complaint that's no longer appearing (product fixed it?)
   - **SCORE SHIFT:** Enough new data to move the score by ≥0.5 points
   - **REFORMULATION:** Keywords like "new formula," "they changed," "not the same"

**3b. Watchlist alert output:**
```
📊 WATCHLIST UPDATE — 3 items checked

⚠️ Nutricost Creatine (researched 2026-01-15, scored 7.5)
  NEW ISSUE: 4 Reddit posts since Feb mention "clumping" and "won't dissolve" — possible reformulation?
  RECOMMENDATION: Re-research (score may have shifted)

✅ Real Mushrooms Lion's Mane (researched 2026-03-06, scored 8.0)
  No significant new themes. Score stable.

🔄 Thorne Magnesium (researched 2026-02-20, scored 7.0)
  SCORE SHIFT: 6 new positive reviews on Amazon. New Reddit thread (r/supplements, 89 comments) strongly positive.
  RECOMMENDATION: Score likely higher now (~7.5-8.0). Re-research if purchasing.
```

**3c. Cron integration:**
The watchlist deep check should be runnable from a cron job (weekly). Output goes to a file that the morning briefing can surface if any items flagged.

**3d. Watchlist metadata extension:**
```json
{
  "items": [
    {
      "product": "Nutricost creatine",
      "addedAt": "2026-03-06",
      "lastResearchDate": "2026-03-06",
      "lastResearchScore": 7.5,
      "lastDeepCheck": "2026-03-25",
      "lastDeepCheckResult": "flagged",
      "themes": ["good value", "dissolves well", "third party tested"],
      "notes": "daily supplement"
    }
  ]
}
```

### Files to Touch
- `scripts/research.js` — extend `watchlist check` with `--deep` flag, theme comparison logic
- `data/watchlist.json` — extend schema with themes and deep check state
- `SKILL.md` — add watchlist deep check documentation

---

## Improvement 4: Geographic Awareness

### Why
"Best dentist," "best restaurant," "best gym" without location = garbage results. The skill has no mechanism to handle location-dependent queries. This matters for services, restaurants, and local businesses.

### What to Build

**4a. Location detection in query:**
- Auto-detect location-dependent categories: restaurants, services, doctors, gyms, salons, local businesses
- If detected and no location provided: check for a default location in config
- Config: `data/config.json` → `{ "defaultLocation": { "city": "Los Angeles", "state": "CA", "subreddits": ["r/LosAngeles", "r/FoodLosAngeles", "r/AskLosAngeles"] } }`

**4b. Location-scoped search:**
- Append location to all searches: `"best dentist" Los Angeles site:reddit.com`
- Auto-select local subreddits from config
- Google Reviews: append location to search query
- Yelp: use location filter (web_fetch the Yelp search page)

**4c. CLI flag:**
```bash
node scripts/research.js "best ramen" --location "West Hollywood, CA"
node scripts/research.js "best dentist" --location "Beverly Hills"
```

**4d. Location in output:**
Add `📍 Location: [city]` to output header. Flag if results are location-mixed (some reviews from other cities).

### Files to Touch
- `scripts/research.js` — add `--location` flag, location detection, location-scoped search patterns
- `data/config.json` — new file with default location
- `SKILL.md` — update Phase 1 with location-scoped search instructions
- `references/methodology.md` — add location-dependent category rules

---

## Improvement 5: Structured JSON Output Schema

### Why
The skill produces great markdown for humans but nothing clean for machines. If we want to build dashboards, comparison tools, or feed research into other agent skills, we need a canonical JSON schema.

### What to Build

**5a. Canonical research result schema:**
```json
{
  "schema": "consensus-research/v5",
  "meta": {
    "query": "creatine monohydrate",
    "category": "supplement",
    "depth": "standard",
    "temporalScope": "all",
    "location": null,
    "researchDate": "2026-03-25",
    "sourceDateRange": { "oldest": "2024-09-15", "newest": "2026-03-20" },
    "durationMs": 45000,
    "searchCost": { "brave": 8, "reddit": 3, "estimatedUsd": 0.012 }
  },
  "verdict": {
    "score": 7.5,
    "confidence": "HIGH",
    "interpretation": "Buy with Caveats",
    "calibrationNote": "Based on 8 past purchases, scores tend to be accurate (±0.3)"
  },
  "claims": [
    {
      "theme": "dissolves easily",
      "sentiment": "positive",
      "agreement": "confirmed",
      "sourceCount": 4,
      "sources": ["reddit:r/supplements", "reddit:r/fitness", "amazon", "youtube"],
      "scoreImpact": 0.5,
      "quotes": ["dissolves instantly in water", "no gritty texture at all"]
    }
  ],
  "brands": [
    {
      "name": "Nutricost",
      "score": 7.5,
      "pricePerServing": 0.13,
      "strengths": ["value", "third party tested"],
      "issues": [],
      "recommendation": "best-value"
    }
  ],
  "alternatives": [
    { "name": "Thorne", "mentionCount": 5, "reason": "premium quality" }
  ],
  "patterns": null,
  "sourceBreakdown": {
    "reddit": { "threads": 3, "comments": 127, "signal": "HIGH" },
    "amazon": { "reviews": 2847, "avgRating": 4.6, "signal": "MEDIUM" },
    "x": { "complaints": 2, "positive": 8, "signal": "MEDIUM" }
  }
}
```

**5b. CLI integration:**
```bash
# Markdown output (default, current behavior)
node scripts/research.js "creatine" --format markdown

# JSON output
node scripts/research.js "creatine" --format json

# Both (markdown to stdout, JSON to file)
node scripts/research.js "creatine" --format both --save
```

**5c. Auto-save both formats** when `--save` is used:
- `memory/research/creatine-monohydrate-2026-03-25.md` (human-readable)
- `memory/research/creatine-monohydrate-2026-03-25.json` (machine-readable)

### Files to Touch
- `scripts/research.js` — add JSON output formatter, `--format` flag extension
- `SKILL.md` — document JSON schema in Phase 4
- `references/schema.json` — new file, canonical JSON schema definition

---

## Improvement 6: Search Provider Fallback

### Why
Brave Search API has a $5/mo limit that we already hit on Mar 23. When Brave is down, the entire skill is dead. Need fallback search providers.

### What to Build

**6a. Search provider abstraction:**
```javascript
async function search(query, options = {}) {
  // Provider priority: Brave (best quality) → Google via SerpAPI → DuckDuckGo HTML
  const providers = [
    { name: 'brave', fn: searchBrave, available: !!process.env.BRAVE_API_KEY },
    { name: 'serpapi', fn: searchSerpApi, available: !!process.env.SERPAPI_KEY },
    { name: 'duckduckgo', fn: searchDDGHtml, available: true } // always available, no API key
  ];
  
  for (const provider of providers) {
    if (!provider.available) continue;
    try {
      const result = await provider.fn(query, options);
      if (result && result.length > 0) return { provider: provider.name, results: result };
    } catch (e) {
      if (e.status === 402 || e.status === 429) continue; // quota/rate limit, try next
      throw e;
    }
  }
  return { provider: null, results: [] };
}
```

**6b. DuckDuckGo HTML fallback** (zero API key needed):
- Fetch `https://html.duckduckgo.com/html/?q=[encoded query]`
- Parse the HTML for result titles, URLs, and snippets
- Lower quality than Brave but always available
- Add a note in output when using fallback: "⚠️ Using DuckDuckGo fallback (Brave quota exceeded)"

**6c. Provider health tracking:**
- `data/search-health.json`: track which providers are working, last failure, quota status
- `research.js status` shows: "Search: Brave (active, $3.20/$5.00 used) | SerpAPI (not configured) | DDG (fallback, always available)"

### Files to Touch
- `scripts/research.js` — abstract search into provider layer, add DDG fallback, health tracking
- `data/search-health.json` — new file (auto-created)

---

## Improvement 7: Image/Visual Analysis

### Why
Build quality, real vs counterfeit, actual color/size — these show up in photos, not text. Amazon review photos, YouTube video frames, and product comparison images carry signal that text reviews miss. Currently the skill is entirely text-based.

### What to Build

**7a. Amazon review image extraction:**
- When fetching Amazon data, look for review images (verified purchase reviews with photos)
- Download top 3-5 review images
- Run vision analysis with prompt: "Describe the product quality, build materials, any defects or damage visible, and compare to the product listing photos if you can infer the listing appearance"
- Extract visual claims: "build quality appears [premium/average/cheap]", "color differs from listing", etc.

**7b. YouTube thumbnail/frame analysis:**
- For Deep mode: extract 2-3 key frames from teardown/review videos (at 25%, 50%, 75% timestamps)
- Or use thumbnails as a lightweight proxy
- Vision analysis: "What does this product teardown reveal about build quality, materials, and design?"

**7c. Visual claims integration:**
- Visual claims get added to the claims layer with source "visual:amazon" or "visual:youtube"
- Weight: MEDIUM (same as Amazon verified)
- Visual claims that confirm text claims = stronger convergence signal
- Visual claims that contradict text claims = flag explicitly

**7d. This is Deep mode only.** Quick and Standard don't run vision analysis (too slow/expensive).

### Files to Touch
- `scripts/research.js` — add image download + vision analysis pipeline (Deep mode only)
- `SKILL.md` — update Deep mode description, add visual claims to Phase 2
- `references/methodology.md` — add visual source to hierarchy

---

## Improvement 8: Price Tracking & Alerts

### Why
We compute cost-per-serving at research time but never check back. Prices change. Sales happen. If a product we recommended drops 30% or a cheaper alternative appears, that's actionable.

### What to Build

**8a. Price snapshot on every research run:**
When research produces price data, save a price snapshot:
```json
{
  "product": "Nutricost Creatine 500g",
  "price": 15.99,
  "perServing": 0.13,
  "source": "amazon",
  "capturedAt": "2026-03-25",
  "url": "https://amazon.com/dp/..."
}
```

Store in `data/price-history.json`.

**8b. Price check command:**
```bash
node scripts/research.js prices check
```
For each product with saved price data:
- Re-fetch current price (quick Amazon search or web_fetch the product page)
- Compare to last known price
- Flag: price drops >15%, price increases >25%, new cheaper alternative found

**8c. Output:**
```
💰 PRICE CHECK — 4 products tracked

🟢 Nutricost Creatine 500g: $15.99 → $13.49 (-15.6%) 🔥 SALE
🔴 Real Mushrooms Lion's Mane: $29.95 → $34.95 (+16.7%)
⚪ Thorne Magnesium: $32.00 (unchanged)
⚪ NOW Foods Glycine: $9.99 (unchanged)
```

**8d. Cron-friendly:** Output can be consumed by a cron job and surfaced in morning briefing if any significant changes detected.

### Files to Touch
- `scripts/research.js` — add `prices check` subcommand, price snapshot on research runs
- `data/price-history.json` — new file (auto-created)

---

## Implementation Order & Priority

| # | Improvement | Impact | Effort | Priority |
|---|-----------|--------|--------|----------|
| 1 | Scoring Calibration | HIGH | Medium | 🔴 Build first |
| 2 | Reddit Resilience | HIGH | Medium | 🔴 Build second |
| 3 | Smart Watchlist | HIGH | Medium | 🔴 Build third |
| 6 | Search Fallback | HIGH | Low | 🟡 Quick win |
| 5 | JSON Schema | MEDIUM | Low | 🟡 Quick win |
| 4 | Geographic Awareness | MEDIUM | Medium | 🟡 After core |
| 8 | Price Tracking | MEDIUM | Low | 🟢 Nice to have |
| 7 | Visual Analysis | LOW | High | 🟢 Nice to have |

**Suggested approach:** Build #6 (search fallback) and #5 (JSON schema) first since they're quick wins with immediate value. Then #1 → #2 → #3 as the core improvements. #4, #7, #8 as time permits.

---

## Constraints

- **Zero new npm dependencies.** The CLI is currently zero-dep Node.js. Keep it that way. Use built-in `https`, `fs`, `crypto`, `url` modules only.
- **Don't break existing behavior.** All current CLI commands and flags must continue working. New features are additive.
- **File-based everything.** No databases, no external services beyond search APIs. JSON files in `data/` for all state.
- **Incremental commits.** Commit after each improvement is complete and tested. Don't batch 8 improvements into one commit.
- **Test each improvement** with a real research query before moving to the next. Example: after building search fallback, set BRAVE_API_KEY to empty and verify DDG fallback works.
- **Keep `scripts/research.js` under 2500 lines.** If it gets bigger, extract utility modules into `scripts/lib/`.

---

## How to Verify

After all improvements:

```bash
# 1. Scoring calibration
node scripts/research.js feedback "test product" --satisfaction 7
node scripts/research.js status  # should show calibration data

# 2. Reddit resilience
# Temporarily break the JSON endpoint URL and verify fallback kicks in

# 3. Smart watchlist
node scripts/research.js watchlist add "test product" --note "testing"
node scripts/research.js watchlist check --deep

# 4. Geographic awareness
node scripts/research.js "best ramen" --location "Los Angeles"

# 5. JSON schema
node scripts/research.js "creatine" --format json --depth quick

# 6. Search fallback
BRAVE_API_KEY="" node scripts/research.js "test" --depth quick  # should use DDG

# 7. Visual analysis (deep mode only)
node scripts/research.js "wireless earbuds" --depth deep  # should include visual claims

# 8. Price tracking
node scripts/research.js prices check  # after at least one prior research with price data
```
