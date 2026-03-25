# Consensus Research

Multi-source product, service, and restaurant research using weighted consensus scoring. Finds truth at the intersection of independent review platforms.

## How It Works

Instead of trusting any single source, this skill aggregates reviews from Reddit, Amazon, expert sites, YouTube, Twitter/X, and niche forums — then scores products based on **cross-platform convergence**. If 3+ independent sources agree on a strength or flaw, it's probably real.

### The Core Principle

> A complaint on 1 platform is anecdotal. On 2 platforms, it's notable. On 3+, it's confirmed.

## Features

- **Reddit Deep Read** — Fetches full comment trees via Reddit's JSON endpoint (no API key needed). This is where 60%+ of the signal lives.
- **Twitter/X Dual Signal Pass** — Scans X for both complaints AND positive signal. Catches real-time sentiment shifts, product changes, and usage patterns faster than any other platform.
- **Temporal Scoping** — `--recent` or `--since 30d` to scope all searches to a time window. Auto-scopes by category (software: 6mo, restaurants: 12mo, supplements: no scope). Sources outside the window get half weight or context-only.
- **Pattern Extraction** — For software, tools, and protocols: extracts HOW people actually use it (workflows, configs, power-user tips, anti-patterns), not just whether they like it. Auto-activates for applicable categories.
- **Weighted Source Hierarchy** — Reddit/HackerNews (HIGH) → Wirecutter/niche forums (MEDIUM-HIGH) → Amazon verified/X (MEDIUM) → Trustpilot/generic reviews (LOW)
- **Convergence Scoring** — 1-10 scale with severity multipliers. Safety issues hit harder than cosmetic complaints.
- **Category-Aware** — Products, supplements, restaurants, services, tech, software — each with tuned source maps and temporal decay rates.
- **Brand Intel Database** — Persistent reputation signals learned across research runs. Brands get flagged or trusted based on accumulated evidence.
- **Price Normalization** — Cost-per-serving at recommended dose, not just container price.
- **Competitor Auto-Discovery** — Finds alternatives organically from "switched from X" and "wish I got Y" patterns in reviews.
- **Data Sufficiency Gate** — Won't produce a confident score on thin data. LOW confidence = honest caveats.
- **Research Freshness Tracking** — Category-specific decay (restaurants: 6mo, supplements: 2yr, durable goods: 3yr). Temporal scoring weights recent sources higher.
- **Head-to-Head Comparison** — Simple differentiators between top 2 candidates: shared/unique strengths, issues, price winner.
- **Search Provider Fallback** — Brave → DuckDuckGo automatic failover. Works with zero API keys configured.
- **Reddit Resilience** — 3-strategy cascade (JSON endpoint → old.reddit HTML parse → web_fetch) with 7-day content cache. Reddit going down no longer kills research.
- **Scoring Calibration** — Tracks your actual satisfaction vs predicted scores. After 5+ data points, detects bias and adjusts future confidence notes.
- **Smart Watchlist (Deep Mode)** — `--deep` re-reads new content, compares themes to original research, flags reformulations and score shifts.
- **Geographic Awareness** — Auto-detects location-dependent queries (restaurants, services). `--location` flag or default in config.
- **Structured JSON Output** — `--format json` for machine-readable results. Canonical v5 schema for downstream tool consumption.
- **System Health Dashboard** — `research.js status` shows provider health, Reddit resilience state, calibration accuracy, watchlist summary.
- **File-Based Cache** — MD5-keyed query cache (30min TTL, 2hr for quick mode). No wasted API calls on repeat queries.
- **Auto-Save** — `--save` flag writes a readable markdown report + raw JSON to `memory/research/` with auto-generated filenames.
- **Cost Tracking** — Counts every Brave Search and Reddit API call per run. Shows estimated cost in output and stderr.
- **Product Watchlist** — Track products you care about. `watchlist check` re-runs quick research and detects changes in source counts.
- **Comment Score Filter** — `--min-score N` drops low-upvote Reddit comments before analysis, cutting noise from large threads.

## Research Depth Modes

| Mode | When to Use | Sources |
|------|-------------|---------|
| **Quick** | Simple Amazon purchases under $50 | 2-3 searches, 1 Reddit deep read |
| **Standard** | Most research (default) | Reddit (2-3 threads), Amazon, expert sites, X dual-pass, temporal scoping |
| **Deep** | Health products, $200+, ongoing commitments | Standard + YouTube transcripts + full pattern extraction + sub-agent parallelization |

## Usage

This is an [OpenClaw](https://github.com/openclaw/openclaw) skill. Install it in your OpenClaw workspace:

```bash
# Clone into your skills directory
cd ~/your-workspace/skills
git clone https://github.com/Bryptobricks/consensus-researcher.git
```

Then ask your agent to research something — it'll detect the skill automatically from your query context.

### Research Runner (CLI)

The `scripts/research.js` CLI automates data collection:

```bash
# Standard supplement research (works with or without BRAVE_API_KEY)
node scripts/research.js "glycine powder" --category supplement

# Recent-only research (last 30 days)
node scripts/research.js "cursor IDE" --since 30d

# Deep research with head-to-head comparison
node scripts/research.js "lion's mane" --depth deep --compare "Nootropics Depot" "Real Mushrooms"

# Quick product check
node scripts/research.js "USB-C hub" --depth quick

# Location-aware research
node scripts/research.js "best ramen" --location "Los Angeles"

# JSON output for downstream tools
node scripts/research.js "creatine" --format json

# Auto-save results as markdown + JSON
node scripts/research.js "creatine monohydrate" --save

# Filter out low-quality Reddit comments
node scripts/research.js "protein powder" --min-score 5

# Post-purchase feedback (improves future accuracy)
node scripts/research.js feedback "creatine monohydrate" --satisfaction 8 --notes "great results"

# Smart watchlist with deep theme comparison
node scripts/research.js watchlist add "Nutricost creatine" --note "daily supplement"
node scripts/research.js watchlist check --deep    # re-research, detect theme shifts
node scripts/research.js watchlist check           # shallow count check

# System health
node scripts/research.js status    # provider health, calibration, watchlist summary

# Cache management
node scripts/research.js cache clear
```

**Requirements:** Node.js 18+. Brave Search API key optional ([free tier: 2K queries/mo](https://brave.com/search/api/)) — DuckDuckGo fallback always available.

## File Structure

```
consensus-research/
├── SKILL.md                      # Full skill spec (OpenClaw reads this)
├── scripts/
│   ├── research.js               # CLI runner — research, feedback, watchlist, status
│   └── lib/
│       ├── search.js             # Search provider abstraction (Brave → DDG fallback)
│       ├── reddit.js             # Reddit resilience layer (3-strategy + cache)
│       └── feedback.js           # Scoring calibration & feedback loop
├── data/
│   ├── cache/                    # MD5-keyed query cache (auto-managed)
│   ├── reddit-cache/             # Reddit thread cache (7-day TTL)
│   ├── config.json               # Default location + settings
│   ├── feedback.json             # Calibration data (auto-created on first feedback)
│   ├── search-health.json        # Search provider health tracking
│   └── watchlist.json            # Product watchlist with theme tracking
├── memory/
│   └── research/                 # Auto-saved research reports (.md + .json)
├── references/
│   ├── methodology.md            # Scoring framework, source weights, decay rates
│   ├── schema.json               # Canonical v5 JSON output schema
│   ├── brand-intel.json          # Persistent brand reputation data (machine-readable)
│   └── brand-intel.md            # Persistent brand reputation database (human-readable)
└── specs/
    └── v5-improvements.md        # v5 improvement spec (reference)
```

## Source Hierarchy

| Tier | Sources | Weight | Why |
|------|---------|--------|-----|
| 1 | Reddit, HackerNews | HIGH | Real users, no financial incentive |
| 2 | Wirecutter, rtings, niche forums, YouTube | MEDIUM-HIGH | Methodology-driven, actually test products |
| 3 | Amazon verified, Google Reviews, Twitter/X | MEDIUM | Good volume, filter for signal. X dual-pass catches both complaints and positive patterns |
| 4 | Trustpilot, generic review sites | LOW | Gamed, but patterns visible in volume |

## Scoring

Baseline **5.0** (neutral). Each confirmed strength across 3+ sources: **+0.5**. Each confirmed issue: **-0.5**. Severity multipliers: safety = -1.5, major failure = -1.0, minor = -0.25.

**Temporal scoring:** Sources within the category half-life get full weight. 1-2x half-life = half weight. Beyond 2x = context only.

| Score | Verdict |
|-------|---------|
| 8.0+ | Strong Buy |
| 6.5–7.9 | Buy with Caveats |
| 4.5–6.4 | Mixed |
| < 4.5 | Avoid |

## What's New (v5)

- **Search Provider Fallback** — Brave → DuckDuckGo auto-fallback. BRAVE_API_KEY no longer required. DDG always available as backup.
- **Reddit Resilience Layer** — 3-strategy fetch cascade (JSON → old.reddit HTML → web_fetch) + 7-day content cache + health tracking. No more single point of failure.
- **Scoring Calibration** — `feedback` command tracks predicted score vs actual satisfaction. After 5+ entries, detects systematic bias and surfaces calibration notes on future research.
- **Smart Watchlist** — `watchlist check --deep` reads new content since last research, compares themes, detects reformulations, flags score shifts. Budget-capped per check.
- **Geographic Awareness** — `--location` flag for location-dependent queries. Auto-detects restaurants/services. Default location in `data/config.json`.
- **JSON Schema v5** — `--format json` outputs canonical structured data. Machine-readable research results for downstream tools.
- **System Health** — `research.js status` shows search provider health, Reddit health, calibration state, and watchlist summary.

### v4 (previous)
- Temporal Scoping (`--recent`/`--since` flags + auto-scope by category)
- Twitter/X Dual Signal (positive + complaint pass)
- Pattern Extraction (usage workflows, power-user techniques, anti-patterns)
- Temporal Scoring (sources weighted by age relative to category half-life)

## Examples

**Glycine Powder Research** — Nutricost recommended over NOW Foods after Reddit deep reads revealed 4 independent complaints about NOW's glycine specifically (invisible in search snippets).

**Lion's Mane Research** — Nootropics Depot 8:1 Dual Extract scored 8.0/10 (best quality). Real Mushrooms = best value at $0.25/day. Host Defense FLAGGED — mycelium on grain, up to 70% rice filler.

## License

MIT
