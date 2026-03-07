# Consensus Research

Multi-source product, service, and restaurant research using weighted consensus scoring. Finds truth at the intersection of independent review platforms.

## How It Works

Instead of trusting any single source, this skill aggregates reviews from Reddit, Amazon, expert sites, YouTube, and niche forums — then scores products based on **cross-platform convergence**. If 3+ independent sources agree on a strength or flaw, it's probably real.

### The Core Principle

> A complaint on 1 platform is anecdotal. On 2 platforms, it's notable. On 3+, it's confirmed.

## Features

- **Reddit Deep Read** — Fetches full comment trees via Reddit's JSON endpoint (no API key needed). This is where 60%+ of the signal lives.
- **Weighted Source Hierarchy** — Reddit/HackerNews (HIGH) → Wirecutter/niche forums (MEDIUM-HIGH) → Amazon verified (MEDIUM) → Trustpilot/generic reviews (LOW)
- **Convergence Scoring** — 1-10 scale with severity multipliers. Safety issues hit harder than cosmetic complaints.
- **Category-Aware** — Products, supplements, restaurants, services, tech, software — each with tuned source maps and temporal decay rates.
- **Brand Intel Database** — Persistent reputation signals learned across research runs. Brands get flagged or trusted based on accumulated evidence.
- **Price Normalization** — Cost-per-serving at recommended dose, not just container price.
- **Competitor Auto-Discovery** — Finds alternatives organically from "switched from X" and "wish I got Y" patterns in reviews.
- **Data Sufficiency Gate** — Won't produce a confident score on thin data. LOW confidence = honest caveats.
- **Research Freshness Tracking** — Category-specific decay (restaurants: 6mo, supplements: 2yr, durable goods: 3yr).
- **Head-to-Head Comparison** — Simple differentiators between top 2 candidates: shared/unique strengths, issues, price winner.
- **File-Based Cache** — MD5-keyed query cache (30min TTL, 2hr for quick mode). No wasted API calls on repeat queries.
- **Auto-Save** — `--save` flag writes a readable markdown report + raw JSON to `memory/research/` with auto-generated filenames.
- **Cost Tracking** — Counts every Brave Search and Reddit API call per run. Shows estimated cost in output and stderr.
- **Product Watchlist** — Track products you care about. `watchlist check` re-runs quick research and detects changes in source counts.
- **Comment Score Filter** — `--min-score N` drops low-upvote Reddit comments before analysis, cutting noise from large threads.

## Research Depth Modes

| Mode | When to Use | Sources |
|------|-------------|---------|
| **Quick** | Simple Amazon purchases under $50 | 2-3 searches, 1 Reddit deep read |
| **Standard** | Most research (default) | Reddit (2-3 threads), Amazon, expert sites, Brave general |
| **Deep** | Health products, $200+, ongoing commitments | Standard + YouTube transcripts + Twitter complaints |

## Usage

This is an [OpenClaw](https://github.com/openclaw/openclaw) skill. Install it in your OpenClaw workspace:

```bash
# Clone into your skills directory
cd ~/your-workspace/skills
git clone https://github.com/chainseeker44/consensus-research.git
```

Then ask your agent to research something — it'll detect the skill automatically from your query context.

### Research Runner (CLI)

The `scripts/research.js` CLI automates data collection:

```bash
# Standard supplement research
BRAVE_API_KEY=your_key node scripts/research.js "glycine powder" --category supplement

# Deep research with head-to-head comparison
BRAVE_API_KEY=your_key node scripts/research.js "lion's mane" --depth deep --compare "Nootropics Depot" "Real Mushrooms"

# Quick product check
BRAVE_API_KEY=your_key node scripts/research.js "USB-C hub" --depth quick

# Auto-save results as markdown + JSON
BRAVE_API_KEY=your_key node scripts/research.js "creatine monohydrate" --save

# Filter out low-quality Reddit comments
BRAVE_API_KEY=your_key node scripts/research.js "protein powder" --min-score 5

# Check research freshness
node scripts/research.js freshness ./memory/research/

# Product watchlist
node scripts/research.js watchlist add "Nutricost creatine" --note "daily supplement"
node scripts/research.js watchlist check    # re-research all, detect changes
node scripts/research.js watchlist          # show tracked products

# Cache management
node scripts/research.js cache clear        # clear all cached results
```

**Requirements:** Node.js 18+, Brave Search API key ([free tier: 2K queries/mo](https://brave.com/search/api/))

## File Structure

```
consensus-research/
├── SKILL.md                      # Full skill spec (OpenClaw reads this)
├── scripts/
│   └── research.js               # CLI data collection runner (1,347 lines, zero deps)
├── data/
│   ├── cache/                    # MD5-keyed query cache (auto-managed)
│   └── watchlist.json            # Product watchlist (created on first add)
├── memory/
│   └── research/                 # Auto-saved research reports (--save)
└── references/
    ├── methodology.md            # Scoring framework, source weights, decay rates
    └── brand-intel.md            # Persistent brand reputation database
```

## Source Hierarchy

| Tier | Sources | Weight | Why |
|------|---------|--------|-----|
| 1 | Reddit, HackerNews | HIGH | Real users, no financial incentive |
| 2 | Wirecutter, rtings, niche forums | MEDIUM-HIGH | Methodology-driven, actually test products |
| 3 | Amazon verified, Google Reviews, Twitter | MEDIUM | Good volume, filter for signal |
| 4 | Trustpilot, generic review sites | LOW | Gamed, but patterns visible in volume |

## Scoring

Baseline **5.0** (neutral). Each confirmed strength across 3+ sources: **+0.5**. Each confirmed issue: **-0.5**. Severity multipliers: safety = -1.5, major failure = -1.0, minor = -0.25.

| Score | Verdict |
|-------|---------|
| 8.0+ | Strong Buy |
| 6.5–7.9 | Buy with Caveats |
| 4.5–6.4 | Mixed |
| < 4.5 | Avoid |

## Examples

**Glycine Powder Research** — Nutricost recommended over NOW Foods after Reddit deep reads revealed 4 independent complaints about NOW's glycine specifically (invisible in search snippets).

**Lion's Mane Research** — Nootropics Depot 8:1 Dual Extract scored 8.0/10 (best quality). Real Mushrooms = best value at $0.25/day. Host Defense FLAGGED — mycelium on grain, up to 70% rice filler.

## License

MIT
