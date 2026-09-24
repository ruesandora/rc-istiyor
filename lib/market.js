/*
 * RC — Piyasa verisi (sunucu). Tek yerden: site (/api/status) ve bildirim (/api/check) aynı veriyi kullanır.
 *
 * TWELVEDATA_API_KEY varsa spot XAG/USD (Twelve Data), yoksa ya da hata verirse Binance XAGUSDT.
 * Twelve Data'nın ücretsiz kredisi az olduğu için sonuç 5 dk saklanır:
 *   - Redis (KV_REST_API_*) varsa tüm sunucular ortak kullanır
 *   - yoksa çalışan fonksiyonun belleğinde
 */
'use strict';

const API = require('../js/data.js');
const TD = require('./twelvedata.js');
const { store } = require('./alerts.js');

const TTL = 300;
const KEY = 'rc:market:v1';
let memo = null; // { at, data }

async function fromBinance() {
  const timeframes = {};
  let source = 'Binance · XAGUSDT perpetual';
  await Promise.all(Object.keys(API.TIMEFRAMES).map(async tf => {
    try {
      const d = await API.loadSilver(tf);
      timeframes[tf] = d.candles;
      source = d.source + ' perpetual';
    } catch (e) {
      timeframes[tf] = { error: e.message };
    }
  }));
  return { source, symbol: 'BINANCE:XAGUSDT.P', timeframes };
}

async function fresh(env) {
  if (env.TWELVEDATA_API_KEY) {
    try {
      return { source: TD.SOURCE, symbol: TD.SYMBOL, timeframes: await TD.loadAll(env.TWELVEDATA_API_KEY) };
    } catch (e) {
      const d = await fromBinance();
      d.warning = e.message;
      return d;
    }
  }
  return fromBinance();
}

/** { at, source, symbol, timeframes: { tf: candles[] | {error} } } */
async function loadMarket(env) {
  const now = Date.now();
  if (memo && now - memo.at < TTL * 1000) return memo.data;
  const kv = store(env);
  if (kv) {
    try {
      const cached = await kv.get(KEY);
      if (cached) {
        const data = JSON.parse(cached);
        memo = { at: Date.parse(data.at), data };
        if (now - memo.at < TTL * 1000) return data;
      }
    } catch (e) { /* depo yoksa doğrudan çek */ }
  }
  const data = Object.assign({ at: new Date(now).toISOString() }, await fresh(env));
  // Hatalı sonuç saklanmaz: bir sonraki istek yeniden dener
  if (Object.values(data.timeframes).every(Array.isArray)) {
    memo = { at: now, data };
    if (kv) kv.set(KEY, JSON.stringify(data), TTL).catch(() => {});
  }
  return data;
}

module.exports = { loadMarket, TTL };
