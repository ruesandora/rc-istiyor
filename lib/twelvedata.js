/*
 * RC — Twelve Data (spot XAG/USD) kaynağı. Yalnızca sunucuda; anahtar tarayıcıya gitmez.
 *
 * Ücretsiz planın günlük kredisi az olduğu için yalnızca iki seri çekilir:
 *   1 saatlik → 1h ve 4h (4 saatlik, 1 saatliklerden UTC'ye hizalı toplanır)
 *   günlük    → 1d ve 1w (haftalık, günlüklerden pazartesi başlangıçlı toplanır)
 */
'use strict';

const BASE = 'https://api.twelvedata.com/time_series';

async function series(interval, outputsize, key) {
  const url = `${BASE}?symbol=XAG/USD&interval=${interval}&outputsize=${outputsize}&timezone=UTC&order=asc&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const j = await res.json().catch(() => ({}));
  if (j.status !== 'ok' || !Array.isArray(j.values)) throw new Error('Twelve Data: ' + (j.message || 'HTTP ' + res.status));
  return j.values
    .map(v => ({
      time: Math.floor(Date.parse(v.datetime.replace(' ', 'T') + (v.datetime.length > 10 ? 'Z' : 'T00:00:00Z')) / 1000),
      open: +v.open, high: +v.high, low: +v.low, close: +v.close
    }))
    .filter(c => isFinite(c.time) && isFinite(c.close))
    .sort((a, b) => a.time - b.time);
}

/** Mumları `bucket(time)` anahtarına göre birleştirir. */
function aggregate(candles, bucket) {
  const out = [];
  for (const c of candles) {
    const t = bucket(c.time), last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else {
      out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    }
  }
  return out;
}

const H4 = 4 * 3600, WEEK = 7 * 86400, MONDAY = 3 * 86400; // 1970-01-01 perşembe
const to4h = t => Math.floor(t / H4) * H4;
const toWeek = t => Math.floor((t + MONDAY) / WEEK) * WEEK - MONDAY;

/** { '1h', '4h', '1d', '1w' } → mum dizileri. 2 istek (≈2 kredi). */
async function loadAll(key) {
  const [hourly, daily] = await Promise.all([series('1h', 2400, key), series('1day', 1500, key)]);
  return {
    '1h': hourly.slice(-600),
    '4h': aggregate(hourly, to4h).slice(-600),
    '1d': daily.slice(-600),
    '1w': aggregate(daily, toWeek).slice(-600)
  };
}

module.exports = { loadAll, aggregate, to4h, toWeek, SOURCE: 'Twelve Data · XAG/USD (spot)', SYMBOL: 'OANDA:XAGUSD' };
