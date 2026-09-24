/*
 * RC — RSI uyumsuzluk (divergence) motoru.
 * Tarayıcıda window.RCDiv olarak, Node'da module.exports olarak kullanılır.
 *
 * Mum formatı: { time: <unix saniye>, open, high, low, close }
 *
 * Uyumsuzluk tipleri (TradingView "RSI Divergence" mantığı):
 *  - bull  (Pozitif)        : Fiyat daha düşük dip, RSI daha yüksek dip
 *  - hbull (Gizli pozitif)  : Fiyat daha yüksek dip, RSI daha düşük dip
 *  - bear  (Negatif)        : Fiyat daha yüksek tepe, RSI daha düşük tepe
 *  - hbear (Gizli negatif)  : Fiyat daha düşük tepe, RSI daha yüksek tepe
 */
(function (root) {
  'use strict';

  var TYPES = {
    bull:  { key: 'bull',  label: 'Pozitif',        short: 'P',  side: 'low',  color: '#8fe3b0', hidden: false, desc: 'Fiyat daha düşük dip, RSI daha yüksek dip — yükseliş dönüşü sinyali' },
    bear:  { key: 'bear',  label: 'Negatif',        short: 'N',  side: 'high', color: '#ff7a66', hidden: false, desc: 'Fiyat daha yüksek tepe, RSI daha düşük tepe — düşüş dönüşü sinyali' },
    hbull: { key: 'hbull', label: 'Gizli Pozitif',  short: 'GP', side: 'low',  color: '#9cc9ff', hidden: true,  desc: 'Fiyat daha yüksek dip, RSI daha düşük dip — yükseliş trendi devam sinyali' },
    hbear: { key: 'hbear', label: 'Gizli Negatif',  short: 'GN', side: 'high', color: '#e6b877', hidden: true,  desc: 'Fiyat daha düşük tepe, RSI daha yüksek tepe — düşüş trendi devam sinyali' }
  };

  // minRight: "oluşuyor" demek için aday dipten/tepeden sonra en az kaç mum görülmeli
  var DEFAULTS = { period: 14, left: 5, right: 5, minRange: 5, maxRange: 60, minRight: 2 };

  /** Wilder RSI. İlk `period` değer null döner. */
  function rsi(closes, period) {
    var n = closes.length;
    var out = new Array(n).fill(null);
    if (n <= period) return out;
    var gain = 0, loss = 0;
    for (var i = 1; i <= period; i++) {
      var d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    var avgG = gain / period, avgL = loss / period;
    out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    for (var j = period + 1; j < n; j++) {
      var dd = closes[j] - closes[j - 1];
      avgG = (avgG * (period - 1) + (dd > 0 ? dd : 0)) / period;
      avgL = (avgL * (period - 1) + (dd < 0 ? -dd : 0)) / period;
      out[j] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return out;
  }

  /**
   * Pivot (dip/tepe) indeksleri. Bir nokta, solundaki `left` ve sağındaki
   * `right` değerden kesin olarak daha düşük (dip) / yüksek (tepe) ise pivottur.
   * Eşitlikte soldaki değer kazanır (çift pivotu önler).
   */
  function pivots(values, left, right, side) {
    var res = [];
    for (var i = left; i < values.length - right; i++) {
      var v = values[i];
      if (v == null) continue;
      var ok = true;
      for (var k = i - left; k <= i + right && ok; k++) {
        if (k === i) continue;
        var w = values[k];
        if (w == null) { ok = false; break; }
        if (side === 'low') {
          if (k < i ? w <= v : w < v) ok = false;
        } else {
          if (k < i ? w >= v : w > v) ok = false;
        }
      }
      if (ok) res.push(i);
    }
    return res;
  }

  function point(candles, r, i, side) {
    return {
      i: i,
      time: candles[i].time,
      price: side === 'low' ? candles[i].low : candles[i].high,
      rsi: r[i]
    };
  }

  /**
   * Tüm uyumsuzlukları bulur.
   * Dönen dizi zaman sırasına göre sıralıdır; her öğe:
   * { type, from:{i,time,price,rsi}, to:{...}, confirmIndex }
   */
  function findDivergences(candles, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var closes = candles.map(function (c) { return c.close; });
    var r = rsi(closes, o.period);
    var out = [];

    function scan(side) {
      var idx = pivots(r, o.left, o.right, side);
      for (var p = 1; p < idx.length; p++) {
        var a = idx[p - 1], b = idx[p];
        var dist = b - a;
        if (dist < o.minRange || dist > o.maxRange) continue;
        var A = point(candles, r, a, side), B = point(candles, r, b, side);
        var type = classify(side, A, B);
        if (type) out.push({ type: type, from: A, to: B, confirmIndex: Math.min(b + o.right, candles.length - 1) });
      }
    }
    scan('low');
    scan('high');
    out.sort(function (x, y) { return x.to.i - y.to.i || x.from.i - y.from.i; });
    return { rsi: r, divergences: out };
  }

  function classify(side, A, B) {
    if (side === 'low') {
      if (B.price < A.price && B.rsi > A.rsi) return 'bull';
      if (B.price > A.price && B.rsi < A.rsi) return 'hbull';
    } else {
      if (B.price > A.price && B.rsi < A.rsi) return 'bear';
      if (B.price < A.price && B.rsi > A.rsi) return 'hbear';
    }
    return null;
  }

  /**
   * Oluşmakta olan (henüz onaylanmamış) uyumsuzluklar.
   * Son onaylı pivot ile, sağ tarafı henüz tamamlanmamış aday pivot karşılaştırılır.
   * Aday, solundaki `left` mumdan daha uç ve kendisinden sonraki mumlarca aşılmamış olmalı.
   * Dönen öğe: { type, from, to, potential: true, barsLeft } — barsLeft: onay için gereken mum sayısı.
   */
  function findPotential(candles, opts, rsiValues) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var r = rsiValues || rsi(candles.map(function (c) { return c.close; }), o.period);
    var n = candles.length, out = [];
    ['low', 'high'].forEach(function (side) {
      var piv = pivots(r, o.left, o.right, side);
      if (!piv.length) return;
      var a = piv[piv.length - 1];
      var cand = -1;
      for (var j = Math.max(n - o.right, a + 1, o.left); j < n; j++) {
        var v = r[j];
        if (v == null) continue;
        var ok = true, k, w;
        for (k = j - o.left; k < j && ok; k++) {
          w = r[k];
          if (w == null || (side === 'low' ? w <= v : w >= v)) ok = false;
        }
        for (k = j + 1; k < n && ok; k++) {
          w = r[k];
          if (side === 'low' ? w < v : w > v) ok = false;
        }
        if (ok) cand = j;
      }
      if (cand < 0) return;
      // Erken alarmı azalt: adaydan sonra en az minRight mum geçmiş ve RSI dönmüş olmalı
      if (n - 1 - cand < o.minRight) return;
      if (side === 'low' ? !(r[n - 1] > r[cand]) : !(r[n - 1] < r[cand])) return;
      var dist = cand - a;
      if (dist < o.minRange || dist > o.maxRange) return;
      var A = point(candles, r, a, side), B = point(candles, r, cand, side);
      var type = classify(side, A, B);
      if (type) out.push({ type: type, from: A, to: B, potential: true, barsLeft: o.right - (n - 1 - cand) });
    });
    return out;
  }

  var api = { TYPES: TYPES, DEFAULTS: DEFAULTS, rsi: rsi, pivots: pivots, findDivergences: findDivergences, findPotential: findPotential };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RCDiv = api;
})(typeof window !== 'undefined' ? window : this);
