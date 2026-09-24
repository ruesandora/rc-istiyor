/*
 * RC — Abonelikten çıkış.  GET /api/unsubscribe?e=<email>&t=<imza>
 * İmza (HMAC) yalnızca o e-postaya gönderilen linkte bulunur; başkası kimseyi çıkaramaz.
 */
'use strict';

const M = require('../lib/mail.js');

function page(title, text) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f100d;color:#efede6;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:420px;padding:24px;text-align:center"><div style="font-weight:800;font-size:20px;margin-bottom:12px">RC · Rues Community</div>
<h1 style="font-size:24px;margin:0 0 10px">${title}</h1><p style="color:#cfcdc4;line-height:1.5">${text}</p>
<p><a href="/" style="color:#d9dde3">Siteye dön →</a></p></div></body></html>`;
}

async function run(req, env) {
  const q = req.query || {};
  const email = M.normalize(q.e);
  if (!M.valid(email) || !M.checkToken(email, q.t, env)) return [400, page('Link geçersiz', 'Bu abonelikten çıkış linki geçersiz ya da eksik.')];
  try {
    await M.unsubscribe(env, email);
    return [200, page('Abonelikten çıktınız', `${email.replace(/[<>&]/g, '')} artık bildirim almayacak.`)];
  } catch (e) {
    return [500, page('Bir sorun oluştu', 'Birazdan tekrar deneyin.')];
  }
}

module.exports = async function handler(req, res) {
  const [status, html] = await run(req, process.env);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(status).send(html);
};
module.exports.run = run;
