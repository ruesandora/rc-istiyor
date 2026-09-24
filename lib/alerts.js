/*
 * RC — Bildirim mantığı (sunucu tarafı).
 * Kapanmış mumlar üzerinde yeni onaylanan ve oluşmakta olan uyumsuzlukları bulur,
 * Telegram / Discord mesajına çevirir.
 */
'use strict';

const D = require('../js/divergence.js');
const API = require('../js/data.js');

const TF = API.TIMEFRAMES;

// Onaylanan uyumsuzluk, son kaç kapanmış mum içinde onaylandıysa bildirilir.
// Cron gecikmelerine tolerans; tekrarları depo (dedupe) engeller.
const CONFIRM_WINDOW = 2;

/** Yalnızca kapanmış mumlar. */
function closedOnly(candles, tf, nowSec) {
  const step = TF[tf].seconds;
  return candles.filter(c => c.time + step <= nowSec);
}

/** Bir zaman dilimi için bildirilecek olaylar. */
function evaluate(candles, tf, opts, nowSec) {
  const closed = closedOnly(candles, tf, nowSec);
  const res = D.findDivergences(closed, opts);
  const last = closed.length - 1;
  const confirmed = res.divergences
    .filter(d => d.confirmIndex >= last - CONFIRM_WINDOW)
    .map(d => Object.assign({ kind: 'confirmed' }, d));
  const potential = D.findPotential(closed, opts, res.rsi)
    .map(d => Object.assign({ kind: 'potential' }, d));
  return { closed, rsi: res.rsi[last], confirmed, potential };
}

/** Tekrar göndermeyi önleyen anahtar. */
function dedupeKey(ev, tf, unit) {
  // Olası: aynı çıpa pivot + tür için tek bildirim (aday kaysa bile tekrar etmez)
  if (ev.kind === 'potential') return `rc:pot:${unit}:${tf}:${ev.type}:${ev.from.time}`;
  return `rc:div:${unit}:${tf}:${ev.type}:${ev.from.time}:${ev.to.time}`;
}

const EMOJI = { bull: '🟢', bear: '🔴', hbull: '🔵', hbear: '🟠' };
const MEANING = {
  bull: 'Olası yükseliş dönüşü',
  bear: 'Olası düşüş dönüşü',
  hbull: 'Yükseliş trendinin devam sinyali',
  hbear: 'Düşüş trendinin devam sinyali'
};
const SHAPE = {
  bull: ['daha düşük dip', 'daha yüksek dip'],
  bear: ['daha yüksek tepe', 'daha düşük tepe'],
  hbull: ['daha yüksek dip', 'daha düşük dip'],
  hbear: ['daha düşük tepe', 'daha yüksek tepe']
};

function n2(v) { return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function n1(v) { return v.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function date(t, tf) {
  const withTime = tf !== '1d' && tf !== '1w';
  return new Date(t * 1000).toLocaleString('tr-TR', Object.assign(
    { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit' },
    withTime ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }));
}
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

/** Telegram HTML mesajı. */
function formatMessage(ev, tf, unit, siteUrl) {
  const t = D.TYPES[ev.type];
  const cur = unit === 'try' ? '₺' : '$';
  const unitLabel = unit === 'try' ? 'Gram ₺' : 'Ons $';
  const head = ev.kind === 'potential'
    ? `⏳ <b>OLUŞUYOR · ${esc(t.label.toLocaleUpperCase('tr-TR'))}</b>`
    : `${EMOJI[ev.type]} <b>${esc(t.label.toLocaleUpperCase('tr-TR'))} UYUMSUZLUK</b>`;
  const lines = [
    head,
    `Gümüş · ${TF[tf].label} · ${unitLabel}`,
    '',
    `Fiyat  ${cur}${n2(ev.from.price)} → ${cur}${n2(ev.to.price)}  (${SHAPE[ev.type][0]})`,
    `RSI    ${n1(ev.from.rsi)} → ${n1(ev.to.rsi)}  (${SHAPE[ev.type][1]})`,
    '',
    `<i>${MEANING[ev.type]}.</i>`
  ];
  if (ev.kind === 'potential') {
    lines.push(`Henüz onaylanmadı — onay için ${ev.barsLeft} mum daha gerekiyor. Fiyat yeni ${t.side === 'low' ? 'dip' : 'tepe'} yaparsa iptal olabilir.`);
  } else {
    lines.push(`Onaylandı · pivot ${date(ev.to.time, tf)}`);
  }
  if (siteUrl) lines.push('', `<a href="${esc(siteUrl)}">Grafiği aç →</a>`);
  lines.push('', '<i>Yatırım tavsiyesi değildir.</i>');
  return lines.join('\n');
}

function plain(html) {
  return html.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '$2 $1').replace(/<\/?[bi]>/g, '**').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// --- Kanallar -------------------------------------------------------------

async function sendTelegram(text, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { skipped: true };
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('Telegram: ' + (j.description || res.status));
  return { ok: true };
}

async function sendDiscord(text, env) {
  if (!env.DISCORD_WEBHOOK_URL) return { skipped: true };
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: plain(text).slice(0, 1900) })
  });
  if (!res.ok) throw new Error('Discord: HTTP ' + res.status);
  return { ok: true };
}

async function broadcast(text, env) {
  const out = {};
  for (const [name, fn] of [['telegram', sendTelegram], ['discord', sendDiscord]]) {
    try { out[name] = await fn(text, env); } catch (e) { out[name] = { error: e.message }; }
  }
  return out;
}

// --- Tekrar önleme deposu (Upstash Redis / Vercel KV REST) ---------------

function store(env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return {
    /** Anahtar yoksa yazar ve true döner (ilk kez görülüyor). */
    async claim(key, ttlSec) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(['SET', key, String(Date.now()), 'NX', 'EX', String(ttlSec)])
      });
      const j = await res.json();
      if (j.error) throw new Error('Redis: ' + j.error);
      return j.result === 'OK';
    },
    async release(key) {
      await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(['DEL', key])
      }).catch(() => {});
    }
  };
}

module.exports = { closedOnly, evaluate, dedupeKey, formatMessage, broadcast, store, CONFIRM_WINDOW };
