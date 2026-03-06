---
name: consensus-research
description: Multi-source product, service, and restaurant research using weighted consensus scoring. Use when researching any purchase decision, comparing products/brands, evaluating services/providers, finding restaurants, or when the user asks for reviews, recommendations, or "is X worth it?" questions. Aggregates Reddit, Amazon, HackerNews, expert reviews, Twitter complaints, and niche forums — weights by platform reliability and cross-platform convergence. NOT for: quick price checks, simple spec lookups, or questions answerable from a single source.
---

# Consensus Research Skill

Multi-source research engine that finds truth at the intersection of independent review platforms. Core principle: **convergence across independent sources is the strongest signal.**

## When Triggered

1. Read `references/methodology.md` for the full scoring framework, source weights, and anti-noise filters
2. Detect the **category** from the query (product, supplement, restaurant, service, tech, health)
3. Execute the research loop below

## Pre-Research Check

Before starting new research:
1. Check `memory/research/` for existing entries on the same or related products/services
2. Check `references/brand-intel.md` for any known brand reputation signals
3. Surface findings proactively — e.g., *"Note: previous research flagged Nutricost's COA transparency issues"* or *"Brand intel shows NOW Foods FLAGGED for glycine specifically"*
4. If prior research exists and is within the temporal decay window, offer to update rather than start fresh

## Core Research Loop

### Phase 1: Parallel Source Collection

Fire site-scoped web searches simultaneously. Use `web_search` with site-scoping for each relevant platform:

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

For **Twitter/X complaints** (if API available): search `"[product/service name]" (broken OR terrible OR worst OR disappointed OR refund)` to surface failure patterns.

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

For each source, extract:
- **Recurring complaints** — group semantically similar issues into themes ("battery dies fast" = "poor battery life")
- **Recurring praise** — what keeps coming up positively
- **Failure timeline** — when do things break? (3 months? 1 year?)
- **Comparison mentions** — "switched from X" or "wish I got Y instead"
- **Competitor auto-discovery** — actively identify all competitor/alternative products mentioned in reviews. Look for patterns: "switched from X to Y", "I tried A, B, and C", "wish I got Y instead", "X is better than Y", "used to use Z". Build the competitor list dynamically from the reviews themselves — don't rely on pre-knowing competitors.
- **Use-case segments** — who loves it vs who hates it and why

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
```

### Phase 5: Save to History

After delivering results, save a summary to `memory/research/[product-name].md` with:
- Query, date, verdict, score, key findings, sources consulted
- This builds a personal review database over time

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
- **Update brand intel after research.** After completing research, update `references/brand-intel.md` with any new brand signals discovered.

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
