/*
 * RC — Site verisi: tüm periyotların mumları tek istekte.
 *   GET /api/status → { at, timeframes: { '1d': { source, candles: [[t,o,h,l,c], ...] }, ... } }
 * Vercel CDN'de 60 sn önbelleklenir; Binance'e dakikada en fazla bir kez gidilir.
 */
'use strict';

const API = require('../js/data.js');

module.exports = async function handler(req, res) {
  const out = { at: new Date().toISOString(), timeframes: {} };
  await Promise.all(Object.keys(API.TIMEFRAMES).map(async tf => {
    try {
      const d = await API.loadSilver(tf);
      out.timeframes[tf] = { source: d.source, candles: d.candles.map(c => [c.time, c.open, c.high, c.low, c.close]) };
    } catch (e) {
      out.timeframes[tf] = { error: e.message };
    }
  }));
  res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).json(out);
};
