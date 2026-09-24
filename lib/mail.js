/*
 * RC — E-posta aboneliği ve gönderimi.
 *
 * Aboneler Redis'te (KV_REST_API_* / UPSTASH_REDIS_REST_*) "rc:subs" kümesinde tutulur.
 * Gönderim: BREVO_API_KEY (ücretsiz 300/gün, alan adı gerekmez; gönderen adresi Brevo'da doğrulanır)
 *           ya da RESEND_API_KEY (alan adı doğrulaması gerekir).
 * Gönderen: MAIL_FROM (ör. "RC Bildirim <adres@gmail.com>").
 * Her e-postada kişiye özel, imzalı "abonelikten çık" linki bulunur.
 */
'use strict';

const crypto = require('crypto');
const { store } = require('./alerts.js');

const SET = 'rc:subs';
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

function normalize(email) { return String(email || '').trim().toLowerCase(); }
function valid(email) { return email.length <= 254 && EMAIL_RE.test(email); }

function secret(env) { return env.SUBSCRIBE_SECRET || env.CRON_SECRET || 'rc-dev-secret'; }
function token(email, env) { return crypto.createHmac('sha256', secret(env)).update(email).digest('hex').slice(0, 32); }
function checkToken(email, t, env) {
  const a = Buffer.from(token(email, env)), b = Buffer.from(String(t || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function unsubscribeUrl(email, env) {
  const base = (env.SITE_URL || '').replace(/\/$/, '');
  return `${base}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${token(email, env)}`;
}

function sender(env) {
  const m = String(env.MAIL_FROM || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || 'RC Bildirim', email: m[2] } : { name: 'RC Bildirim', email: String(env.MAIL_FROM || '').trim() };
}
function configured(env) { return !!((env.BREVO_API_KEY || env.RESEND_API_KEY) && env.MAIL_FROM); }

async function send(env, to, subject, html) {
  const from = sender(env);
  if (env.BREVO_API_KEY) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: from, to: [{ email: to }], subject, htmlContent: html })
    });
    if (!res.ok) throw new Error('Brevo: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return;
  }
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, html })
    });
    if (!res.ok) throw new Error('Resend: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return;
  }
  throw new Error('E-posta servisi ayarlı değil (BREVO_API_KEY veya RESEND_API_KEY + MAIL_FROM)');
}

/** Telegram HTML metnini sade bir e-posta gövdesine çevirir. */
function layout(bodyHtml, email, env) {
  const site = env.SITE_URL || '#';
  return `<!doctype html><html lang="tr"><body style="margin:0;background:#f3f1ea;font-family:Arial,Helvetica,sans-serif;color:#0f100d">
<div style="max-width:520px;margin:0 auto;padding:24px">
  <div style="font-weight:800;font-size:18px;margin-bottom:14px">RC · Rues Community</div>
  <div style="background:#fbfaf7;border:1px solid #d9d6cb;border-radius:12px;padding:20px;font-size:15px;line-height:1.55">${bodyHtml}</div>
  <p style="font-size:12px;color:#6d6c64;line-height:1.5;margin-top:16px">
    Bu e-postayı RC gümüş/altın RSI uyumsuzluk bildirimlerine abone olduğunuz için aldınız. Yatırım tavsiyesi değildir.<br>
    <a href="${site}" style="color:#3f5a00">Siteyi aç</a> · <a href="${unsubscribeUrl(email, env)}" style="color:#6d6c64">Abonelikten çık</a>
  </p>
</div></body></html>`;
}
function tgToHtml(text) { return String(text).replace(/\n/g, '<br>'); }

// --- Abonelik -------------------------------------------------------------

async function subscribe(env, email) {
  const kv = store(env);
  if (!kv) throw Object.assign(new Error('Abonelik şu an kapalı'), { status: 503 });
  const added = await kv.cmd('SADD', SET, email);
  if (added && configured(env)) {
    await send(env, email, 'RC bildirimlerine abone oldunuz',
      layout('<b>Hoş geldiniz!</b><br><br>Gümüş ve altında RSI uyumsuzluğu onaylandığında (4 saatlik, günlük ve haftalık grafikler) size e-posta göndereceğiz. İstediğiniz zaman aşağıdaki linkle ayrılabilirsiniz.', email, env))
      .catch(() => {}); // hoş geldin e-postası başarısız olsa da abonelik geçerli
  }
  return { added: !!added };
}

async function unsubscribe(env, email) {
  const kv = store(env);
  if (!kv) throw new Error('Depo yok');
  return !!(await kv.cmd('SREM', SET, email));
}

/** Tüm abonelere gönderir (10'arlı paralel). { sent, failed } */
async function broadcastMail(env, subject, telegramText) {
  const kv = store(env);
  if (!kv || !configured(env)) return { skipped: true };
  const subs = (await kv.cmd('SMEMBERS', SET)) || [];
  let sent = 0, failed = 0;
  for (let i = 0; i < subs.length; i += 10) {
    await Promise.all(subs.slice(i, i + 10).map(e =>
      send(env, e, subject, layout(tgToHtml(telegramText), e, env)).then(() => sent++, () => failed++)));
  }
  return { sent, failed, total: subs.length };
}

module.exports = { normalize, valid, token, checkToken, unsubscribeUrl, subscribe, unsubscribe, broadcastMail, configured, layout, SET };
