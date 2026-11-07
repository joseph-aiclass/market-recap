#!/usr/bin/env node
/**
 * fetch_data.mjs — builds data/latest.json for the US Market Recap dashboard.
 *
 * Data sources (no API key required):
 *   - Yahoo Finance chart API      -> index / stock closes, % change, sparklines
 *   - Yahoo Finance screener API   -> day gainers / losers (US, cap-filtered)
 *   - Yahoo Finance search API     -> headlines used as catalysts + market drivers
 *
 * Usage: node scripts/fetch_data.mjs
 */

import { writeFile, mkdir, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "data", "latest.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function getJSON(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const fmt2 = (n) =>
  n == null || Number.isNaN(n)
    ? "n/a"
    : new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const pct = (n) => (n == null || Number.isNaN(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

const dateIn = (unix, tz) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unix * 1000));

const longIn = (unix, tz) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(unix * 1000));

const etDate = (unix) => dateIn(unix, "America/New_York");
const etLong = (unix) => longIn(unix, "America/New_York");

const hkDate = (unix) => dateIn(unix, "Asia/Hong_Kong");
const hkLong = (unix) => longIn(unix, "Asia/Hong_Kong");

const zhLong = (unix, tz) =>
  new Intl.DateTimeFormat("zh-Hant-HK", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(unix * 1000));

const hkt = (date = new Date()) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

const INDICES = [
  { sym: "^GSPC", name: "S&P 500", nameZh: "標普500", short: "SPX" },
  { sym: "^IXIC", name: "Nasdaq Composite", nameZh: "納斯達克綜合", short: "COMP" },
  { sym: "^DJI", name: "Dow Jones", nameZh: "道瓊斯", short: "DJI" },
  { sym: "^RUT", name: "Russell 2000", nameZh: "羅素2000", short: "RUT" },
];

const CROSS = [
  { sym: "^TNX", key: "yield10y", label: "US 10Y yield", labelZh: "美國10年期債息", kind: "yield" },
  { sym: "DX-Y.NYB", key: "dxy", label: "US Dollar (DXY)", labelZh: "美匯指數", kind: "index" },
  { sym: "CL=F", key: "wti", label: "WTI crude", labelZh: "紐約期油", kind: "usd" },
  { sym: "^VIX", key: "vix", label: "VIX", labelZh: "波動率指數", kind: "index" },
];

const AI_GROUPS = [
  {
    category: "Semiconductors",
    categoryZh: "半導體",
    tickers: [
      ["NVDA", "NVIDIA"],
      ["AMD", "AMD"],
      ["AVGO", "Broadcom"],
      ["TSM", "TSMC"],
      ["MU", "Micron"],
      ["ASML", "ASML"],
      ["ARM", "Arm Holdings"],
      ["MRVL", "Marvell"],
    ],
  },
  {
    category: "Hyperscalers",
    categoryZh: "雲端巨頭",
    tickers: [
      ["MSFT", "Microsoft"],
      ["GOOGL", "Alphabet"],
      ["AMZN", "Amazon"],
      ["META", "Meta Platforms"],
      ["ORCL", "Oracle"],
    ],
  },
  {
    category: "AI software",
    categoryZh: "AI 軟件",
    tickers: [
      ["PLTR", "Palantir"],
      ["CRM", "Salesforce"],
      ["NOW", "ServiceNow"],
      ["SNOW", "Snowflake"],
      ["CRWD", "CrowdStrike"],
    ],
  },
  {
    category: "Power & data-center",
    categoryZh: "電力及數據中心",
    tickers: [
      ["VRT", "Vertiv"],
      ["ANET", "Arista Networks"],
      ["SMCI", "Super Micro"],
      ["DELL", "Dell"],
      ["CEG", "Constellation Energy"],
    ],
  },
];

const HK_INDICES = [
  { sym: "^HSI", name: "Hang Seng Index", nameZh: "恒生指數", short: "HSI" },
  { sym: "HSTECH.HK", name: "Hang Seng Tech", nameZh: "恒生科技指數", short: "HSTECH" },
  { sym: "^HSCE", name: "Hang Seng China Enterprises", nameZh: "國企指數", short: "HSCE" },
];

// [Yahoo symbol, Traditional Chinese name, English search name]
const HK_STOCKS = [
  ["0700.HK", "騰訊控股", "Tencent"],
  ["9988.HK", "阿里巴巴", "Alibaba"],
  ["3690.HK", "美團", "Meituan"],
  ["1810.HK", "小米集團", "Xiaomi"],
  ["9618.HK", "京東集團", "JD.com"],
  ["1024.HK", "快手", "Kuaishou"],
  ["9888.HK", "百度集團", "Baidu"],
  ["9999.HK", "網易", "NetEase"],
  ["2318.HK", "中國平安", "Ping An"],
  ["1299.HK", "友邦保險", "AIA"],
  ["0388.HK", "香港交易所", "HKEX"],
  ["0005.HK", "滙豐控股", "HSBC"],
  ["0939.HK", "建設銀行", "China Construction Bank"],
  ["0883.HK", "中國海洋石油", "CNOOC"],
  ["0941.HK", "中國移動", "China Mobile"],
  ["2020.HK", "安踏體育", "ANTA Sports"],
  ["1211.HK", "比亞迪股份", "BYD"],
  ["0175.HK", "吉利汽車", "Geely"],
  ["0669.HK", "創科實業", "Techtronic"],
  ["2382.HK", "舜宇光學科技", "Sunny Optical"],
  ["0981.HK", "中芯國際", "SMIC"],
  ["1347.HK", "華虹半導體", "Hua Hong"],
  ["0992.HK", "聯想集團", "Lenovo"],
  ["0763.HK", "中興通訊", "ZTE"],
  ["0293.HK", "國泰航空", "Cathay Pacific"],
  ["0016.HK", "新鴻基地產", "Sun Hung Kai"],
  ["0001.HK", "長和", "CK Hutchison"],
  ["0027.HK", "銀河娛樂", "Galaxy Entertainment"],
  ["1928.HK", "金沙中國", "Sands China"],
  ["6862.HK", "海底撈", "Haidilao"],
  ["2331.HK", "李寧", "Li Ning"],
];

/* ------------------------------------------------------------------ */
/* fetchers                                                            */
/* ------------------------------------------------------------------ */

async function chart(sym, tz = "America/New_York") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    sym,
  )}?range=1mo&interval=1d&includePrePost=false&events=div%2Csplits`;
  const j = await getJSON(url);
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(`no chart data for ${sym}`);

  const ts = result.timestamp ?? [];
  const closes = (result.indicators?.quote?.[0]?.close ?? []).map((c) => (typeof c === "number" ? c : null));

  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] != null) bars.push({ t: ts[i], c: closes[i] });
  }
  // Some Yahoo HK symbols (e.g. HSTECH.HK) expose only a single daily bar.
  // Fall back to the meta snapshot so the card still renders a real close.
  if (bars.length < 2) {
    const meta = result.meta ?? {};
    if (typeof meta.regularMarketPrice !== "number" || typeof meta.chartPreviousClose !== "number") {
      throw new Error(`not enough bars for ${sym}`);
    }
    return {
      sym,
      price: meta.regularMarketPrice,
      close: meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose,
      changePct: (meta.regularMarketPrice / meta.chartPreviousClose - 1) * 100,
      sessionUnix: meta.regularMarketTime ?? Math.floor(Date.now() / 1000),
      sessionDate: dateIn(meta.regularMarketTime ?? Date.now() / 1000, tz),
      spark: [meta.chartPreviousClose, meta.regularMarketPrice],
      name: meta.longName || meta.shortName || sym,
      currency: meta.currency || "HKD",
    };
  }

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const changePct = (last.c / prev.c - 1) * 100;
  const price = result.meta?.regularMarketPrice ?? last.c;

  return {
    sym,
    price,
    close: last.c,
    prevClose: prev.c,
    changePct,
    sessionUnix: last.t,
    sessionDate: dateIn(last.t, tz),
    spark: bars.slice(-10).map((b) => b.c),
    name: result.meta?.longName || result.meta?.shortName || sym,
    currency: result.meta?.currency || "USD",
  };
}

async function screener(scrId, count = 100) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}`;
  const j = await getJSON(url);
  return j?.finance?.result?.[0]?.quotes ?? [];
}

const GENERIC =
  /(top (premarket|midday|stories|gainers|losers|analyst)|market (wrap|update|today|close)|what to watch|stocks to watch|stock market today|premarket movers|midday movers|after-hours movers|recap|briefing)/i;

const CATALYST_WORDS =
  /(earnings|results|revenue|profit|guidance|forecast|outlook|beats|misses|upgrade|downgrade|price target|raises|cuts|acquire|acquisition|merger|deal|contract|order|approval|launch|partnership|soar|surge|jumps|rally|fall|drop|sink|plunge|slide|tumble|slump|wins|warns|probe|lawsuit)/i;

async function newsFor(sym, limit = 8) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    sym,
  )}&newsCount=${limit}&quotesCount=0&enableFuzzyQuery=false`;
  try {
    const j = await getJSON(url, 2);
    return j?.news ?? [];
  } catch {
    return [];
  }
}

function pickCatalyst(items, term, sessionUnix) {
  const day = 86400;
  const near = items.filter(
    (n) => Math.abs((n.providerPublishTime ?? 0) - sessionUnix) < 2 * day && !GENERIC.test(n.title || ""),
  );
  if (!near.length) return null;

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const needle = new RegExp(escaped, "i");

  const scored = near
    .map((n) => {
      const title = n.title || "";
      let score = 0;
      if (needle.test(title)) score += 2;
      if (CATALYST_WORDS.test(title)) score += 3;
      score += Math.max(0, 2 - Math.abs((n.providerPublishTime - sessionUnix) / day));
      return { n, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 2) return null;
  return {
    text: best.n.title.trim(),
    publisher: best.n.publisher || "Yahoo Finance",
    url: best.n.link || "",
  };
}

const cleanName = (q) =>
  (q.longName || q.shortName || q.displayName || q.symbol)
    .replace(/[,\s]+(Inc|Incorporated|Corp|Corporation|Ltd|Limited|PLC|Co|Company)\.?$/i, "")
    .trim();

const DRIVER_BAD =
  /^(top \d|best \d)|billionaire|etf|retire|dividend|how to|should you|52-week|cramer|podcast|transcript|buying opportunity|worth buying|review & preview|futures/i;
const DRIVER_BROAD = /(wall street|s&p 500|nasdaq|dow jones|u\.s\. stocks|us stocks|stock market|equities)/i;
const SINGLE_STOCK = /stock market today,?\s+[a-z]+\.?\s*\d+\s*:/i;
const DRIVER_PUBLISHERS = new Set([
  "Reuters",
  "Wall Street Journal",
  "Associated Press",
  "Bloomberg",
  "Yahoo Finance",
  "Barron's",
  "Investor's Business Daily",
  "CNBC",
  "Financial Times",
]);
const SOURCE_W = {
  Reuters: 5,
  "Wall Street Journal": 5,
  "Associated Press": 5,
  Bloomberg: 5,
  "Yahoo Finance": 4,
  "Barron's": 4,
  "Investor's Business Daily": 4,
  CNBC: 4,
};

function pickDrivers(items, sessionUnix) {
  const seen = new Set();
  const scored = items
    .filter((n) => {
      const t = n.title || "";
      const h = ((n.providerPublishTime ?? 0) - sessionUnix) / 3600;
      return (
        t &&
        h >= -18 &&
        h <= 14 &&
        !DRIVER_BAD.test(t) &&
        !SINGLE_STOCK.test(t) &&
        DRIVER_BROAD.test(t)
      );
    })
    .map((n) => {
      const pub = (n.publisher || "").replace(/^The\s+/i, "");
      let s = SOURCE_W[pub] ?? 2;
      if (!DRIVER_PUBLISHERS.has(pub)) s -= 6;
      if (/wall street|stock market today|stocks (rally|mixed|rebound)/i.test(n.title)) s += 2;
      s += Math.max(0, 2 - Math.abs(((n.providerPublishTime ?? 0) - sessionUnix) / 3600) / 6);
      return { n, s };
    })
    .sort((a, b) => b.s - a.s);

  if (process.env.DEBUG_DRIVERS) {
    console.log(scored.slice(0, 8).map(({ n, s }) => `  ${s.toFixed(1)}  ${n.publisher}: ${n.title}`).join("\n"));
  }

  const out = [];
  for (const { n } of scored) {
    const key = (n.title || "").toLowerCase().replace(/[^a-z ]/g, "").split(" ").slice(0, 8).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: n.title.trim(), publisher: n.publisher || "Yahoo Finance", url: n.link || "" });
    if (out.length === 3) break;
  }
  return out;
}

async function loadOverrides() {
  try {
    return JSON.parse(await readFile(resolve(ROOT, "data", "catalysts.json"), "utf8"));
  } catch {
    return {};
  }
}


/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const generatedAt = new Date();

// Anything that failed to fetch is recorded rather than silently dropped, so the
// page can say "3 of 24 names missing" instead of quietly showing a shorter list.
const failures = [];

console.log("Fetching indices + cross-asset …");
const [indices, cross] = await Promise.all([
  mapLimit(INDICES, 4, (i) => chart(i.sym).then((d) => ({ ...d, ...i }))),
  mapLimit(CROSS, 4, (c) => chart(c.sym).then((d) => ({ ...d, ...c }))),
]);

const sessionUnix = indices[0].sessionUnix;
const sessionDate = indices[0].sessionDate;
const sessionLabel = etLong(sessionUnix);

console.log("Fetching movers …");
const [gainRaw, loseRaw] = await Promise.all([screener("day_gainers"), screener("day_losers")]);

function pickMovers(rows, dir) {
  const MIN = 8e9;
  const ok = rows
    .filter(
      (q) =>
        q.quoteType === "EQUITY" &&
        q.regularMarketPrice >= 10 &&
        (q.marketCap ?? 0) >= MIN &&
        Number.isFinite(q.regularMarketChangePercent),
    )
    .sort((a, b) => (dir === "up" ? b.regularMarketChangePercent - a.regularMarketChangePercent : a.regularMarketChangePercent - b.regularMarketChangePercent));
  return ok.slice(0, 3);
}

let gainers = pickMovers(gainRaw, "up");
let losers = pickMovers(loseRaw, "down");

// Fallback: relax the cap floor if the large-cap screen is empty.
if (gainers.length + losers.length < 4) {
  const relaxed = (rows, dir) =>
    rows
      .filter((q) => q.quoteType === "EQUITY" && q.regularMarketPrice >= 5 && Number.isFinite(q.regularMarketChangePercent))
      .sort((a, b) => (dir === "up" ? b.regularMarketChangePercent - a.regularMarketChangePercent : a.regularMarketChangePercent - b.regularMarketChangePercent))
      .slice(0, 3);
  gainers = gainers.length ? gainers : relaxed(gainRaw, "up");
  losers = losers.length ? losers : relaxed(loseRaw, "down");
}

console.log(`  gainers: ${gainers.map((q) => q.symbol).join(", ")}`);
console.log(`  losers : ${losers.map((q) => q.symbol).join(", ")}`);

console.log("Fetching AI universe …");
const aiFlat = AI_GROUPS.flatMap((g) =>
  g.tickers.map(([sym, name]) => ({ sym, name, category: g.category, categoryZh: g.categoryZh })),
);
const aiQuotes = await mapLimit(aiFlat, 5, async (t) => {
  try {
    const d = await chart(t.sym);
    return { ...d, ...t };
  } catch (err) {
    console.warn(`  ! ${t.sym}: ${err.message}`);
    failures.push({ sym: t.sym, market: "US", section: "AI watchlist" });
    return { ...t, error: true, changePct: null, price: null, spark: [] };
  }
});
const ai = aiQuotes.filter((q) => !q.error);

console.log("Fetching Hong Kong market …");
const hkIndices = await mapLimit(HK_INDICES, 3, (i) =>
  chart(i.sym, "Asia/Hong_Kong").then((d) => ({ ...d, ...i })),
);
const hkSessionUnix = hkIndices.find((i) => i.sym === "^HSI")?.sessionUnix ?? hkIndices[0].sessionUnix;
const hkSessionDate = hkIndices.find((i) => i.sym === "^HSI")?.sessionDate ?? hkIndices[0].sessionDate;
const hkSessionLabel = hkLong(hkSessionUnix);

const hkQuotes = await mapLimit(HK_STOCKS, 5, async ([sym, nameZh, search]) => {
  try {
    const d = await chart(sym, "Asia/Hong_Kong");
    return {
      ...d,
      sym,
      name: (d.name || search).replace(/\s+(Limited|Ltd\.?|Inc\.?|Corporation|Company)$/i, ""),
      nameZh,
      search,
    };
  } catch (err) {
    console.warn(`  ! ${sym}: ${err.message}`);
    failures.push({ sym, market: "HK", section: "HK focus list" });
    return { sym, nameZh, search, error: true, changePct: null, price: null, spark: [] };
  }
});
const hk = hkQuotes.filter((q) => !q.error);
const hkSorted = [...hk].sort((a, b) => b.changePct - a.changePct);
const hkGainers = hkSorted.filter((q) => q.changePct > 0).slice(0, 3);
const hkLosers = hkSorted.filter((q) => q.changePct < 0).reverse().slice(0, 3);
const hkUp = hk.filter((q) => q.changePct > 0).length;
const hkDown = hk.filter((q) => q.changePct < 0).length;

console.log(`  HSI ${hkIndices[0].changePct.toFixed(2)}% · ${hkUp} up / ${hkDown} down`);
console.log(`  HK gainers: ${hkGainers.map((q) => q.sym).join(", ") || "none"}`);
console.log(`  HK losers : ${hkLosers.map((q) => q.sym).join(", ") || "none"}`);

console.log("Fetching catalysts …");
const moverList = [
  ...gainers.map((q) => ({ sym: q.symbol, name: cleanName(q), price: q.regularMarketPrice, changePct: q.regularMarketChangePercent })),
  ...losers.map((q) => ({ sym: q.symbol, name: cleanName(q), price: q.regularMarketPrice, changePct: q.regularMarketChangePercent })),
];

const aiExtremes = [...ai]
  .filter((q) => Number.isFinite(q.changePct))
  .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
  .slice(0, 6);

const catalystSyms = [...new Set([...moverList.map((m) => m.sym), ...aiExtremes.map((a) => a.sym)])];
const newsMap = {};
await mapLimit(catalystSyms, 4, async (sym) => {
  const items = await newsFor(sym);
  newsMap[sym] = pickCatalyst(items, sym, sessionUnix);
});

await mapLimit([...hkGainers, ...hkLosers], 3, async (q) => {
  const items = await newsFor(q.search, 10);
  newsMap[q.sym] = pickCatalyst(items, q.search, hkSessionUnix);
});

const driverPool = [];
for (const q of ["Nasdaq", "S&P 500", "Wall Street"]) {
  driverPool.push(...(await newsFor(q, 20)));
}
const drivers = pickDrivers(driverPool, sessionUnix).slice(0, 2);

// Optional curated Traditional Chinese translations for driver headlines,
// keyed by session date then exact English headline (data/drivers_zh.json).
let driverZh = {};
try {
  const raw = JSON.parse(await readFile(resolve(ROOT, "data", "drivers_zh.json"), "utf8"));
  driverZh = raw[sessionDate] ?? {};
} catch {
  driverZh = {};
}
const driverTextZh = (text) => {
  const norm = (s) => s.replace(/\u00a0/g, " ").trim();
  const hit = Object.entries(driverZh).find(([k]) => norm(k) === norm(text));
  return hit ? hit[1] : text;
};

/* ------------------------------------------------------------------ */
/* assemble                                                            */
/* ------------------------------------------------------------------ */

const overrides = (await loadOverrides())[sessionDate] ?? {};

const fallbackReason = (dir) =>
  dir === "up"
    ? "No company-specific catalyst in available headlines; moved with the broader tape."
    : "No company-specific catalyst in available headlines; sold off with the broader tape.";

const fallbackReasonZh = (dir) =>
  dir === "up" ? "跟隨大市向上，暫無公司層面消息。" : "跟隨大市向下，暫無公司層面消息。";

const reasonFor = (sym, dir) => {
  if (overrides[sym]) {
    return {
      reason: overrides[sym].text,
      reasonZh: overrides[sym].zh || fallbackReasonZh(dir),
      reasonUrl: overrides[sym].url || "",
      publisher: overrides[sym].publisher || "",
    };
  }
  const n = newsMap[sym];
  if (n) return { reason: n.text, reasonZh: "", reasonUrl: n.url || "", publisher: n.publisher || "" };
  return { reason: fallbackReason(dir), reasonZh: fallbackReasonZh(dir), reasonUrl: "", publisher: "" };
};

const movers = {
  gainers: moverList.slice(0, gainers.length).map((m) => ({
    ...m,
    direction: "up",
    name: m.name,
    ...reasonFor(m.sym, "up"),
  })),
  losers: moverList.slice(gainers.length).map((m) => ({
    ...m,
    direction: "down",
    name: m.name,
    ...reasonFor(m.sym, "down"),
  })),
};

const hkMover = (q, direction) => ({
  sym: q.sym,
  name: q.name,
  nameZh: q.nameZh,
  price: q.price,
  changePct: q.changePct,
  currency: q.currency,
  direction,
  ...reasonFor(q.sym, direction),
});

const hkMovers = {
  gainers: hkGainers.map((q) => hkMover(q, "up")),
  losers: hkLosers.map((q) => hkMover(q, "down")),
};

const aiSorted = [...ai].sort((a, b) => b.changePct - a.changePct);const aiHighlight = [
  ...aiSorted.filter((q) => q.changePct > 0).slice(0, 3),
  ...aiSorted.filter((q) => q.changePct < 0).reverse().slice(0, 2),
].map((q) => ({
  sym: q.sym,
  name: q.name,
  category: q.category,
  categoryZh: q.categoryZh,
  price: q.price,
  changePct: q.changePct,
  spark: q.spark,
  direction: q.changePct >= 0 ? "up" : "down",
  ...reasonFor(q.sym, q.changePct >= 0 ? "up" : "down"),
}));

const aiUp = aiSorted.filter((q) => q.changePct > 0).length;
const aiDown = aiSorted.filter((q) => q.changePct < 0).length;

const spx = indices.find((i) => i.sym === "^GSPC");
const ndx = indices.find((i) => i.sym === "^IXIC");
const vix = cross.find((c) => c.key === "vix");

const fiveDay = (i) =>
  i.spark.length >= 6 ? (i.spark[i.spark.length - 1] / i.spark[i.spark.length - 6] - 1) * 100 : null;

let tone = "Mixed";
if (spx.changePct >= 0.3 && ndx.changePct >= 0.3) tone = "Risk-on";
else if (spx.changePct <= -0.3 && ndx.changePct <= -0.3) tone = "Risk-off";
else if (spx.changePct > 0 || ndx.changePct > 0) tone = "Cautiously positive";
else tone = "Cautiously negative";

// Cross-asset display values
const crossOut = cross.map((c) => {
  if (c.kind === "yield") {
    // Yahoo quotes ^TNX directly as the 10Y yield in percent.
    const v = c.price;
    const p = c.prevClose;
    return { ...c, value: v, display: `${v.toFixed(2)}%`, changeBp: (v - p) * 100, changePct: c.changePct };
  }
  if (c.kind === "usd") return { ...c, value: c.price, display: `$${fmt2(c.price)}`, changePct: c.changePct };
  return { ...c, value: c.price, display: fmt2(c.price), changePct: c.changePct };
});

// Session / market-open context
const todayET = etDate(generatedAt.getTime() / 1000);
const todayHKT = etDate(generatedAt.getTime() / 1000 + 8 * 3600); // HKT date
const weekdayET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(generatedAt);
const weekend = ["Saturday", "Sunday"].includes(weekdayET);
const sameSession = todayET === sessionDate;

let note = "";
if (weekend) {
  note = "US markets are closed today (weekend). Showing the last completed session.";
} else if (!sameSession) {
  note = `US markets are closed today. Showing the last completed session.`;
} else {
  note = "Latest completed US session.";
}

// Headline bullets
const sessionLabelZh = zhLong(sessionUnix, "America/New_York");

const idxBullet = indices
  .map((i) => `${i.short} ${pct(i.changePct)} to ${fmt2(i.price)}`)
  .join(" · ");
const idxBulletZh = indices
  .map((i) => `${i.nameZh} ${pct(i.changePct)} 至 ${fmt2(i.price)}`)
  .join(" · ");

const y10 = crossOut.find((c) => c.key === "yield10y");
const dxy = crossOut.find((c) => c.key === "dxy");
const wti = crossOut.find((c) => c.key === "wti");
const bpStr = `${y10.changeBp >= 0 ? "+" : ""}${y10.changeBp.toFixed(0)}bp`;

const toneZh =
  ({ "Risk-on": "風險偏好", "Risk-off": "避險", "Cautiously positive": "審慎向好", "Cautiously negative": "審慎偏淡" }[tone]) ||
  tone;

const overview = [
  `Indices: ${idxBullet}.`,
  drivers.length
    ? `Drivers: ${drivers.map((d) => d.text).join("; ")}.`
    : `Drivers: no single macro catalyst dominated the session.`,
  `Cross-asset: 10Y ${y10.display} (${bpStr}) · DXY ${dxy.display} (${pct(dxy.changePct)}) · WTI ${wti.display} (${pct(
    wti.changePct,
  )}) · VIX ${fmt2(vix.price)} (${pct(vix.changePct)}).`,
  `Tone: ${tone.toLowerCase()}. The S&P 500 is ${pct(fiveDay(spx))} over five sessions and the AI complex ${
    aiUp >= aiDown ? `rose in ${aiUp} of ${ai.length} names` : `fell in ${aiDown} of ${ai.length} names`
  }.`,
];

const overviewZh = [
  `指數：${idxBulletZh}。`,
  drivers.length
    ? `消息面：${drivers.map((d) => driverTextZh(d.text)).join("；")}。`
    : `消息面：本交易日未有單一主導因素。`,
  `跨資產：10年期債息 ${y10.display}（${bpStr}）· 美匯指數 ${dxy.display}（${pct(
    dxy.changePct,
  )}）· 紐約期油 ${wti.display}（${pct(wti.changePct)}）· VIX ${fmt2(vix.price)}（${pct(vix.changePct)}）。`,
  `市況：${toneZh}。標普500 五個交易日${fiveDay(spx) >= 0 ? "升" : "跌"} ${Math.abs(fiveDay(spx)).toFixed(
    1,
  )}%；AI 板塊 ${ai.length} 隻中有 ${aiUp} 隻上升。`,
];

const hkIdxBullet = hkIndices
  .map((i) => `${i.short} ${pct(i.changePct)} to ${fmt2(i.price)}`)
  .join(" · ");
const hkIdxBulletZh = hkIndices
  .map((i) => `${i.nameZh} ${pct(i.changePct)} 至 ${fmt2(i.price)}`)
  .join(" · ");

const noteZh = weekend
  ? "今天美股休市（週末），以下為對上一個交易日的總結。"
  : sameSession
    ? "最新完成的美股交易日。"
    : "今天美股休市，以下為對上一個交易日的總結。";

/* ---------------------------- plain-text brief ---------------------------- */

const briefLines = [];
briefLines.push(`US Market Recap — ${sessionLabel}`);
briefLines.push("");
if (weekend) briefLines.push(`US markets are closed today (${weekdayET}). Below is the last completed session.`, "");
briefLines.push("Market overview");
briefLines.push(...overview.map((b) => `- ${b}`));
briefLines.push("");
briefLines.push("Highlighted stocks");
movers.gainers.forEach((m) => briefLines.push(`- ${m.sym} (${pct(m.changePct)}) — ${m.reason}`));
movers.losers.forEach((m) => briefLines.push(`- ${m.sym} (${pct(m.changePct)}) — ${m.reason}`));
briefLines.push("");
briefLines.push("AI-related stocks");
aiHighlight.forEach((m) => briefLines.push(`- ${m.sym} (${pct(m.changePct)}) — ${m.reason}`));
briefLines.push("");
briefLines.push("Hong Kong market");
briefLines.push(`- Indices: ${hkIdxBullet}.`);
briefLines.push(
  `- Breadth: ${hkUp} of ${hk.length} focus stocks advanced; ${hkDown} declined.`,
);
// Keep the whole brief under the 500-word cap: HK detail shrinks before anything else does.
const hkBriefMovers = [...hkMovers.gainers.slice(0, 2), ...hkMovers.losers.slice(0, 2)];
hkBriefMovers.forEach((m) => briefLines.push(`- ${m.sym} (${pct(m.changePct)}) — ${m.reason}`));
briefLines.push("");
briefLines.push("Not financial advice.");

const brief = briefLines.join("\n");
const wordCount = brief.split(/\s+/).filter(Boolean).length;

const briefZhLines = [];
briefZhLines.push(`美股收市摘要 — ${sessionLabelZh}`);
briefZhLines.push("");
if (weekend) briefZhLines.push(`今天美股休市（${weekdayET === "Saturday" ? "週六" : "週日"}）。以下為對上一個交易日的總結。`, "");
briefZhLines.push("市場概覽");
briefZhLines.push(...overviewZh.map((b) => `- ${b}`));
briefZhLines.push("");
briefZhLines.push("重點股票");
movers.gainers.forEach((m) => briefZhLines.push(`- ${m.sym}（${pct(m.changePct)}）— ${m.reasonZh || m.reason}`));
movers.losers.forEach((m) => briefZhLines.push(`- ${m.sym}（${pct(m.changePct)}）— ${m.reasonZh || m.reason}`));
briefZhLines.push("");
briefZhLines.push("AI 相關股票");
aiHighlight.forEach((m) => briefZhLines.push(`- ${m.sym}（${pct(m.changePct)}）— ${m.reasonZh || m.reason}`));
briefZhLines.push("");
briefZhLines.push("香港市場");
briefZhLines.push(`- 指數：${hkIdxBulletZh}。`);
briefZhLines.push(`- 焦點股 ${hk.length} 隻中，${hkUp} 隻上升、${hkDown} 隻下跌。`);
hkBriefMovers.forEach((m) =>
  briefZhLines.push(`- ${m.nameZh || m.name}（${pct(m.changePct)}）— ${m.reasonZh || m.reason}`),
);
briefZhLines.push("");
briefZhLines.push("以上不構成投資建議。");

const briefZh = briefZhLines.join("\n");
const wordCountZh = briefZh.replace(/\s+/g, "").length;

/* -------------------------------- output -------------------------------- */

const out = {
  meta: {
    generatedAt: generatedAt.toISOString(),
    generatedAtHKT: hkt(generatedAt),
    todayET,
    todayHKT,
    weekdayET,
    sessionDate,
    sessionLabel,
    sessionLabelZh,
    sessionCloseET: "16:00 ET",
    weekend,
    note,
    noteZh,
    tone,
    wordCount,
    wordCountZh,
    failures,
    failureCount: failures.length,
    sources: [
      { name: "Yahoo Finance", detail: "Chart API — daily closes, % change, sparklines" },
      { name: "Yahoo Finance", detail: "Screener API — US day gainers / losers" },
      { name: "Yahoo Finance", detail: "Search API — headlines used as catalysts" },
    ],
  },
  indices: indices.map((i) => ({
    sym: i.sym,
    name: i.name,
    nameZh: i.nameZh,
    short: i.short,
    price: i.price,
    changePct: i.changePct,
    weekChangePct: fiveDay(i),
    spark: i.spark,
  })),
  crossAsset: crossOut.map((c) => ({
    key: c.key,
    label: c.label,
    labelZh: c.labelZh,
    display: c.display,
    changePct: c.changePct,
    changeBp: c.changeBp ?? null,
  })),
  overview,
  overviewZh,
  drivers: drivers.map((d) => ({ ...d, zh: driverTextZh(d.text) })),
  movers,
  ai: {
    groups: AI_GROUPS.map((g) => ({
      category: g.category,
      categoryZh: g.categoryZh,
      stocks: ai
        .filter((q) => q.category === g.category)
        .sort((a, b) => b.changePct - a.changePct)
        .map((q) => ({
          sym: q.sym,
          name: q.name,
          price: q.price,
          changePct: q.changePct,
          spark: q.spark,
        })),
    })),
    highlight: aiHighlight,
    upCount: aiUp,
    downCount: aiDown,
    total: ai.length,
  },
  hk: {
    sessionDate: hkSessionDate,
    sessionLabel: hkSessionLabel,
    sessionLabelZh: zhLong(hkSessionUnix, "Asia/Hong_Kong"),
    indices: hkIndices.map((i) => ({
      sym: i.sym,
      name: i.name,
      nameZh: i.nameZh,
      short: i.short,
      price: i.price,
      changePct: i.changePct,
      weekChangePct: fiveDay(i),
      spark: i.spark,
    })),
    movers: hkMovers,
    upCount: hkUp,
    downCount: hkDown,
    total: hk.length,
  },
  brief,
  briefZh,
};

const failedCount = failures.length;
const usCount = indices.length + cross.length + ai.length;
const hkCount = hkIndices.length + hk.length;

await mkdir(dirname(OUT), { recursive: true });
// Write to a sibling temp file and rename, so an interrupted run can never leave
// a half-written data/latest.json that the dashboard would fail to parse.
const OUT_TMP = `${OUT}.tmp`;
await writeFile(OUT_TMP, JSON.stringify(out, null, 2), "utf8");
await rename(OUT_TMP, OUT);

console.log(`\nWrote ${OUT}`);
console.log(`Session ${sessionLabel} · ${note}`);
console.log(`Fetched ${usCount} US + ${hkCount} HK quotes; ${failedCount} failed.`);
console.log(`Brief word count: ${wordCount}`);

// A handful of misses is normal (single-bar HK symbols, delisted tickers). More
// than that means the run is degraded, so exit non-zero and let the scheduler
// or the log wrapper surface it instead of shipping a quietly shorter report.
if (failedCount > 3) {
  console.error(`Degraded run: ${failedCount} symbols failed to fetch.`);
  process.exitCode = 1;
}
