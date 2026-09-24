// Çalıştır: node tests/api.test.js — ağ çağrıları taklit edilir
'use strict';
const assert = require('assert');
const API = require('../js/data.js');
const { run } = require('../api/check.js');

const kv = new Map();
const sent = [];
let binanceOk = true;

// Uyumsuzluk üreten sentetik 1 saatlik veri: son mumlarda oluşan bir pozitif uyumsuzluk
function lin(a, b, n) { return Array.from({ length: n }, (_, i) => a + (b - a) * (i + 1) / n); }
function side(c, n) { return Array.from({ length: n }, (_, i) => c + (i % 2 ? 0.6 : -0.6)); }
const closes = [...side(34, 124), ...lin(34, 26, 8), ...lin(26, 33, 10), ...lin(33, 25.5, 6), ...lin(25.5, 26.2, 2)];

global.fetch = async (url, init) => {
  url = String(url);
  const json = (j, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => j });
  if (url.includes('fapi.binance.com')) {
    if (!binanceOk) throw new Error('ağ yok');
    const iv = new URL(url).searchParams.get('interval');
    const step = Object.values(API.TIMEFRAMES).find(t => t.binance === iv).seconds;
    const now = Math.floor(Date.now() / 1000 / step) * step;
    // son öğe açık (kapanmamış) mum
    const rows = closes.concat([26.3]).map((c, i, arr) => {
      const t = now - (arr.length - 1 - i) * step;
      return [t * 1000, String(c), String(c + 0.05), String(c - 0.05), String(c), '1'];
    });
    return json(rows);
  }
  if (url.includes('api.telegram.org')) { sent.push(JSON.parse(init.body).text); return json({ ok: true }); }
  if (url.startsWith('https://kv.test')) {
    const cmd = JSON.parse(init.body);
    if (cmd[0] === 'SET') { if (kv.has(cmd[1])) return json({ result: null }); kv.set(cmd[1], cmd[2]); return json({ result: 'OK' }); }
    if (cmd[0] === 'DEL') { kv.delete(cmd[1]); return json({ result: 1 }); }
  }
  throw new Error('beklenmeyen istek ' + url);
};

const env = { CRON_SECRET: 's3cret', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '@rc', KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'k', ALERT_TIMEFRAMES: '1h', SITE_URL: 'https://rc.example' };
const req = (query, auth) => ({ query, headers: auth ? { authorization: 'Bearer ' + auth } : {} });

(async () => {
  let [st, body] = await run(req({ dry: '1' }), env);
  assert.strictEqual(st, 200);
  const ev = body.timeframes[0].events;
  assert.ok(ev.some(e => e.kind === 'potential' && e.type === 'bull'), JSON.stringify(ev));
  assert.strictEqual(sent.length, 0, 'dry modda gönderim olmamalı');
  console.log('✓ dry önizleme olası pozitif uyumsuzluğu buluyor');

  [st] = await run(req({}), env);
  assert.strictEqual(st, 401);
  console.log('✓ anahtarsız gönderim reddediliyor');

  [st, body] = await run(req({}, 's3cret'), env);
  assert.strictEqual(st, 200, JSON.stringify(body));
  assert.ok(sent.length >= 1);
  assert.ok(sent[0].includes('OLUŞUYOR') && sent[0].includes('POZİTİF'), sent[0]);
  const n = sent.length;
  console.log('✓ yeni olay Telegram’a gönderildi');

  [st, body] = await run(req({}, 's3cret'), env);
  assert.strictEqual(sent.length, n, 'aynı olay ikinci kez gönderilmemeli');
  console.log('✓ tekrar gönderim engelleniyor');

  [st, body] = await run(req({ test: '1' }, 's3cret'), env);
  assert.ok(sent[sent.length - 1].includes('bildirim testi'));
  console.log('✓ test mesajı');

  [st, body] = await run(req({}, 's3cret'), Object.assign({}, env, { TELEGRAM_BOT_TOKEN: '' }));
  assert.strictEqual(st, 500);
  console.log('✓ kanal yoksa açık hata');

  console.log('\n--- örnek mesaj ---\n' + sent[0]);
})().catch(e => { console.error(e); process.exit(1); });
