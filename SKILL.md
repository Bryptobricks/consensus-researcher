---
name: consensus-research
description: Multi-source product, service, and restaurant research using weighted consensus scoring and structured claims output. MANDATORY for ANY purchase decision, product comparison, brand evaluation, service review, restaurant recommendation, or "is X worth it?" question. Also triggered by "research X", "find the best X", "compare X vs Y", "reviews of X", "should I buy X". Aggregates Reddit, Amazon, HackerNews, expert reviews, GitHub repo signals for software/tech, Twitter/X (dual-pass), YouTube, and niche forums — weights by platform reliability and cross-platform convergence. NOT for: quick price checks, simple spec lookups, or questions answerable from a single source.
---

# Consensus Research Skill

Multi-source research engine that finds truth at the intersection of independent review platforms. Core principle: **convergence across independent sources is the strongest signal.**

## MANDATORY USE RULE — NON-NEGOTIABLE

**This skill MUST be loaded and followed for ANY of these triggers:**
- Purchase decisions of any kind (products, services, subscriptions)
- "Best X", "which X should I get", "X vs Y", "is X worth it"
- Product/brand/service reviews or comparisons
- Restaurant or local business recommendations
- Health product, supplement, or protocol research
- Software/tool evaluation
- Any query where the user is deciding between options

**You may NOT:**
- Skip this skill and give an opinion from training data alone
- Partially follow the methodology (e.g., check Reddit but skip X or skip convergence scoring)
- Deliver research results without the verification stamp (see Phase 6)
- Claim you "don't have access" to sources — use fallback chains (DDG, Reddit cache, etc.)

**If ANY step is skipped, the verification stamp MUST reflect it as ⚠️ or ❌.** There is no way to produce a ✅ Verified stamp without actually completing the methodology.

## When Triggered

1. Read `references/methodology.md` for the full scoring framework, source weights, and anti-noise filters
2. Detect the **category** from the query (product, supplement, restaurant, service, tech, health)
3. Execute the research loop below

## Pre-Research Check

Before starting new research:
1. Check `memory/research/` for existing entries on the same or related products/services
2. Check `references/brand-intel.json` first for any known brand reputation signals. `references/brand-intel.md` is the generated human-readable view.
3. Surface findings proactively — e.g., *"Note: previous research flagged Nutricost's COA transparency issues"* or *"Brand intel shows NOW Foods FLAGGED for glycine specifically"*
4. If prior research exists and is within the temporal decay window, offer to update rather than start fresh

## Temporal Scoping

Before executing the research loop, determine the **temporal scope** based on category and query:

- **`--recent` or `--since <period>`** — Explicit override. Scopes ALL searches to the specified window (e.g., `--since 30d`, `--since 6m`). Appends date filters to every search query.
- **Auto-scope by category:**
  - Software/Apps, AI tools, crypto protocols: default to **last 6 months** (things change fast, old reviews are misleading)
  - Restaurants, health services: default to **last 12 months**
  - Supplements, durable goods: **no auto-scope** (long half-life, older data still valid)
- **How to apply:** Use `web_search` `freshness` parameter (`"month"`, `"year"`) or append `after:YYYY-MM-DD` to search queries. For Reddit, scope with `site:reddit.com "[product]" 2026` or sort by new.
- **Temporal scoring bonus:** Sources from within the auto-scope window get full weight. Sources older than the half-life for the category get half weight. Sources older than 2x half-life are noted but not scored.
- **Always report the date range** of sources used in the output: "Sources: 8 results from Jan-Mar 2026, 3 from 2025 (half-weighted)."

## Core Research Loop

### Phase 1: Parallel Source Collection

Fire site-scoped web searches simultaneously. Use `web_search` with site-scoping for each relevant platform. Apply temporal scope determined above.

```
"[product/service name] review site:reddit.com"
"[product/service name] review site:amazon.com"  
"[product/service name] site:news.ycombinator.com" (tech only)
"[product/service name] review [category-specific site]"
"[product/service name] vs [known competitor]"
```

Fetch the top 2-3 results per platform via `web_fetch`. Prioritize threads/pages with high engagement (comment count, upvotes, detailed responses).

**Reddit Deep Read (CRITICAL):** For Reddit threads, use the JSON endpoint instead of web_fetch:
```
curl -s -H "User-Agent: ConsensusResearch/1.0" "https://www.reddit.com/r/{subreddit}/comments/{id}/.json?limit=100"
```
This returns FULL comment bodies with scores, unlike web_fetch which only gets the OP text. Parse comment bodies and scores to extract real user experiences. This is where 60%+ of the signal lives — never skip this step for Reddit sources.

**Twitter/X — Dual Signal Pass (REQUIRED):** Use `node tools/twitter/twitter.js search` (CLI first, API fallback). Run TWO searches:
1. **Complaint signal:** `"[product/service name]" (broken OR terrible OR worst OR disappointed OR refund)` — surfaces failure patterns
2. **Positive signal:** `"[product/service name]" (love OR best OR switched to OR game changer OR underrated OR amazing)` — surfaces what's actually working and why people choose it

Extract from both: specific experiences, usage patterns, comparisons, workflows. X is uniquely good for real-time sentiment and catching product changes (reformulations, updates, regressions) that haven't hit Reddit/Amazon yet. Weight: MEDIUM (same as Amazon verified). Apply temporal scope — recent X posts are more valuable than old ones.

**YouTube Transcript Extraction:** For video reviews (teardowns, long-term follow-ups, expert analysis), extract transcripts using:
```python
python3 -c "
from youtube_transcript_api import YouTubeTranscriptApi
ytt_api = YouTubeTranscriptApi()
transcript = ytt_api.fetch('VIDEO_ID')
for entry in transcript:
    print(entry.text)
"
```
YouTube is MEDIUM-HIGH signal — visual proof is harder to fake, and long-form reviews tend to be more honest than written ones. Prioritize teardown videos and 6-month/1-year follow-up reviews over unboxing/first-impressions.

### Phase 2: Extract & Normalize Themes

The script now normalizes evidence into a `claims[]` layer before grouping or scoring. For each source, extract:
- **Recurring complaints** — group semantically similar issues into themes ("battery dies fast" = "poor battery life")
- **Recurring praise** — what keeps coming up positively
- **Failure timeline** — when do things break? (3 months? 1 year?)
- **Comparison mentions** — "switched from X" or "wish I got Y instead"
- **Competitor auto-discovery** — actively identify all competitor/alternative products mentioned in reviews. Look for patterns: "switched from X to Y", "I tried A, B, and C", "wish I got Y instead", "X is better than Y", "used to use Z". Build the competitor list dynamically from the reviews themselves — don't rely on pre-knowing competitors.
- **Use-case segments** — who loves it vs who hates it and why
- **Usage patterns** (CRITICAL for software/tools/protocols/services) — extract HOW people actually use it, not just whether they like it. Look for: specific workflows, configurations, settings, tips, workarounds, "here's what I do," "the trick is to," common setups, integration patterns, power-user techniques. This layer answers "what are the best practitioners actually doing?" rather than "is this good?"

### Pattern Extraction Mode

For categories where **how people use it** matters more than **whether they like it** (software, tools, protocols, services with configurable workflows, AI tools, trading platforms), automatically activate pattern extraction alongside standard opinion aggregation.

**When to activate:** Auto-detect based on category. Always active for: Software/Apps, Tech/Electronics, AI tools, crypto protocols/platforms, any query containing "how to," "best way to," "setup," "workflow," "configure."

**What to extract:**
- **Top usage patterns** — the 3-5 most common ways people actually use it, ranked by frequency
- **Power-user techniques** — what experienced users do differently from beginners
- **Common configurations** — settings, parameters, integrations that come up repeatedly
- **Anti-patterns** — things people tried that don't work ("don't bother with X setting, it breaks Y")
- **Evolution patterns** — how usage has changed over time ("used to do X, now everyone does Y")

**Output:** Add a `🔧 USAGE PATTERNS` section to both compact and full output formats when pattern extraction is active. This section sits between strengths/issues and value analysis.

### Phase 3: Convergence Scoring

See `references/methodology.md` for full scoring rules. Summary:

- Start at **5.0** (neutral baseline)
- Each **confirmed strength** across 3+ sources: **+0.5**
- Each **confirmed issue** across 3+ sources: **-0.5**
- Severity multipliers: safety issue = **-1.5**, minor annoyance = **-0.25**
- Issue on 1 platform = anecdotal (note but don't score)
- Issue on 2 platforms = notable (half weight)
- Issue on 3+ platforms = confirmed (full weight)
- Cap at **1.0–10.0**

### Data Sufficiency Check (before scoring)

Before generating a verdict, assess data volume:
- **HIGH confidence:** 3+ Reddit threads with 50+ total comments, at least 1 expert/testing source, Amazon data available
- **MEDIUM confidence:** 2+ Reddit threads OR 1 expert source, limited cross-platform data
- **LOW confidence:** <2 sources, sparse reviews, niche product with little coverage

If LOW confidence: explicitly caveat the score, recommend the user do additional research, and note what specific data is missing. Do NOT produce a confident-looking 7.5/10 score on thin data. A low-confidence 6.0 with honest caveats is more useful than a false-precision 7.3.

### Phase 4: Output

`research.js` now returns structured JSON by default. Use `--format structured` (default), `--format raw`, or `--format both` when you need the old raw source dump alongside the synthesized result.

**Chat delivery (Telegram/Discord):** Use the COMPACT format below — keep under 3000 chars. Save the full detailed report to `memory/research/[product-name].md`.

**File delivery (when asked for full report):** Use the FULL template.

#### Compact Format (for chat):
```
📊 [Product Name] — [Score]/10 ([Confidence])
📅 Sources: [date range + weighting note]

👤 Best for: [one line]
🏆 Top strengths: [2-3 bullet points]  
🚩 Top issues: [2-3 bullet points]
🔧 How people use it: [2-3 patterns — only if pattern extraction active]
💰 Best value: [product] at $X.XX/serving
🔄 Top alternative: [product] — [why]
💀 Dealbreakers: [none / detail]

Full report saved → memory/research/[slug].md

[VERIFICATION STAMP — mandatory, always last line]
```

#### Full Format (for files):
Use this exact template:

```
📊 RESEARCH VERDICT: [Product/Service Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏆 Consensus Score: X.X/10
🔍 Confidence: HIGH/MEDIUM/LOW (based on source volume + agreement)
⚠️ Fake Review Risk: LOW/MEDIUM/HIGH

👤 WHO IS THIS FOR:
• Best for: [specific use-case/person profile]
• Not for: [who should avoid and why]

✅ CONFIRMED STRENGTHS (3+ sources agree):
• [strength] — [which sources confirmed]

🚩 CONFIRMED ISSUES (3+ sources agree):
• [issue] — [which sources confirmed] — [severity]

⚠️ NOTABLE CONCERNS (2 sources):
• [concern] — [sources]

🔧 USAGE PATTERNS (if pattern extraction active):
• Top pattern: [most common usage approach]
• Power-user tip: [what experienced users do differently]
• Common config: [typical setup/settings]
• Anti-pattern: [what doesn't work]
• Trend: [how usage has evolved recently]

📊 SOURCE BREAKDOWN:
• Reddit (r/xxx, N comments): [key takeaway]
• Amazon (X.X★ verified, N reviews): [key takeaway]
• [Other sources]: [key takeaway]

💰 VALUE ANALYSIS (cost per serving):
• [Product A]: $X.XX/serving (container size, servings per container, price)
• [Product B]: $X.XX/serving
• Best value: [product] at $X.XX/serving
• Best quality-adjusted value: [product] — [reasoning]

🔄 TOP ALTERNATIVES MENTIONED:
• [competitor] — mentioned N times as preferred, why

💀 DEALBREAKER CHECK:
• Safety issues: [yes/no + detail]
• Widespread failures: [yes/no + detail]
• Customer service: [pattern if found]

📅 Review Freshness: [oldest/newest reviews considered, temporal relevance]

[VERIFICATION STAMP — mandatory, always last line]
```

### Phase 5: Save to History

After delivering results, save a summary to `memory/research/[product-name].md` with:
- Query, date, verdict, score, key findings, sources consulted
- This builds a personal review database over time

### Phase 6: Verification Stamp — MANDATORY, CANNOT BE SKIPPED

**Every single research output MUST end with a verification stamp.** No exceptions. No "I forgot." No "it wasn't needed for this one." If there is no stamp, the research is invalid.

The stamp is ONE line at the very bottom of the output. It is computed from what actually happened during the research, not self-reported.

**Tracking (internal):** As you execute Phases 1-4, maintain a checklist:
```
_sources_used: [list of source types actually queried]
_reddit_deep_read: true/false (did you fetch full comment trees?)
_x_dual_pass: true/false (did you run BOTH complaint AND positive searches?)
_convergence_applied: true/false (did 3+ sources agree on at least 1 theme?)
_temporal_scope_applied: true/false
_brand_intel_checked: true/false
_pattern_extraction: true/false/NA (only for applicable categories)
_search_provider: brave/ddg/mixed
_reddit_source: live/cached/fallback
_total_sources: number
```

**Stamp logic:**

✅ **Verified** — ALL of these must be true:
- 3+ distinct source types queried (Reddit, Amazon, X, expert, YouTube count as separate types)
- Reddit deep read completed (live or cached)
- X dual-pass completed (both searches)
- Convergence scoring applied (at least 1 confirmed theme at 3+ sources)
- Brand intel checked
- Temporal scope applied (for categories that require it)

Format: `✅ Verified — [N] sources, [N]+ convergence, [CONFIDENCE] confidence | v5`

⚠️ **Partial** — Research ran but one or more of these degraded:
- A required source type was unavailable (Reddit blocked, X search failed)
- Using cached/fallback data instead of live
- Fewer than 3 source types
- Convergence scoring ran but no themes hit 3+ agreement

Format: `⚠️ Partial — [N] sources, [degradation reason] | v5`

❌ **Incomplete** — Below minimum threshold:
- Fewer than 2 source types
- No Reddit data at all
- No convergence scoring possible
- Skipped required methodology steps

Format: `❌ Incomplete — [N] sources, [what's missing] | v5`

**The stamp is the LAST thing in the output.** After the compact format, after the full format, after everything. It is the final line. Always.

After delivery, prompt: *"After purchase, run `feedback '[product]' --satisfaction [1-10]` to improve future accuracy."*

If calibration data exists, include in output: *"Calibration: based on N past purchases, scores tend to be [optimistic/pessimistic/accurate] by X points."*

## Research Depth Modes

- **Quick** — 2-3 searches, Reddit + one expert source, compact output only. Use for: simple Amazon purchases under $50, commodity products, "which brand of X should I get?"
- **Standard** — Full research loop as described above, including X dual-pass and temporal scoping. Use for: most product/service research, health products, things over $50.
- **Deep** — Standard + YouTube transcripts + full pattern extraction + sub-agent parallelization. Use for: health/supplement decisions, expensive purchases ($200+), services with ongoing commitments, anything where a wrong choice has real consequences.

Auto-select depth based on query context. When unclear, default to Standard.

## Category Detection

Auto-detect from query context. When ambiguous, ask. Categories determine which sources to prioritize and temporal decay to apply. See `references/methodology.md` for category-specific source maps and decay rates.

## Important Rules

- **Never rely on a single source.** Minimum 3 platforms before issuing a verdict.
- **Reddit weight is highest** for anecdotal experience — real people with nothing to gain.
- **Discount professional review sites** unless they're methodology-driven (Wirecutter, rtings.com).
- **Amazon: verified purchases only.** Ignore unverified. The 2-4 star range is most honest.
- **Flag Fakespot/ReviewMeta adjusted scores** when available for Amazon products.
- **Temporal decay matters.** A 3-year-old restaurant review is noise. A 3-year-old cast-iron pan review is gold.
- **Weight review quality, not just platform.** A 200-comment Reddit thread > a 3-comment post.
- **Normalize prices to cost-per-serving** at the recommended dose, not just container price. A $30 container with 60 servings ($0.50/serving) is better value than a $15 container with 20 servings ($0.75/serving). Always compute this for product comparisons.
- **Update brand intel after research.** After completing research, update `references/brand-intel.json` and regenerate `references/brand-intel.md`:
  - Preserve manual entries in the JSON sidecar
  - Append new auto signals per brand and category when 2+ claims converge
  - Product-specific flags still matter: note which product the signal applies to (e.g., NOW Foods flagged for glycine, not all products)
- **YouTube fallback:** If transcript extraction fails (no captions available), fall back to searching `"[product] review" site:youtube.com` and use the video descriptions + search snippets for signal. Don't skip YouTube entirely.

## Parallel Research Mode (for sub-agents)

When running as a sub-agent or when speed matters, parallelize source collection across multiple agents:

- **Agent 1 — Reddit:** Deep reads of 2-3 threads via JSON endpoint. Extract themes, sentiment, brands mentioned, alternatives mentioned.
- **Agent 2 — Expert/Professional:** Wirecutter, ConsumerLab, rtings, niche forums. Extract methodology-driven findings.
- **Agent 3 — Broad Web:** Amazon snippets, Twitter/X complaints, YouTube transcripts, general web reviews.
- **Synthesizer:** Receives all agent results, runs convergence scoring per methodology, produces final verdict.

Each agent should return structured data:
```json
{
  "source": "reddit",
  "threads_analyzed": 3,
  "total_comments": 127,
  "themes": [
    {"theme": "purity concerns", "sentiment": "negative", "mentions": 8, "quotes": ["..."]}
  ],
  "brands_mentioned": ["Nutricost", "NOW Foods", "Thorne"],
  "alternatives_mentioned": ["Swanson Ajipure", "BulkSupplements"],
  "price_data": [
    {"brand": "Nutricost", "price": 15.99, "servings": 120, "per_serving": 0.13}
  ]
}
```

The synthesizer applies convergence scoring from `references/methodology.md` and generates the final output template. This mode is optional — single-agent sequential research is the default.

---

## v5 Features

### Search Provider Fallback
The CLI no longer requires `BRAVE_API_KEY`. If Brave is unavailable (quota exceeded, key missing, rate limited), it automatically falls back to DuckDuckGo HTML search. Lower quality results but always available. Check provider status with `research.js status`.

### Reddit Resilience Layer
Reddit fetching now uses a 3-strategy cascade:
1. JSON endpoint (best quality, full comment scores)
2. Old Reddit HTML parsing (simpler DOM, works when JSON is blocked)
3. Generic web fetch (last resort, extracts what it can)

Successful fetches are cached in `data/reddit-cache/` for 7 days. Health is tracked in `data/reddit-health.json`.

### Scoring Calibration & Feedback Loop
After purchasing a researched product, record satisfaction:
```bash
node scripts/research.js feedback "creatine monohydrate" --satisfaction 8 --notes "dissolved well"
```
After 5+ entries, calibration kicks in — surfaces whether scores tend to be optimistic, pessimistic, or accurate. Future research output includes a calibration note when available.

### Smart Watchlist (Deep Check)
```bash
node scripts/research.js watchlist check --deep         # Deep check top 3 items
node scripts/research.js watchlist check --deep --budget 5  # Deep check top 5
```
Deep checks run standard-depth research (not quick) and compare new themes against the original:
- Detects **NEW ISSUES** (complaint patterns that didn't exist before)
- Detects **REFORMULATIONS** (keywords like "new formula," "they changed")
- Detects **SCORE SHIFTS** (when enough new data moves the score by 0.5+ points)
- Budget-capped to avoid blowing API quotas (default: 3 items per run)

### Geographic Awareness
Location-dependent categories (restaurants, services) auto-detect and prompt for location. Set a default:
```json
// data/config.json
{ "defaultLocation": { "city": "Los Angeles", "state": "CA", "subreddits": ["r/LosAngeles", "r/FoodLosAngeles"] } }
```
Or use `--location "West Hollywood, CA"` per-query. Location is appended to all search queries and shown in output.

### Structured JSON Output (v5 Schema)
```bash
node scripts/research.js "creatine" --format json    # Canonical v5 JSON
node scripts/research.js "creatine" --format both     # JSON + raw
```
The v5 JSON schema (`references/schema.json`) provides a clean machine-readable format with `meta`, `verdict`, `claims`, `brands`, `alternatives`, and `sourceBreakdown` sections. Use `--format json` for dashboards and cross-skill consumption.

### System Status
```bash
node scripts/research.js status
```
Shows: schema version, search provider health, Reddit health, calibration data, watchlist summary, cache size, and default location.
