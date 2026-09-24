// Çalıştır: node tests/twelvedata.test.js — Twelve Data yanıtı taklit edilir
'use strict';
const assert = require('assert');
const TD = require('../lib/twelvedata.js');

(async () => {
  // Haftalık kova pazartesi 00:00 UTC'de başlar
  const wed = Date.UTC(2026, 8, 23) / 1000;           // 23 Eylül 2026 çarşamba
  assert.strictEqual(TD.toWeek(wed), Date.UTC(2026, 8, 21) / 1000);
  assert.strictEqual(TD.to4h(Date.UTC(2026, 8, 23, 7) / 1000), Date.UTC(2026, 8, 23, 4) / 1000);
  console.log('✓ 4 saat ve hafta hizalaması');

  const hours = [
    { time: Date.UTC(2026, 8, 23, 4) / 1000, open: 1, high: 2, low: 0.5, close: 1.5 },
    { time: Date.UTC(2026, 8, 23, 5) / 1000, open: 1.5, high: 3, low: 1, close: 2.5 },
    { time: Date.UTC(2026, 8, 23, 8) / 1000, open: 2.5, high: 2.6, low: 2, close: 2.2 }
  ];
  const h4 = TD.aggregate(hours, TD.to4h);
  assert.deepStrictEqual(h4[0], { time: hours[0].time, open: 1, high: 3, low: 0.5, close: 2.5 });
  assert.strictEqual(h4.length, 2);
  console.log('✓ 1 saatlikten 4 saatlik mum');

  let calls = 0;
  global.fetch = async url => {
    calls++;
    const u = new URL(url);
    assert.strictEqual(u.searchParams.get('symbol'), 'XAG/USD');
    const daily = u.searchParams.get('interval') === '1day';
    const values = Array.from({ length: 50 }, (_, i) => {
      const t = new Date(Date.UTC(2026, 6, 1) + i * (daily ? 86400e3 : 3600e3)).toISOString();
      return { datetime: daily ? t.slice(0, 10) : t.slice(0, 19).replace('T', ' '), open: '60', high: '61', low: '59', close: String(60 + i / 10) };
    });
    return { status: 200, json: async () => ({ status: 'ok', values }) };
  };
  const all = await TD.loadAll('k');
  assert.strictEqual(calls, 2, 'yalnızca iki istek (kredi tasarrufu)');
  assert.strictEqual(all['1h'].length, 50);
  assert.strictEqual(all['1d'].length, 50);
  assert.ok(all['4h'].length >= 12 && all['4h'].length <= 14);
  assert.ok(all['1w'].length >= 7 && all['1w'].length <= 9);
  assert.strictEqual(all['1d'][0].time, Date.UTC(2026, 6, 1) / 1000);
  console.log('✓ iki istekle dört periyot');

  global.fetch = async () => ({ status: 200, json: async () => ({ status: 'error', message: 'API key is invalid' }) });
  await assert.rejects(TD.loadAll('bad'), /API key is invalid/);
  console.log('✓ hatalı anahtar açık hata verir');
})().catch(e => { console.error(e); process.exit(1); });
