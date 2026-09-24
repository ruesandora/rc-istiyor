/*
 * RC — Yahoo Finance: COMEX vadeli (gümüş SI=F, altın GC=F). Anahtar gerekmez; yalnızca sunucuda.
 * TradingView karşılığı: COMEX:SI1! / COMEX:GC1!
 * Resmî bir API değildir; hata verirse market.js bir sonraki kaynağa (Binance) geçer.
 *
 * 4 saatlik Yahoo'da yok: 1 saatlik mumlardan UTC'ye hizalı toplanır.
 */
'use strict';

const { aggregate, to4h } = require('./twelvedata.js');

const { ASSETS } = require('../js/data.js');
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

async function chart(symbol, interval, range) {
  const res = await fetch(`${BASE}${symbol}?interval=${interval}&range=${range}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; rc-gumus/1.0)', accept: 'application/json' }
  });
  const j = await res.json().catch(() => ({}));
  const r = j.chart && j.chart.result && j.chart.result[0];
  if (!res.ok || !r || !r.timestamp) {
    const err = j.chart && j.chart.error;
    throw new Error('Yahoo: ' + (err ? err.description || err.code : 'HTTP ' + res.status));
  }
  const q = r.indicators.quote[0], out = [];
  r.timestamp.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].every(v => v != null && isFinite(v))) out.push({ time: t, open: o, high: h, low: l, close: c });
  });
  // aynı zaman damgası iki kez gelirse sonuncusu kalsın
  return out.filter((c, i) => i === out.length - 1 || out[i + 1].time !== c.time);
}

/** { '1h', '4h', '1d', '1w' } → mum dizileri (3 istek). */
async function loadAll(asset) {
  const s = (ASSETS[asset] || ASSETS.silver).yahoo;
  const [hourly, daily, weekly] = await Promise.all([chart(s, '1h', '180d'), chart(s, '1d', '5y'), chart(s, '1wk', '10y')]);
  if (hourly.length < 30 || daily.length < 30 || weekly.length < 30) throw new Error('Yahoo: yetersiz veri');
  return {
    '1h': hourly.slice(-600),
    '4h': aggregate(hourly, to4h).slice(-600),
    '1d': daily.slice(-600),
    '1w': weekly.slice(-600)
  };
}

function source(asset) { const a = ASSETS[asset] || ASSETS.silver; return `Yahoo Finance · ${a.yahooName} (${a.yahoo})`; }
function symbol(asset) { return (ASSETS[asset] || ASSETS.silver).tvYahoo; }

module.exports = { loadAll, source, symbol };
