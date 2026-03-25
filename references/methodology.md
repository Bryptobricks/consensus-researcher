# Consensus Research Methodology

This methodology is applied after normalizing raw evidence into a claims layer. The script now returns structured output by default and uses `--format raw` only when the caller explicitly wants the source dump.

## Source Hierarchy & Weights

### Tier 1 — Highest Signal (weight: HIGH)
- **Reddit** — real users, no financial incentive, complaints are genuine. Prioritize subreddits specific to the product category.
- **HackerNews** — tech/SaaS/dev tools only. Highly informed users, low noise, no shilling.

### Tier 2 — Strong Signal (weight: MEDIUM-HIGH)
- **Wirecutter / rtings.com** — methodology-driven, actually buy and test products. NOT affiliate blogs.
- **Niche forums** — Head-Fi (headphones), AVSForum (AV), r/biohackers (supplements), r/skincareaddiction (skincare). Where obsessives live.
- **YouTube reviews** — visual proof, harder to fake. Discount sponsored content. Prioritize teardowns and long-term follow-ups.

### Tier 3 — Moderate Signal (weight: MEDIUM)
- **Amazon verified purchases** — filter verified only. 2-4 star reviews are most honest (5★ often incentivized, 1★ often emotional/irrelevant).
- **Google Reviews** — good volume for services/restaurants. Weight recency.
- **Twitter/X (dual pass)** — run both complaint search (`broken OR terrible OR refund OR worst`) AND positive search (`love OR best OR switched to OR game changer`). X catches real-time sentiment shifts, product changes, and usage patterns faster than any other platform. Use CLI first (`node tools/twitter/twitter.js search`), API as fallback.

### Tier 4 — Low Signal (weight: LOW)
- **Trustpilot** — companies game it, but patterns still visible in volume.
- **Generic professional review sites** — affiliate-biased. Useful for objective specs/measurements only.
- **Yelp** — known extortion model. Medium for restaurants (deep data), low for everything else.

### Meta Layer
- **Fakespot / ReviewMeta** — use as bot/fake detection on Amazon products. Report adjusted score vs raw score.

## Category-Specific Source Maps

### Products (Amazon purchases, physical goods)
**Primary:** Reddit, Amazon verified, Wirecutter/rtings
**Secondary:** YouTube reviews, Google Shopping reviews
**Search patterns:** `"[product]" review site:reddit.com`, `"[product]" verified purchase site:amazon.com`, `"[product]" vs site:reddit.com`
**Temporal decay half-life:** Durable goods = 3 years, Electronics = 1 year

### Supplements & Health Products
**Primary:** Reddit (r/supplements, r/nootropics, r/biohackers), PubMed (efficacy data)
**Secondary:** Labdoor/ConsumerLab (purity testing), Amazon verified
**Extra:** Look for third-party testing certifications, heavy metal testing
**Search patterns:** `"[supplement]" experience site:reddit.com`, `"[supplement]" review brand site:reddit.com`, `"[supplement]" third party tested`
**Temporal decay half-life:** 2 years

### Restaurants
**Primary:** Google Reviews, Reddit local subreddit (r/FoodLosAngeles, r/LosAngeles, etc.)
**Secondary:** Yelp (deep data despite model), Instagram (food photos/tags)
**Extra:** Weight recency HEAVILY — restaurants change fast (chef turnover, menu changes)
**Search patterns:** `"[restaurant]" site:reddit.com`, `"[restaurant]" review [city]`
**Temporal decay half-life:** 6 months

### Services (doctors, coaches, platforms, SaaS)
**Primary:** Reddit, Trustpilot, BBB
**Secondary:** Google Reviews, Twitter complaints
**Extra:** Look for customer service response patterns, pricing transparency complaints
**Search patterns:** `"[service]" review site:reddit.com`, `"[service]" experience site:reddit.com`, `"[service]" complaint`
**Temporal decay half-life:** 1 year

### Tech & Electronics
**Primary:** Reddit (r/headphones, r/buildapc, r/homeautomation, etc.), rtings.com, HackerNews
**Secondary:** YouTube teardowns, Amazon verified
**Extra:** GitHub repos can be useful for firmware utilities, developer hardware ecosystems, and issue-tracker health signals when a device has a public repo.
**Extra:** Look for long-term reliability reports (6-month, 1-year follow-ups)
**Search patterns:** `"[product]" review site:reddit.com`, `"[product]" long term site:reddit.com`, `"[product]" issues site:reddit.com`
**Temporal decay half-life:** 1 year

### Software & Apps
**Primary:** Reddit, HackerNews, G2/Capterra, GitHub
**Secondary:** Twitter complaints, ProductHunt reviews
**Extra:** GitHub repo health can provide adoption and maintenance signals. Fetch the repo page directly instead of trusting search snippets alone.
**Search patterns:** `"[software]" review site:reddit.com`, `"[software]" site:news.ycombinator.com`, `"[software]" alternative`, `"[software]" site:github.com`
**Temporal decay half-life:** 6 months

## Anti-Noise Filters

Apply these filters when extracting reviews:

1. **Strip incentivized reviews** — discard any review mentioning "received for free," "in exchange for review," "discount code"
2. **Discount extremes on Amazon** — 5★ and 1★ are most gamed. 2-4★ range is most honest
3. **Weight photo/video reviews higher** — evidence-backed, harder to fake
4. **Weight specific timeframes higher** — "After 6 months of daily use..." > "Just got this, love it!"
5. **Detect astroturfing** — same phrases across multiple reviews, review clustering on same dates, generic language
6. **Flag affiliate content** — reviews with affiliate links, "check link in bio," sponsored disclosures
7. **Engagement depth weighting** — a 200-comment Reddit thread with detailed experiences is worth 10x a 3-comment post

## Convergence Scoring Formula

### Baseline
- Start at **5.0** (neutral — no information either way)

### Adjustments
- Each **confirmed strength** (3+ independent sources agree): **+0.5**
- Each **confirmed issue** (3+ independent sources agree): **-0.5**

### Severity Multipliers
- **Safety issue** (health risk, fire hazard, data breach): **-1.5** per issue
- **Major functional failure** (product doesn't do its primary job): **-1.0** per issue  
- **Moderate issue** (inconvenience, design flaw, quality concern): **-0.5** per issue
- **Minor annoyance** (cosmetic, preference, nitpick): **-0.25** per issue

### Agreement Levels
- **1 platform mentions** = anecdotal — note in output but don't adjust score
- **2 platforms agree** = notable — apply half the adjustment
- **3+ platforms agree** = confirmed — apply full adjustment

### Quality Bonuses
- Product has extensive long-term reviews (1yr+): **+0.25**
- Multiple niche-expert sources confirm quality: **+0.25**
- Strong brand reputation / track record: **+0.25**

### Caps & Interpretation
- Score capped at **1.0 – 10.0**
- **8.0+** = Strong Buy — overwhelming positive convergence
- **6.5–7.9** = Buy with Caveats — generally positive, known trade-offs
- **4.5–6.4** = Mixed — significant disagreement or use-case dependent
- **Below 4.5** = Avoid — confirmed dealbreakers or widespread failures

## Temporal Decay Reference

| Category | Half-Life | Rationale |
|----------|-----------|-----------|
| Restaurants | 6 months | Chef/menu turnover, management changes |
| Software/Apps | 6 months | Updates change everything |
| Tech/Electronics | 1 year | Product revisions, firmware updates |
| Services | 1 year | Staff turnover, policy changes |
| Health services | 6 months | Provider changes, protocol updates |
| Supplements | 2 years | Formulation changes rare |
| Durable goods | 3 years | Cast iron, furniture, tools age slowly |

When searching, scope by recency: use `freshness` parameter or append year to search queries for categories with short half-lives.

### Temporal Scoring Rules

Sources are weighted by age relative to their category half-life:
- **Within half-life:** Full weight
- **1-2x half-life:** Half weight (note as "older source" in output)
- **Beyond 2x half-life:** Noted for context only, not scored
- **Explicit `--recent` / `--since` override:** Only sources within the specified window get full weight. Everything else = context only.

Always report the date range of sources used: "Sources: 8 results from Jan-Mar 2026, 3 from 2025 (half-weighted)."

## Research History

Save all completed research to `memory/research/[product-name-slug].md` with:
- Date of research
- Query / what was researched
- Consensus score + verdict
- Key confirmed strengths and issues
- Sources consulted with links
- "Who Is This For" summary
- Alternatives identified

This builds a personal review database. Before starting new research, check `memory/research/` for existing entries on the same product/service.
