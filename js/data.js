/*
 * RC — Gümüş ve altın fiyat verisi (borsa perpetual kontratları; sunucu yedeği ve tarayıcı son çaresi).
 * Sırasıyla Binance, Bybit ve OKX denenir; hepsi anahtarsız ve CORS destekli.
 */
(function (root) {
  'use strict';

  var TIMEFRAMES = {
    '1d': { label: 'Günlük',   binance: '1d', bybit: 'D',   okx: '1Dutc', tv: 'D',   seconds: 86400 },
    '4h': { label: '4 saat',   binance: '4h', bybit: '240', okx: '4H',    tv: '240', seconds: 14400 },
    '1h': { label: '1 saat',   binance: '1h', bybit: '60',  okx: '1H',    tv: '60',  seconds: 3600 },
    '1w': { label: 'Haftalık', binance: '1w', bybit: 'W',   okx: '1Wutc', tv: 'W',   seconds: 604800 }
  };

  /** Metaller: her kaynaktaki sembolleri ve Türkçe adları. */
  var ASSETS = {
    silver: { name: 'Gümüş', loc: 'Gümüşte', binance: 'XAGUSDT', okx: 'XAG-USDT-SWAP', yahoo: 'SI=F', yahooName: 'COMEX gümüş vadeli', tvYahoo: 'COMEX:SI1!', oanda: 'XAG_USD', td: 'XAG/USD' },
    gold:   { name: 'Altın', loc: 'Altında', binance: 'XAUUSDT', okx: 'XAU-USDT-SWAP', yahoo: 'GC=F', yahooName: 'COMEX altın vadeli', tvYahoo: 'COMEX:GC1!', oanda: 'XAU_USD', td: 'XAU/USD' }
  };

  function fetchJson(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
      if (t) clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  function row(ts, o, h, l, c) {
    return { time: Math.floor(+ts / 1000), open: +o, high: +h, low: +l, close: +c };
  }

  var PROVIDERS = [
    {
      id: 'binance', name: function (a) { return 'Binance · ' + a.binance; },
      load: function (tf, a) {
        return fetchJson('https://fapi.binance.com/fapi/v1/klines?symbol=' + a.binance + '&interval=' + TIMEFRAMES[tf].binance + '&limit=600')
          .then(function (rows) { return rows.map(function (k) { return row(k[0], k[1], k[2], k[3], k[4]); }); });
      }
    },
    {
      id: 'bybit', name: function (a) { return 'Bybit · ' + a.binance; },
      load: function (tf, a) {
        return fetchJson('https://api.bybit.com/v5/market/kline?category=linear&symbol=' + a.binance + '&interval=' + TIMEFRAMES[tf].bybit + '&limit=600')
          .then(function (j) {
            if (!j || j.retCode !== 0) throw new Error('Bybit: ' + (j && j.retMsg));
            return j.result.list.map(function (k) { return row(k[0], k[1], k[2], k[3], k[4]); });
          });
      }
    },
    {
      id: 'okx', name: function (a) { return 'OKX · ' + a.okx; },
      load: function (tf, a) {
        return fetchJson('https://www.okx.com/api/v5/market/candles?instId=' + a.okx + '&bar=' + TIMEFRAMES[tf].okx + '&limit=300')
          .then(function (j) {
            if (!j || j.code !== '0') throw new Error('OKX: ' + (j && j.msg));
            return j.data.map(function (k) { return row(k[0], k[1], k[2], k[3], k[4]); });
          });
      }
    }
  ];

  function clean(candles) {
    var seen = {};
    return candles.filter(function (c) {
      var ok = isFinite(c.time) && isFinite(c.close) && !seen[c.time];
      seen[c.time] = true;
      return ok;
    }).sort(function (a, b) { return a.time - b.time; });
  }

  var preferred = null; // en son çalışan kaynak önce denenir

  /** { candles, source } — son mum henüz kapanmamış olabilir. asset: 'silver' | 'gold' */
  function loadAsset(tf, asset) {
    var a = ASSETS[asset] || ASSETS.silver;
    var order = PROVIDERS.slice();
    if (preferred) order.sort(function (a, b) { return (b.id === preferred) - (a.id === preferred); });
    var errors = [], i = 0;
    function next() {
      if (i >= order.length) return Promise.reject(new Error('Veri kaynağına ulaşılamadı. ' + errors.join(' | ')));
      var p = order[i++];
      return p.load(tf, a).then(function (c) {
        c = clean(c);
        if (c.length < 30) throw new Error('yetersiz veri (' + c.length + ')');
        preferred = p.id;
        return { candles: c, source: p.name(a) };
      }).catch(function (e) {
        errors.push(p.name(a) + ': ' + (e && e.message ? e.message : e));
        return next();
      });
    }
    return next();
  }

  /** Yalnızca kapanmış mumlar. */
  function closedOnly(candles, tf, nowSec) {
    var step = TIMEFRAMES[tf].seconds, n = candles.length;
    while (n > 0 && candles[n - 1].time + step > nowSec) n--;
    return candles.slice(0, n);
  }

  function loadSilver(tf) { return loadAsset(tf, 'silver'); }

  var api = { TIMEFRAMES: TIMEFRAMES, ASSETS: ASSETS, PROVIDERS: PROVIDERS, loadAsset: loadAsset, loadSilver: loadSilver, closedOnly: closedOnly };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RCData = api;
})(typeof window !== 'undefined' ? window : this);
