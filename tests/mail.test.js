// Çalıştır: node tests/mail.test.js — Redis ve Brevo taklit edilir
'use strict';
const assert = require('assert');

const redis = new Map(); // key -> Set
const mails = [];
global.fetch = async (url, init) => {
  url = String(url);
  const json = (j, ok = true, status = 200) => ({ ok, status, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.startsWith('https://kv.test')) {
    const [cmd, key, val] = JSON.parse(init.body);
    const set = redis.get(key) || new Set(); redis.set(key, set);
    if (cmd === 'SADD') { const had = set.has(val); set.add(val); return json({ result: had ? 0 : 1 }); }
    if (cmd === 'SREM') return json({ result: set.delete(val) ? 1 : 0 });
    if (cmd === 'SMEMBERS') return json({ result: [...set] });
    if (cmd === 'SET') return json({ result: 'OK' });
    if (cmd === 'GET') return json({ result: null });
    return json({ result: null });
  }
  if (url === 'https://api.brevo.com/v3/smtp/email') {
    const b = JSON.parse(init.body);
    assert.strictEqual(init.headers['api-key'], 'brevo-key');
    mails.push({ to: b.to[0].email, subject: b.subject, html: b.htmlContent, from: b.sender.email });
    return json({ messageId: 'x' });
  }
  if (url.includes('yahoo.com')) return json({}, false, 500);
  throw new Error('beklenmeyen ' + url);
};

const env = {
  KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'k', CRON_SECRET: 's3cret',
  BREVO_API_KEY: 'brevo-key', MAIL_FROM: 'RC Bildirim <rc@example.com>', SITE_URL: 'https://rc.example'
};
const sub = require('../api/subscribe.js').run;
const unsub = require('../api/unsubscribe.js').run;
const M = require('../lib/mail.js');

(async () => {
  let [st, body] = await sub({ method: 'POST', body: { email: 'yanlis-adres' } }, env);
  assert.strictEqual(st, 400);
  console.log('✓ geçersiz e-posta reddedilir');

  [st] = await sub({ method: 'POST', body: { email: 'bot@spam.com', website: 'http://x' } }, env);
  assert.strictEqual(st, 200);
  assert.ok(!(redis.get(M.SET) || new Set()).has('bot@spam.com'));
  console.log('✓ bot tuzağı doluysa kaydedilmez');

  [st, body] = await sub({ method: 'POST', body: JSON.stringify({ email: '  Ali@Ornek.com ' }) }, env);
  assert.strictEqual(st, 200); assert.strictEqual(body.already, false);
  assert.ok(redis.get(M.SET).has('ali@ornek.com'), 'küçük harfe çevrilip kaydedilir');
  assert.strictEqual(mails.length, 1); assert.ok(/abone oldunuz/.test(mails[0].subject));
  assert.ok(mails[0].html.includes('/api/unsubscribe?e=ali%40ornek.com&t='), 'çıkış linki var');
  console.log('✓ abone olunur, hoş geldin e-postası çıkış linkiyle gider');

  [st, body] = await sub({ method: 'POST', body: { email: 'ali@ornek.com' } }, env);
  assert.strictEqual(body.already, true); assert.strictEqual(mails.length, 1);
  console.log('✓ ikinci kez abone olunca tekrar e-posta gitmez');

  [st] = await unsub({ query: { e: 'ali@ornek.com', t: 'sahte' } }, env);
  assert.strictEqual(st, 400); assert.ok(redis.get(M.SET).has('ali@ornek.com'));
  [st] = await unsub({ query: { e: 'ali@ornek.com', t: M.token('ali@ornek.com', env) } }, env);
  assert.strictEqual(st, 200); assert.ok(!redis.get(M.SET).has('ali@ornek.com'));
  console.log('✓ çıkış yalnızca imzalı linkle olur');

  [st, body] = await sub({ method: 'POST', body: { email: 'a@b.co' } }, Object.assign({}, env, { KV_REST_API_URL: '' }));
  assert.strictEqual(st, 503); assert.ok(/yakında/.test(body.error));
  console.log('✓ depo yoksa "çok yakında" der');

  // Bildirim: onaylanan günlük sinyal abonelere e-postayla gider (Telegram yok)
  await M.subscribe(env, 'uye1@ornek.com'); await M.subscribe(env, 'uye2@ornek.com');
  mails.length = 0;
  const r = await M.broadcastMail(env, 'Gümüş · Günlük: Pozitif uyumsuzluk onaylandı', '🟢 <b>POZİTİF</b>\nFiyat…');
  assert.deepStrictEqual({ sent: r.sent, failed: r.failed }, { sent: 2, failed: 0 });
  assert.ok(mails.every(m => m.html.includes('<b>POZİTİF</b><br>Fiyat') && m.from === 'rc@example.com'));
  console.log('✓ sinyal tüm abonelere kişiye özel çıkış linkiyle gider');
})().catch(e => { console.error(e); process.exit(1); });
