# AGENTS.md

## Purpose

Produce a daily recap of the **US stock market's most recent session** ("last night" in US time) plus the **same-day Hong Kong session**, delivered at **07:00 Hong Kong time (Asia/Hong_Kong, UTC+8)**.

## Schedule

- Run **every day at 07:00 HKT**.
- Convert the schedule correctly: 07:00 HKT = 23:00 UTC the previous day = the evening of the prior US trading day (18:00 ET during EST, 19:00 ET during EDT).
- Always report on the **most recently completed US trading session**, not the current one.
- If the US market was closed (weekend, public holiday, or halted), say so in one line and recap the last completed session instead. Do not invent data.

> Note: a schedule entry only describes the cadence. The snapshot refresh is wired to the GitHub Actions workflow `.github/workflows/update-data.yml`, which runs at 23:00 UTC (07:00 Asia/Hong_Kong) on GitHub's runners, writes `data/latest.json`, commits it, and lets GitHub Pages redeploy the live site at https://joseph-aiclass.github.io/market-recap/ . Check it with `gh run list --workflow update-data.yml --repo joseph-aiclass/market-recap`. The workflow refreshes the snapshot, but it does not itself write this brief — if a run is missing or degraded, say so rather than silently skipping. The local Windows task `MarketRecap 0700 HKT` (which runs `scripts\run_daily.cmd`) is **disabled** and kept only for manual runs, so it cannot race the workflow.

## Output requirements

- **Language:** English.
- **Format:** bullet points only. No long prose paragraphs.
- **Length:** **500 words maximum** for the whole report. Do not pad to hit the limit; being shorter is fine.
- **Accuracy:** use real, sourced data for the named session. Include the session date and data timestamp. Never fabricate tickers, prices, or percentage moves.
- Add a one-line "Not financial advice" note at the end.

## Report structure

### 1. Market overview
- Session date and close time.
- S&P 500, Nasdaq Composite, Dow Jones, Russell 2000: level and % change.
- Key drivers: macro data, Fed/rates, earnings, geopolitics.
- Cross-asset context: 10-year Treasury yield, US dollar (DXY), oil (WTI), VIX.
- One line on overall market tone (risk-on / risk-off / mixed).

### 2. Highlighted stocks
- The most notable movers of the session — **both gainers and decliners**. Never list only the winners.
- For each: **ticker**, company, **% move**, and a one-line reason (earnings, guidance, upgrade/downgrade, M&A, product news, etc.).
- Aim for 4–6 names; prioritize the largest / most market-relevant moves.

### 3. AI-related stocks (separate section)
- A **clearly separate section**, dedicated to AI-linked names: semiconductors (e.g. NVDA, AMD, AVGO, TSM, MU), hyperscalers (MSFT, GOOGL, AMZN, META), AI software/infrastructure, and power/data-center plays.
- Same rules: ticker, % move, one-line catalyst. Include laggards as well as leaders.
- Keep it independent from the general highlighted-stocks list; a name can appear in both only if it matters to both, and say so briefly.

### 4. Hong Kong market
- The **same trading day's HK session** (at 07:00 HKT the HK close is the previous afternoon, which is normally the same calendar date as the US close).
- Hang Seng Index, Hang Seng Tech, Hang Seng China Enterprises: level and % change.
- Breadth across the tracked HK watchlist, then the session's top gainers **and** decliners with the same ticker / % / one-line reason format.
- If a name has no company-specific news, say so instead of inventing a catalyst.

## Style rules

- Lead with the most important fact; no filler or generic commentary.
- Percentages to one decimal place; use the session's official close.
- Prefer primary sources (exchange data, company releases, major wires). Note the source if a figure is unusual.
- If data for a metric is unavailable, write "n/a" instead of guessing.

## Output skeleton

```
US Market Recap — <session date>

Market overview
- ...

Highlighted stocks
- <TICKER> (+x.x%) — reason
- <TICKER> (-x.x%) — reason

AI-related stocks
- <TICKER> (+x.x%) — reason
- <TICKER> (-x.x%) — reason

Hong Kong market
- Indices: HSI / HSTECH / HSCE, level and % change.
- Breadth: x of n watchlist names advanced.
- <TICKER> (+x.x%) — reason
- <TICKER> (-x.x%) — reason

Not financial advice.
```
