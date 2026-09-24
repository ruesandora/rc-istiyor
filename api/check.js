/*
 * RC — Uyumsuzluk kontrolü ve bildirim (Vercel Serverless Function).
 *
 *   GET /api/check?dry=1          → Herkese açık önizleme: şu an ne bildirilecek (gönderim yok)
 *   GET /api/check                → Kontrol et ve yeni olayları gönder   (Authorization: Bearer CRON_SECRET)
 *   GET /api/check?test=1         → Kanallara deneme mesajı gönder       (Authorization: Bearer CRON_SECRET)
 *
 * Ortam değişkenleri: README.md → "Bildirimler"
 */
'use strict';

const API = require('../js/data.js');
const A = require('../lib/alerts.js');
const { loadMarket, ASSETS } = require('../lib/market.js');
const M = require('../lib/mail.js');
const D = require('../js/divergence.js');

const TTL = 60 * 60 * 24 * 45; // 45 gün

function list(v, def) { return String(v || def).split(',').map(s => s.trim()).filter(Boolean); }

function authorized(req, env) {
  if (!env.CRON_SECRET) return false;
  const h = req.headers.authorization || '';
  return h === `Bearer ${env.CRON_SECRET}` || (req.query && req.query.key === env.CRON_SECRET);
}

async function run(req, env) {
  const q = req.query || {};
  const dry = q.dry === '1' || q.dry === 'true';

  if (!dry && !authorized(req, env)) return [401, { error: 'Yetkisiz. Önizleme için ?dry=1 kullanın.' }];

  if (q.test === '1') {
    const text = '✅ <b>RC Gümüş & Altın RSI</b> bildirim testi\nKanal bağlantısı çalışıyor.' + (env.SITE_URL ? `\n\n<a href="${env.SITE_URL}">Siteyi aç →</a>` : '');
    return [200, { test: true, result: await A.broadcast(text, env) }];
  }

  const tfs = list(env.ALERT_TIMEFRAMES, '1d,4h,1h,1w').filter(tf => API.TIMEFRAMES[tf]);
  const types = list(env.ALERT_TYPES, 'bull,bear,hbull,hbear');
  const withPotential = (env.ALERT_POTENTIAL || 'on') !== 'off';
  const nowSec = Math.floor(Date.now() / 1000);
  const kv = A.store(env);

  const hasChat = !!((env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) || env.DISCORD_WEBHOOK_URL);
  if (!dry && !hasChat && !M.configured(env)) return [500, { error: 'Bildirim kanalı yok: Telegram/Discord ya da e-posta (BREVO_API_KEY + MAIL_FROM) tanımlayın.' }];
  // E-posta daha seyrek: varsayılan yalnızca onaylanan 4 saat / günlük / haftalık sinyaller
  const mailTfs = list(env.EMAIL_TIMEFRAMES, '4h,1d,1w');
  const mailPotential = env.EMAIL_POTENTIAL === 'on';
  if (!dry && !kv) return [500, { error: 'Tekrar önleme deposu yok: KV_REST_API_URL / KV_REST_API_TOKEN (veya UPSTASH_REDIS_REST_*) tanımlayın.' }];

  const assets = list(env.ALERT_ASSETS, 'silver,gold').filter(a => ASSETS.includes(a));
  const report = { dry, at: new Date().toISOString(), timeframes: [], sources: {}, sent: 0, errors: [] };

  for (const asset of assets) {
    const market = await loadMarket(env, asset);
    report.sources[asset] = market.source;
    if (market.warning) report.errors.push(`${asset}: ${market.warning}`);
    for (const tf of tfs) {
      const row = { asset, tf };
      report.timeframes.push(row);
      let data;
      const c = market.timeframes[tf];
      if (!Array.isArray(c)) { row.error = c ? c.error : 'veri yok'; report.errors.push(`${asset}/${tf}: ${row.error}`); continue; }
      data = { candles: c };
      const ev = A.evaluate(data.candles, tf, {}, nowSec);
      row.lastClose = ev.closed.length ? ev.closed[ev.closed.length - 1].close : null;
      row.rsi = ev.rsi == null ? null : Math.round(ev.rsi * 10) / 10;
      const events = ev.confirmed.concat(withPotential ? ev.potential : []).filter(x => types.includes(x.type));
      row.events = [];
      for (const e of events) {
        const key = A.dedupeKey(e, tf, asset);
        const item = { kind: e.kind, type: e.type, from: e.from, to: e.to, barsLeft: e.barsLeft, key };
        row.events.push(item);
        if (dry) { item.message = A.formatMessage(e, tf, env.SITE_URL, asset); continue; }
        let fresh;
        try { fresh = await kv.claim(key, TTL); } catch (err) { report.errors.push(err.message); continue; }
        if (!fresh) { item.status = 'zaten gönderildi'; continue; }
        const text = A.formatMessage(e, tf, env.SITE_URL, asset);
        const result = hasChat ? await A.broadcast(text, env) : {};
        if (mailTfs.includes(tf) && (e.kind === 'confirmed' || mailPotential)) {
          const name = API.ASSETS[asset].name, t = D.TYPES[e.type].label;
          const subject = `${name} · ${API.TIMEFRAMES[tf].label}: ${t} ${e.kind === 'potential' ? 'uyumsuzluk oluşuyor' : 'uyumsuzluk onaylandı'}`;
          try { result.mail = await M.broadcastMail(env, subject, text); } catch (err) { result.mail = { error: err.message }; }
          if (result.mail && result.mail.sent) result.mail.ok = true;
        }
        item.status = result;
        const failed = Object.values(result).some(r => r.error) && !Object.values(result).some(r => r.ok);
        if (failed) { await kv.release(key); report.errors.push(JSON.stringify(result)); } else report.sent++;
      }
    }
  }
  return [report.errors.length && !report.sent && !dry ? 502 : 200, report];
}

module.exports = async function handler(req, res) {
  try {
    const [status, body] = await run(req, process.env);
    res.setHeader('cache-control', 'no-store');
    res.status(status).json(body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
module.exports.run = run;
