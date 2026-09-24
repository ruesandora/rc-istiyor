// Çalıştır: node tests/yahoo.test.js — Yahoo yanıtı taklit edilir
'use strict';
const assert = require('assert');
const Y = require('../lib/yahoo.js');

function chart(step, n, withNull) {
  const t0 = 1780000000;
  const timestamp = Array.from({ length: n }, (_, i) => t0 + i * step);
  const close = timestamp.map((_, i) => 60 + i / 100);
  if (withNull) close[3] = null;              // Yahoo bazen boş mum döndürür
  return { chart: { result: [{ timestamp, indicators: { quote: [{ open: close.map(c => c && c - 0.1), high: close.map(c => c && c + 0.2), low: close.map(c => c && c - 0.3), close }] } }], error: null } };
}

(async () => {
  const seen = [];
  global.fetch = async url => {
    const u = new URL(String(url));
    assert.ok(u.pathname.endsWith('/SI=F'));
    const iv = u.searchParams.get('interval');
    seen.push(iv);
    const step = { '1h': 3600, '1d': 86400, '1wk': 604800 }[iv];
    return { ok: true, status: 200, json: async () => chart(step, 100, iv === '1h') };
  };
  const all = await Y.loadAll();
  assert.deepStrictEqual(seen.sort(), ['1d', '1h', '1wk']);
  assert.strictEqual(all['1h'].length, 99, 'boş mum atlanır');
  assert.strictEqual(all['1d'].length, 100);
  assert.strictEqual(all['1w'].length, 100);
  assert.ok(all['4h'].length >= 25 && all['4h'].length <= 27);
  assert.ok(all['4h'].every(c => c.time % 14400 === 0));
  console.log('✓ Yahoo SI=F: 3 istekle 4 periyot, boş mumlar atlanıyor');

  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }) });
  await assert.rejects(Y.loadAll(), /No data found/);
  console.log('✓ Yahoo hatası açık mesaj verir');

  // Yahoo çökerse Binance'e düşülür
  const { loadMarket } = require('../lib/market.js');
  global.fetch = async url => {
    url = String(url);
    if (url.includes('yahoo.com')) return { ok: false, status: 429, json: async () => ({}) };
    if (url.includes('fapi.binance.com')) return { ok: true, status: 200, json: async () => Array.from({ length: 40 }, (_, i) => [(1780000000 + i * 3600) * 1000, '60', '61', '59', '60.5']) };
    throw new Error('beklenmeyen ' + url);
  };
  const m = await loadMarket({});
  assert.ok(m.source.startsWith('Binance'), m.source);
  assert.ok(/Yahoo: HTTP 429/.test(m.warning), m.warning);
  console.log('✓ Yahoo hata verirse Binance kullanılır');
})().catch(e => { console.error(e); process.exit(1); });
