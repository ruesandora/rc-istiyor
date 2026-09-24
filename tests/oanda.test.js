// Çalıştır: node tests/oanda.test.js — OANDA ve kaynak sırası taklit edilir
'use strict';
const assert = require('assert');
const OANDA = require('../lib/oanda.js');

function fakeOanda(url, init) {
  const u = new URL(url);
  assert.strictEqual(u.hostname, 'api-fxpractice.oanda.com');
  assert.ok(u.pathname.endsWith('/instruments/XAG_USD/candles'));
  assert.strictEqual(init.headers.authorization, 'Bearer tok');
  const step = { H1: 3600, H4: 14400, D: 86400, W: 604800 }[u.searchParams.get('granularity')];
  const candles = Array.from({ length: 40 }, (_, i) => ({
    complete: true, time: String(1780000000 + i * step) + '.000000000',
    mid: { o: '60.1', h: '61.2', l: '59.3', c: String(60 + i / 10) }
  }));
  return { ok: true, status: 200, json: async () => ({ candles }) };
}

(async () => {
  global.fetch = async (url, init) => fakeOanda(String(url), init);
  const all = await OANDA.loadAll('tok');
  assert.deepStrictEqual(Object.keys(all).sort(), ['1d', '1h', '1w', '4h']);
  assert.strictEqual(all['1h'].length, 40);
  assert.deepStrictEqual(all['1d'][0], { time: 1780000000, open: 60.1, high: 61.2, low: 59.3, close: 60 });
  console.log('✓ OANDA mumları okunuyor (4 periyot)');

  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ errorMessage: 'Insufficient authorization to perform request.' }) });
  await assert.rejects(OANDA.loadAll('bad'), /Insufficient authorization/);
  console.log('✓ hatalı anahtar açık hata verir');

  // Kaynak sırası: OANDA başarısızsa Binance'e düşer
  delete require.cache[require.resolve('../lib/market.js')];
  const { loadMarket } = require('../lib/market.js');
  global.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('oanda.com')) return { ok: false, status: 401, json: async () => ({ errorMessage: 'bad token' }) };
    if (url.includes('fapi.binance.com')) {
      return { ok: true, status: 200, json: async () => Array.from({ length: 40 }, (_, i) => [(1780000000 + i * 3600) * 1000, '60', '61', '59', '60.5']) };
    }
    throw new Error('beklenmeyen ' + url);
  };
  const m = await loadMarket({ OANDA_API_KEY: 'x' });
  assert.ok(m.source.startsWith('Binance'), m.source);
  assert.ok(/bad token/.test(m.warning));
  console.log('✓ OANDA hata verirse Binance kullanılır');
})().catch(e => { console.error(e); process.exit(1); });
