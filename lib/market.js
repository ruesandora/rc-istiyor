/*
 * RC — Piyasa verisi (sunucu). Tek yerden: site (/api/status) ve bildirim (/api/check) aynı veriyi kullanır.
 *
 * Metal: 'silver' (gümüş) veya 'gold' (altın).
 * Öncelik: OANDA_API_KEY (spot) → Yahoo COMEX SI=F / GC=F (anahtarsız; YAHOO=off ile kapatılır)
 *          → TWELVEDATA_API_KEY → Binance XAGUSDT / XAUUSDT. Hata olursa bir sonrakine geçilir.
 * Twelve Data'nın ücretsiz kredisi az olduğu için sonuç 5 dk saklanır:
 *   - Redis (KV_REST_API_*) varsa tüm sunucular ortak kullanır
 *   - yoksa çalışan fonksiyonun belleğinde
 */
'use strict';

const API = require('../js/data.js');
const TD = require('./twelvedata.js');
const OANDA = require('./oanda.js');
const YAHOO = require('./yahoo.js');
const { store } = require('./alerts.js');

const TTL = 300;
const ASSETS = Object.keys(API.ASSETS);
const memo = {}; // asset -> { at, data }

async function fromBinance(asset) {
  const timeframes = {}, sym = API.ASSETS[asset].binance;
  let source = `Binance · ${sym} perpetual`;
  await Promise.all(Object.keys(API.TIMEFRAMES).map(async tf => {
    try {
      const d = await API.loadAsset(tf, asset);
      timeframes[tf] = d.candles;
      source = d.source + ' perpetual';
    } catch (e) {
      timeframes[tf] = { error: e.message };
    }
  }));
  return { source, symbol: `BINANCE:${sym}.P`, timeframes };
}

async function fresh(env, asset) {
  const warnings = [];
  if (env.OANDA_API_KEY) {
    try {
      return { source: OANDA.source(asset), symbol: OANDA.symbol(asset), timeframes: await OANDA.loadAll(env.OANDA_API_KEY, env.OANDA_ENV, asset) };
    } catch (e) { warnings.push(e.message); }
  }
  if (env.YAHOO !== 'off') {
    try {
      return { source: YAHOO.source(asset), symbol: YAHOO.symbol(asset), timeframes: await YAHOO.loadAll(asset) };
    } catch (e) { warnings.push(e.message); }
  }
  if (env.TWELVEDATA_API_KEY) {
    try {
      const sym = API.ASSETS[asset].td;
      return { source: `Twelve Data · ${sym} (spot)`, symbol: 'OANDA:' + sym.replace('/', ''), timeframes: await TD.loadAll(env.TWELVEDATA_API_KEY, sym) };
    } catch (e) { warnings.push(e.message); }
  }
  const d = await fromBinance(asset);
  if (warnings.length) d.warning = warnings.join(' | ');
  return d;
}

/** { at, asset, source, symbol, timeframes: { tf: candles[] | {error} } } */
async function loadMarket(env, asset) {
  asset = ASSETS.includes(asset) ? asset : 'silver';
  const KEY = `rc:market:v2:${asset}`, now = Date.now(), m = memo[asset];
  if (m && now - m.at < TTL * 1000) return m.data;
  const kv = store(env);
  if (kv) {
    try {
      const cached = await kv.get(KEY);
      if (cached) {
        const data = JSON.parse(cached);
        memo[asset] = { at: Date.parse(data.at), data };
        if (now - memo[asset].at < TTL * 1000) return data;
      }
    } catch (e) { /* depo yoksa doğrudan çek */ }
  }
  const data = Object.assign({ at: new Date(now).toISOString(), asset }, await fresh(env, asset));
  // Hatalı sonuç saklanmaz: bir sonraki istek yeniden dener
  if (Object.values(data.timeframes).every(Array.isArray)) {
    memo[asset] = { at: now, data };
    if (kv) kv.set(KEY, JSON.stringify(data), TTL).catch(() => {});
  }
  return data;
}

module.exports = { loadMarket, TTL, ASSETS };
