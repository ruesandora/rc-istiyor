/*
 * RC — E-posta aboneliği.  POST /api/subscribe  { email, website }
 * "website" alanı botlar için tuzaktır (insanlar görmez); doluysa sessizce kabul edilir ama kaydedilmez.
 */
'use strict';

const M = require('../lib/mail.js');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

async function run(req, env) {
  if (req.method !== 'POST') return [405, { error: 'POST kullanın' }];
  const body = await readBody(req);
  if (body.website) return [200, { ok: true }];                     // bot
  const email = M.normalize(body.email);
  if (!M.valid(email)) return [400, { error: 'Geçerli bir e-posta adresi yazın.' }];
  try {
    const r = await M.subscribe(env, email);
    return [200, { ok: true, already: !r.added }];
  } catch (e) {
    return [e.status || 500, { error: e.status === 503 ? 'E-posta aboneliği çok yakında açılacak.' : 'Şu an kaydedilemedi, birazdan tekrar deneyin.' }];
  }
}

module.exports = async function handler(req, res) {
  const [status, body] = await run(req, process.env);
  res.setHeader('cache-control', 'no-store');
  res.status(status).json(body);
};
module.exports.run = run;
