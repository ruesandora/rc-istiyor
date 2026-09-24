/*
 * RC — Gümüş fiyat verisi.
 * Sırasıyla birden fazla ücretsiz, anahtarsız (CORS destekli) kaynak denenir.
 * Hepsi başarısız olursa kullanıcı CSV yükleyebilir veya demo veriyi görebilir.
 */
(function (root) {
  'use strict';

  var TIMEFRAMES = {
    '15m': { label: '15 dk',  binance: '15m', bybit: '15',  okx: '15m', seconds: 900 },
    '1h':  { label: '1 saat', binance: '1h',  bybit: '60',  okx: '1H',  seconds: 3600 },
    '4h':  { label: '4 saat', binance: '4h',  bybit: '240', okx: '4H',  seconds: 14400 },
    '1d':  { label: 'Günlük', binance: '1d',  bybit: 'D',   okx: '1Dutc', seconds: 86400 },
    '1w':  { label: 'Haftalık', binance: '1w', bybit: 'W',  okx: '1Wutc', seconds: 604800 }
  };

  var OZ_TO_GRAM = 31.1034768;

  function fetchJson(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
      if (t) clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  function num(x) { return parseFloat(x); }

  function clean(candles) {
    var seen = {};
    return candles
      .filter(function (c) {
        if (!isFinite(c.time) || !isFinite(c.open) || !isFinite(c.high) || !isFinite(c.low) || !isFinite(c.close)) return false;
        if (seen[c.time]) return false;
        seen[c.time] = true;
        return true;
      })
      .sort(function (a, b) { return a.time - b.time; });
  }

  // --- Kaynaklar -----------------------------------------------------------

  var PROVIDERS = [
    {
      id: 'binance',
      name: 'Binance Futures · XAGUSDT',
      load: function (tf) {
        var url = 'https://fapi.binance.com/fapi/v1/klines?symbol=XAGUSDT&interval=' + TIMEFRAMES[tf].binance + '&limit=600';
        return fetchJson(url).then(function (rows) {
          if (!Array.isArray(rows)) throw new Error('Beklenmeyen yanıt');
          return rows.map(function (k) {
            return { time: Math.floor(k[0] / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]) };
          });
        });
      }
    },
    {
      id: 'bybit',
      name: 'Bybit · XAGUSDT',
      load: function (tf) {
        var url = 'https://api.bybit.com/v5/market/kline?category=linear&symbol=XAGUSDT&interval=' + TIMEFRAMES[tf].bybit + '&limit=600';
        return fetchJson(url).then(function (j) {
          if (!j || j.retCode !== 0 || !j.result || !j.result.list) throw new Error('Bybit: ' + (j && j.retMsg));
          return j.result.list.map(function (k) {
            return { time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]) };
          });
        });
      }
    },
    {
      id: 'okx',
      name: 'OKX · XAG-USDT-SWAP',
      load: function (tf) {
        var url = 'https://www.okx.com/api/v5/market/candles?instId=XAG-USDT-SWAP&bar=' + TIMEFRAMES[tf].okx + '&limit=300';
        return fetchJson(url).then(function (j) {
          if (!j || j.code !== '0' || !j.data || !j.data.length) throw new Error('OKX: ' + (j && j.msg));
          return j.data.map(function (k) {
            return { time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]) };
          });
        });
      }
    }
  ];

  var preferred = null; // en son çalışan kaynak önce denenir

  function loadSilverUsd(tf) {
    var order = PROVIDERS.slice();
    if (preferred) order.sort(function (a, b) { return (b.id === preferred) - (a.id === preferred); });
    var errors = [];
    var i = 0;
    function next() {
      if (i >= order.length) {
        var err = new Error('Hiçbir veri kaynağına ulaşılamadı. ' + errors.join(' | '));
        err.details = errors;
        return Promise.reject(err);
      }
      var p = order[i++];
      return p.load(tf).then(function (c) {
        c = clean(c);
        if (c.length < 50) throw new Error('yetersiz veri (' + c.length + ')');
        preferred = p.id;
        return { candles: c, source: p.name };
      }).catch(function (e) {
        errors.push(p.name + ': ' + (e && e.message ? e.message : e));
        return next();
      });
    }
    return next();
  }

  /** USD/TRY (USDT/TRY) kapanışları: { time -> close } */
  function loadUsdTry(tf) {
    var url = 'https://api.binance.com/api/v3/klines?symbol=USDTTRY&interval=' + TIMEFRAMES[tf].binance + '&limit=1000';
    return fetchJson(url).then(function (rows) {
      var map = {};
      rows.forEach(function (k) { map[Math.floor(k[0] / 1000)] = { o: num(k[1]), c: num(k[4]) }; });
      return map;
    });
  }

  /**
   * Gümüş mumları.
   * unit: 'usd' → ons/$ ; 'try' → gram/₺ (yaklaşık: ons × USDTRY ÷ 31,1035)
   */
  function loadSilver(tf, unit) {
    return loadSilverUsd(tf).then(function (res) {
      if (unit !== 'try') return Object.assign({ unit: 'usd' }, res);
      return loadUsdTry(tf).then(function (fx) {
        var last = null;
        var out = [];
        res.candles.forEach(function (c) {
          var r = fx[c.time] || last;
          if (!r) return;
          last = r;
          var k = r.c / OZ_TO_GRAM;
          out.push({ time: c.time, open: c.open * (r.o / OZ_TO_GRAM), high: c.high * k, low: c.low * k, close: c.close * k });
        });
        out.forEach(function (c) { c.high = Math.max(c.high, c.open, c.close); c.low = Math.min(c.low, c.open, c.close); });
        if (out.length < 50) throw new Error('USD/TRY verisi eşleşmedi');
        return { candles: out, source: res.source + ' + Binance USDTTRY', unit: 'try' };
      });
    });
  }

  // --- CSV -----------------------------------------------------------------

  function parseDate(s) {
    s = String(s).trim().replace(/^"|"$/g, '');
    if (/^\d{10,13}$/.test(s)) { var n = +s; return n > 1e12 ? Math.floor(n / 1000) : n; }
    var m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/); // GG.AA.YYYY
    if (m) return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) / 1000);
    var t = Date.parse(s.indexOf('T') < 0 && s.length <= 10 ? s + 'T00:00:00Z' : s);
    return isNaN(t) ? NaN : Math.floor(t / 1000);
  }

  function parseNumber(s) {
    s = String(s).trim().replace(/^"|"$/g, '');
    if (/,\d+$/.test(s) && s.indexOf('.') >= 0 && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    return parseFloat(s);
  }

  /** Başlıklı CSV: tarih/date/time, open/açılış, high/yüksek, low/düşük, close/kapanış */
  function parseCsv(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) throw new Error('CSV boş');
    var sep = lines[0].indexOf(';') >= 0 ? ';' : (lines[0].indexOf('\t') >= 0 ? '\t' : ',');
    var head = lines[0].split(sep).map(function (h) { return h.trim().toLowerCase().replace(/"/g, ''); });
    function col(names) {
      for (var i = 0; i < head.length; i++) for (var j = 0; j < names.length; j++) if (head[i].indexOf(names[j]) === 0) return i;
      return -1;
    }
    var ci = {
      t: col(['date', 'time', 'tarih', 'timestamp', 'zaman']),
      o: col(['open', 'açılış', 'acilis', 'aç']),
      h: col(['high', 'yüksek', 'yuksek', 'en yüksek']),
      l: col(['low', 'düşük', 'dusuk', 'en düşük']),
      c: col(['close', 'kapanış', 'kapanis', 'son', 'şimdi', 'price', 'fiyat'])
    };
    if (ci.t < 0 || ci.c < 0) throw new Error('CSV başlığında tarih ve kapanış (close) sütunları bulunamadı');
    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var p = lines[i].split(sep);
      var c = parseNumber(p[ci.c]);
      var o = ci.o >= 0 ? parseNumber(p[ci.o]) : c;
      var h = ci.h >= 0 ? parseNumber(p[ci.h]) : Math.max(o, c);
      var l = ci.l >= 0 ? parseNumber(p[ci.l]) : Math.min(o, c);
      out.push({ time: parseDate(p[ci.t]), open: o, high: h, low: l, close: c });
    }
    out = clean(out);
    if (out.length < 30) throw new Error('CSV içinde en az 30 geçerli satır olmalı');
    return out;
  }

  // --- Demo ----------------------------------------------------------------

  function demo(tf) {
    var step = TIMEFRAMES[tf].seconds;
    var n = 400, now = Math.floor(Date.now() / 1000 / step) * step;
    var seed = 7 + tf.length * 13 + step % 97;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var p = 30, out = [];
    for (var i = 0; i < n; i++) {
      var drift = Math.sin(i / 35) * 0.004 + Math.sin(i / 11) * 0.002;
      var o = p;
      p = p * (1 + drift + (rnd() - 0.5) * 0.018);
      var hi = Math.max(o, p) * (1 + rnd() * 0.006), lo = Math.min(o, p) * (1 - rnd() * 0.006);
      out.push({ time: now - (n - 1 - i) * step, open: o, high: hi, low: lo, close: p });
    }
    return out;
  }

  var api = { TIMEFRAMES: TIMEFRAMES, PROVIDERS: PROVIDERS, loadSilver: loadSilver, parseCsv: parseCsv, demo: demo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RCData = api;
})(typeof window !== 'undefined' ? window : this);
