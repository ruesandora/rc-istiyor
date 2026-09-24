/*
 * RC — Site verisi: tüm periyotların mumları tek istekte.
 *   GET /api/status?asset=silver|gold → { at, asset, source, symbol, timeframes: { '1d': { candles: [[t,o,h,l,c], ...] } | { error }, ... } }
 * Veri 5 dk saklanır (lib/market.js); CDN de 5 dk önbellekler.
 */
'use strict';

const { loadMarket, TTL, ASSETS } = require('../lib/market.js');

module.exports = async function handler(req, res) {
  try {
    const asset = ASSETS.includes((req.query || {}).asset) ? req.query.asset : 'silver';
    const m = await loadMarket(process.env, asset);
    const timeframes = {};
    for (const [tf, c] of Object.entries(m.timeframes)) {
      timeframes[tf] = Array.isArray(c) ? { candles: c.map(x => [x.time, x.open, x.high, x.low, x.close]) } : c;
    }
    const ok = Object.values(timeframes).every(t => t.candles);
    res.setHeader('cache-control', ok ? `public, s-maxage=${TTL}, stale-while-revalidate=600` : 'public, s-maxage=30');
    res.status(200).json({ at: m.at, asset, source: m.source, symbol: m.symbol, timeframes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
