/*
 * RC — OANDA (spot XAG/USD) kaynağı. Yalnızca sunucuda; anahtar tarayıcıya gitmez.
 * Ücretsiz demo hesabın API anahtarı yeterli (hesap numarası gerekmez).
 * Mum saatleri TradingView'deki OANDA:XAGUSD ile aynı (New York 17:00 kapanışı); hafta pazartesi başlar.
 */
'use strict';

const HOSTS = { practice: 'https://api-fxpractice.oanda.com', live: 'https://api-fxtrade.oanda.com' };
const GRAN = { '1h': 'H1', '4h': 'H4', '1d': 'D', '1w': 'W' };

async function candles(tf, key, env) {
  const host = HOSTS[env] || HOSTS.practice;
  const url = `${host}/v3/instruments/XAG_USD/candles?granularity=${GRAN[tf]}&count=600&price=M&weeklyAlignment=Monday`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${key}`, 'accept-datetime-format': 'UNIX' } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(j.candles)) throw new Error('OANDA: ' + (j.errorMessage || 'HTTP ' + res.status));
  return j.candles
    .map(c => ({ time: Math.floor(+c.time), open: +c.mid.o, high: +c.mid.h, low: +c.mid.l, close: +c.mid.c }))
    .filter(c => isFinite(c.time) && isFinite(c.close));
}

/** { '1h', '4h', '1d', '1w' } → mum dizileri (4 istek). */
async function loadAll(key, env) {
  const out = {};
  await Promise.all(Object.keys(GRAN).map(async tf => { out[tf] = await candles(tf, key, env); }));
  return out;
}

module.exports = { loadAll, SOURCE: 'OANDA · XAG/USD (spot)', SYMBOL: 'OANDA:XAGUSD' };
