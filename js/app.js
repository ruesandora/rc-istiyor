/* RC — Gümüş & Altın RSI Uyumsuzluk: arayüz */
(function () {
  'use strict';

  var D = window.RCDiv, API = window.RCData, CFG = window.RC_CONFIG || {};
  var TYPES = D.TYPES, TF = API.TIMEFRAMES;
  var ORDER = ['1d', '4h', '1h', '1w'];        // Günlük önce
  var FRESH_BARS = 10;                          // "yeni onaylandı" sayılacak süre (mum)
  var REFRESH_MS = 2 * 60 * 1000;
  var MEANING = {
    bull: 'Düşüş zayıflıyor, yukarı dönüş olabilir.',
    bear: 'Yükseliş zayıflıyor, aşağı dönüş olabilir.',
    hbull: 'Yükseliş trendi devam edebilir.',
    hbear: 'Düşüş trendi devam edebilir.'
  };
  // Düz Türkçe: işaret neyi gösteriyor
  var DIR = { bull: 'yukarı dönüş', bear: 'aşağı dönüş', hbull: 'yükselişin sürmesi', hbear: 'düşüşün sürmesi' };
  var SHAPE = {
    bull: ['daha düşük dip', 'daha yüksek dip'],
    bear: ['daha yüksek tepe', 'daha düşük tepe'],
    hbull: ['daha yüksek dip', 'daha düşük dip'],
    hbear: ['daha düşük tepe', 'daha yüksek tepe']
  };

  var $ = function (id) { return document.getElementById(id); };
  var results = {};           // tf -> { candles, closed, divs, pending, rsi }
  var selected = '1d', firstDraw = true;
  var market = { source: '', symbol: '' };

  // Metal: #altin ile açılırsa altın; seçim hatırlanır
  var asset = /altin|gold/.test(location.hash) ? 'gold' : (location.hash ? 'silver' : null);
  if (!asset) { try { asset = localStorage.getItem('rc-asset') === 'gold' ? 'gold' : 'silver'; } catch (e) { asset = 'silver'; } }
  function A() { return API.ASSETS[asset]; }

  // --- Biçim -----------------------------------------------------------------

  function money(v) { return '$' + v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // RSI her zaman tam sayı ve mor gösterilir; fiyat her zaman $ ve iki ondalık. Karışmasın.
  function rsiN(v) { return v == null ? '—' : String(Math.round(v)); }
  function strip(v) {
    var on = v == null ? 0 : Math.round(v / 10), h = '<span class="strip" aria-hidden="true">';
    for (var i = 1; i <= 10; i++) h += '<i' + (i <= on ? ' class="on"' : '') + '></i>';
    return h + '</span>';
  }
  function rsiChip(v) { return '<span class="rsi-chip">' + strip(v) + 'RSI ' + rsiN(v) + '</span>'; }
  function zone(v) { return v == null ? '' : v >= 70 ? 'aşırı alım' : v <= 30 ? 'aşırı satım' : 'nötr'; }
  function date(t, tf) {
    var daily = tf === '1d' || tf === '1w';
    return new Date(t * 1000).toLocaleString('tr-TR', Object.assign({ timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' },
      daily ? { year: 'numeric' } : { hour: '2-digit', minute: '2-digit' }));
  }
  function ago(bars, tf) {
    var s = bars * TF[tf].seconds, d = Math.round(s / 86400), h = Math.round(s / 3600);
    if (bars <= 0) return 'bugün';
    return d >= 1 ? d + ' gün önce' : h + ' saat önce';
  }
  /** mum sayısı → "4 gün", "16 saat", "2 hafta" */
  function dur(bars, tf) {
    var s = bars * TF[tf].seconds;
    if (s >= 7 * 86400 && s % (7 * 86400) === 0) return (s / 604800) + ' hafta';
    if (s >= 86400) return Math.round(s / 86400) + ' gün';
    return Math.round(s / 3600) + ' saat';
  }
  function label(type) { return TYPES[type].label.replace('Gizli Pozitif', 'Gizli pozitif').replace('Gizli Negatif', 'Gizli negatif'); }
  function typeHtml(type) { return '<span class="type t-' + type + (TYPES[type].hidden ? ' hid' : '') + '">' + label(type) + '</span>'; }
  function pair(a, b, f) { return f(a) + '<span class="arrow">→</span>' + f(b); }

  // --- Veri ------------------------------------------------------------------

  function analyze(tf, d) {
    var now = Date.now() / 1000;
    var closed = API.closedOnly(d.candles, tf, now);
    var res = D.findDivergences(closed);
    return {
      candles: d.candles,
      closed: closed,
      divs: res.divergences,
      pending: D.findPotential(closed, null, res.rsi),
      rsi: D.rsi(d.candles.map(function (c) { return c.close; }), 14).pop()
    };
  }

  /** Kartta gösterilecek durum: oluşan > yeni onaylanan > yok */
  /** Gösterilecek uyumsuzluk: oluşan > yeni onaylanan > en son görülen > hiç yok */
  function stateOf(r) {
    if (r.pending.length) return { kind: 'pot', ev: r.pending[r.pending.length - 1] };
    var last = r.divs[r.divs.length - 1];
    if (!last) return { kind: 'none', ev: null };
    return { kind: r.closed.length - 1 - last.confirmIndex <= FRESH_BARS ? 'new' : 'old', ev: last };
  }

  /** Tek cümlelik sade özet */
  function plain(st, r, tf) {
    var e = st.ev, per = TF[tf].label.toLocaleLowerCase('tr-TR');
    if (!e) return per.charAt(0).toLocaleUpperCase('tr-TR') + per.slice(1) + ' grafikte henüz bir uyumsuzluk görülmedi.';
    var g = per.charAt(0).toLocaleUpperCase('tr-TR') + per.slice(1) + ' grafikte <b>' + DIR[e.type] + '</b> işareti ';
    if (st.kind === 'pot') return g + 'oluşmaya başladı; henüz kesin değil, <b>' + dur(e.barsLeft, tf) + '</b> içinde netleşir.';
    var ago2 = ago(r.closed.length - 1 - e.confirmIndex, tf);
    return g + (st.kind === 'new' ? 'kesinleşti (' + ago2 + ').' : ago2 + ' görüldü. Şu an yeni bir işaret yok.');
  }

  // Önce sitenin sunucusundan (/api/status), olmazsa doğrudan borsadan
  var loadSeq = 0;
  function loadAll() {
    var seq = ++loadSeq, a = asset, got = {};
    return fetch('/api/status?asset=' + a).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (j) {
      ORDER.forEach(function (tf) {
        var t = j.timeframes && j.timeframes[tf];
        if (!t || t.error) throw new Error(tf + ': ' + (t ? t.error : 'yok'));
        got[tf] = analyze(tf, { candles: t.candles.map(function (k) { return { time: k[0], open: k[1], high: k[2], low: k[3], close: k[4] }; }) });
      });
      got.$market = { source: j.source, symbol: j.symbol };
    }).catch(function () {
      got = {};
      return Promise.all(ORDER.map(function (tf) {
        return API.loadAsset(tf, a).then(function (d) { got[tf] = analyze(tf, d); got.$market = { source: d.source + ' perpetual', symbol: 'BINANCE:' + API.ASSETS[a].binance + '.P' }; },
          function (e) { got[tf] = { error: e.message }; });
      }));
    }).then(function () {
      if (seq !== loadSeq || a !== asset) return; // metal değiştiyse eski cevabı at
      if (got.$market) market = got.$market;
      delete got.$market;
      results = got;
      render();
    });
  }

  // --- Metal seçimi (Gümüş | Altın) -----------------------------------------

  function applyAsset() {
    var a = A();
    document.title = 'RC. ' + a.name + ' RSI Uyumsuzluk';
    $('heroLoc').textContent = a.loc;
    $('tickerName').textContent = a.name;
    Array.prototype.forEach.call(document.querySelectorAll('#assetSeg button'), function (b) {
      var on = b.getAttribute('data-asset') === asset;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    document.body.setAttribute('data-asset', asset);
  }
  function setAsset(a) {
    if (!API.ASSETS[a] || a === asset) return;
    asset = a;
    try { localStorage.setItem('rc-asset', a); } catch (e) { /* yok say */ }
    history.replaceState(null, '', a === 'gold' ? '#altin' : '#gumus');
    results = {}; firstDraw = true; market = { source: '', symbol: '' };
    $('price').textContent = '—'; $('change').innerHTML = '';
    applyAsset(); renderCards(); renderList(); drawChart(true);
    loadAll();
  }
  $('assetSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-asset]');
    if (b) setAsset(b.getAttribute('data-asset'));
  });

  // --- Çizim -----------------------------------------------------------------

  /** Günlük: fiş kartı (hero'nun sağında). Her zaman güncel ya da en son uyumsuzluğu gösterir. */
  function receipt(tf) {
    var r = results[tf], sel = tf === selected ? ' sel' : '';
    var top = '<div class="r-top"><span>' + A().name + ' · ' + TF[tf].label + '</span>' + (r && !r.error ? rsiChip(r.rsi) : '') + '</div>';
    if (!r) return '<div role="button" tabindex="0" class="receipt" data-tf="' + tf + '">' + top + '<div class="r-head none">Yükleniyor…</div></div>';
    if (r.error) return '<div role="button" tabindex="0" class="receipt" data-tf="' + tf + '">' + top + '<div class="r-head none">Veri alınamadı</div><p class="r-foot">Birazdan tekrar denenecek.</p></div>';
    var st = stateOf(r), e = st.ev;
    if (!e) {
      return '<div role="button" tabindex="0" class="receipt' + sel + '" data-tf="' + tf + '">' + top +
        '<div class="r-head none">Uyumsuzluk yok</div><p class="r-plain">' + plain(st, r, tf) + '</p></div>';
    }
    var t = e.type, o = st.kind === 'pot' ? null : outcome(e, r, true);
    return '<div role="button" tabindex="0" class="receipt t-' + t + sel + '" data-tf="' + tf + '">' + top +
      '<div style="margin-top:14px">' + stateTag(st, r, tf) + '</div>' +
      '<div class="r-head">' + label(t) + (st.kind === 'pot' ? ' oluşuyor' : ' uyumsuzluk') + '</div>' +
      '<p class="r-plain">' + plain(st, r, tf) + '</p>' +
      '<hr class="r-dash">' +
      row('Fiyat', money(e.from.price) + ' → ' + money(e.to.price) + '<small>' + SHAPE[t][0] + '</small>') +
      row('RSI', rsiN(e.from.rsi) + ' → ' + rsiN(e.to.rsi) + '<small>' + SHAPE[t][1] + '</small>', 'rsi') +
      row('Tarih', date(e.from.time, tf) + ' → ' + date(e.to.time, tf)) +
      (o ? row('O günden beri', '<span class="' + (o.ok ? 'up' : 'down') + '">' + pct(o.ch) + '</span><small>' + (o.ok ? 'beklenen yönde' : 'ters yönde') + '</small>') : '') +
      '<p class="r-foot">' + MEANING[t] + ' Tavsiye değildir.</p></div>';
  }
  function row(l, v, cls) {
    return '<div class="r-row' + (cls ? ' ' + cls : '') + '"><span class="l">' + l + '</span><span class="fill"></span><span class="v">' + v + '</span></div>';
  }
  function stateTag(st, r, tf) {
    if (st.kind === 'pot') return '<span class="tag pot">Oluşuyor · ' + dur(st.ev.barsLeft, tf) + ' içinde netleşir</span>';
    if (st.kind === 'new') return '<span class="tag new">Onaylandı · ' + ago(r.closed.length - 1 - st.ev.confirmIndex, tf) + '</span>';
    if (st.kind === 'old') return '<span class="tag none">Son görülen · ' + ago(r.closed.length - 1 - st.ev.confirmIndex, tf) + '</span>';
    return '<span class="tag none">Şu an sakin</span>';
  }

  /** 4 saat, 1 saat, haftalık: küçük kartlar. */
  function card(tf) {
    var r = results[tf], cls = 'card' + (tf === selected ? ' sel' : '');
    var head = function (x) { return '<div class="c-top"><span class="c-tf">' + TF[tf].label + '</span>' + x + '</div>'; };
    if (!r) return '<button class="' + cls + '" data-tf="' + tf + '">' + head('') + '<span class="c-head none">Yükleniyor…</span></button>';
    if (r.error) return '<button class="' + cls + '" data-tf="' + tf + '">' + head('') + '<span class="c-head none">Veri alınamadı</span></button>';
    var st = stateOf(r), e = st.ev;
    if (!e) {
      return '<button class="' + cls + '" data-tf="' + tf + '">' + head(rsiChip(r.rsi)) +
        '<span class="c-head none">Uyumsuzluk yok</span><div class="c-row">Bu periyotta henüz görülmedi.</div></button>';
    }
    var t = e.type;
    return '<button class="' + cls + ' t-' + t + (TYPES[t].hidden ? ' hid' : '') + (st.kind === 'old' ? ' old' : '') + '" data-tf="' + tf + '">' + head(rsiChip(r.rsi)) +
      '<div style="margin-top:12px">' + stateTag(st, r, tf) + '</div>' +
      '<span class="c-head">' + label(t) + (st.kind === 'pot' ? ' oluşuyor' : '') + ' <span class="arr">' + (TYPES[t].side === 'low' ? '↑' : '↓') + '</span></span>' +
      '<div class="c-row"><span class="l">Fiyat</span>' + money(e.from.price) + ' → ' + money(e.to.price) + '</div>' +
      '<div class="c-row rsi"><span class="l">RSI</span>' + rsiN(e.from.rsi) + ' → ' + rsiN(e.to.rsi) + '</div></button>';
  }

  function renderCards() {
    $('receipt').innerHTML = receipt('1d');
    $('others').innerHTML = ORDER.slice(1).map(card).join('');
  }

  function render() {
    renderCards();

    var d = results['1d'];
    if (d && !d.error) {
      var c = d.candles, last = c[c.length - 1], prev = c[c.length - 2];
      var ch = (last.close - prev.close) / prev.close * 100;
      $('price').textContent = money(last.close);
      $('change').innerHTML = '<span class="' + (ch >= 0 ? 'up' : 'down') + '">' + (ch >= 0 ? '+' : '') + ch.toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + '%</span>';
    }
    var ok = ORDER.some(function (tf) { return results[tf] && !results[tf].error; });
    $('live').className = 'live' + (ok ? ' ok' : '');
    $('updated').textContent = ok
      ? 'Canlı · son güncelleme ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
      : 'Veriye şu an ulaşılamıyor, birazdan tekrar denenecek.';
    renderList();
    drawChart(firstDraw); firstDraw = false;
    notifyCheck();
  }

  var HORIZON = 10;   // sonuç, onaydan kaç mum sonra ölçülür

  /** Onay mumunun kapanışı → 10 mum sonraki kapanış. Pozitifte yükseliş, negatifte düşüş = çalıştı. */
  function outcome(e, r, sinceNow) {
    var c = r.closed, i = e.confirmIndex, base = c[i] && c[i].close;
    if (!base) return null;
    var up = TYPES[e.type].side === 'low';
    var j = sinceNow ? c.length - 1 : Math.min(i + HORIZON, c.length - 1), ch = (c[j].close - base) / base * 100;
    return { done: i + HORIZON <= c.length - 1, bars: j - i, ch: ch, ok: up ? ch > 0 : ch < 0 };
  }
  function pct(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
  function resultHtml(e, r) {
    if (e.potential) return '<span class="res wait">Henüz sinyal değil</span>';
    var o = outcome(e, r);
    if (!o) return '';
    if (!o.done) return '<span class="res wait">Bekleniyor ' + o.bars + '/' + HORIZON + ' <small>şimdilik ' + pct(o.ch) + '</small></span>';
    return o.ok ? '<span class="res ok">✓ Beklenen yönde <small>fiyat ' + pct(o.ch) + '</small></span>'
                : '<span class="res no">✗ Ters yönde <small>fiyat ' + pct(o.ch) + '</small></span>';
  }

  function renderList() {
    var r = results[selected];
    $('listTf').textContent = TF[selected].label;
    $('listScore').textContent = '';
    if (!r || r.error) { $('rows').innerHTML = '<tr><td colspan="5" class="empty">' + (r ? 'Veri alınamadı.' : 'Yükleniyor…') + '</td></tr>'; return; }
    var last = r.divs.slice(-8).reverse(), items = r.pending.concat(last);
    if (!items.length) { $('rows').innerHTML = '<tr><td colspan="5" class="empty">Uyumsuzluk bulunamadı.</td></tr>'; return; }
    var done = last.map(function (e) { return outcome(e, r); }).filter(function (o) { return o && o.done; });
    var wins = done.filter(function (o) { return o.ok; }).length;
    if (done.length) $('listScore').innerHTML = 'Sonuçlanan ' + done.length + ' sinyalden <b>' + wins + ' tanesi</b> beklenen yönde gitti';
    $('rows').innerHTML = items.map(function (e) {
      return '<tr><td>' + typeHtml(e.type) + (e.potential ? '<span class="tag">Oluşuyor</span>' : '') + '</td>' +
        '<td>' + date(e.to.time, selected) + '</td>' +
        '<td>' + pair(e.from.price, e.to.price, money) + '</td>' +
        '<td class="rsi">' + pair(e.from.rsi, e.to.rsi, rsiN) + '</td>' +
        '<td>' + resultHtml(e, r) + '</td></tr>';
    }).join('');
  }

  // --- Grafik (TradingView Lightweight Charts) -----------------------------

  var TZ = 3 * 3600;   // grafikte Türkiye saati
  // İki renk: pozitif yeşil, negatif kırmızı (gizliler kesikli çizgiyle ayrılır)
  var HEX = { bull: '#5ee39a', bear: '#ff7a6b', hbull: '#5ee39a', hbear: '#ff7a6b' };
  var LWC = window.LightweightCharts, pc = null, rc = null, candleS = null, rsiS = null, lines = [];

  function initCharts() {
    if (!LWC || pc) return !!pc;
    var base = {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#9d9c92', fontFamily: 'Geist, system-ui, sans-serif', fontSize: 12, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,.04)' }, horzLines: { color: 'rgba(255,255,255,.04)' } },
      rightPriceScale: { borderVisible: false, minimumWidth: 64 },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 14 },
      crosshair: { mode: 0 },
      localization: { locale: 'tr-TR' }
    };
    pc = LWC.createChart($('priceChart'), base);
    rc = LWC.createChart($('rsiChart'), base);
    // Fiyat ekseni "$64,36", RSI ekseni tam sayı ve "RSI" etiketli: iki eksen karışmaz
    // Mumlar nötr gri: yeşil/kırmızı yalnızca uyumsuzluk çizgilerine ait
    candleS = pc.addCandlestickSeries({
      upColor: '#b9bbb2', downColor: '#4a4c44', borderVisible: false, wickUpColor: '#8b8d85', wickDownColor: '#6a6c64', priceLineColor: '#9d9c92',
      priceFormat: { type: 'custom', minMove: 0.01, formatter: function (v) { return money(v); } }
    });
    rsiS = rc.addLineSeries({
      color: '#b69cff', lineWidth: 2, priceLineVisible: false, title: 'RSI',
      priceFormat: { type: 'custom', minMove: 1, formatter: function (v) { return rsiN(v); } }
    });
    rsiS.applyOptions({ autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; } });
    [70, 30].forEach(function (v) { rsiS.createPriceLine({ price: v, color: 'rgba(182,156,255,.35)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }); });
    var busy = false;
    function link(a, b) {
      a.timeScale().subscribeVisibleLogicalRangeChange(function (r) {
        if (busy || !r) return; busy = true; b.timeScale().setVisibleLogicalRange(r); busy = false;
      });
    }
    link(pc, rc); link(rc, pc);
    return true;
  }

  function narrow() { return window.matchMedia && window.matchMedia('(max-width: 700px)').matches; }
  function addLine(chart, e, a, b) {
    var s = chart.addLineSeries({
      color: HEX[e.type], lineWidth: 3, lineStyle: e.potential ? 1 : (TYPES[e.type].hidden ? 2 : 0),
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false
    });
    s.setData([{ time: e.from.time + TZ, value: a }, { time: e.to.time + TZ, value: b }]);
    lines.push([chart, s]);
  }

  function drawChart(fit) {
    $('chartTf').textContent = TF[selected].label;
    $('tvLink').href = 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(market.symbol);
    Array.prototype.forEach.call(document.querySelectorAll('.src'), function (el) { el.textContent = market.source; });
    var r = results[selected];
    renderInfo(r);
    if (!initCharts()) return;
    if (!r || r.error) {   // metal değişti / veri yok: eski grafiği temizle
      candleS.setData([]); rsiS.setData([]); candleS.setMarkers([]);
      lines.forEach(function (l) { l[0].removeSeries(l[1]); }); lines = [];
      return;
    }
    var c = r.candles, rsi = D.rsi(c.map(function (x) { return x.close; }), 14);
    candleS.setData(c.map(function (x) { return { time: x.time + TZ, open: x.open, high: x.high, low: x.low, close: x.close }; }));
    rsiS.setData(c.map(function (x, i) { return rsi[i] == null ? { time: x.time + TZ } : { time: x.time + TZ, value: rsi[i] }; }));
    lines.forEach(function (l) { l[0].removeSeries(l[1]); }); lines = [];
    var events = r.divs.concat(r.pending), markers = [];
    events.forEach(function (e) {
      addLine(pc, e, e.from.price, e.to.price);
      addLine(rc, e, e.from.rsi, e.to.rsi);
      var low = TYPES[e.type].side === 'low';
      markers.push({
        time: e.to.time + TZ, position: low ? 'belowBar' : 'aboveBar', color: HEX[e.type],
        shape: e.potential ? 'circle' : (low ? 'arrowUp' : 'arrowDown'),
        text: e === events[events.length - 1] && !narrow() ? label(e.type) : TYPES[e.type].short + (e.potential ? '?' : '')
      });
    });
    markers.sort(function (a, b) { return a.time - b.time; });
    candleS.setMarkers(markers);
    if (fit) {
      var n = c.length;
      pc.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 14 });
    }
  }

  /** Grafiğin üstünde: bu periyotta şu an ne var, düz cümleyle. */
  function renderInfo(r) {
    var el = $('chartInfo');
    if (!r || r.error) { el.innerHTML = ''; return; }
    var st = stateOf(r), e = st.ev;
    el.className = 'info';
    if (!e) { el.innerHTML = '<div>' + TF[selected].label + ' grafikte henüz uyumsuzluk yok.</div>'; return; }
    el.className = 'info t-' + e.type;
    var when = st.kind === 'pot' ? 'şu an <b>oluşuyor</b> (onaya ' + e.barsLeft + ' mum)' : st.kind === 'new' ? 'yeni <b>onaylandı</b>' : 'en son ' + date(e.to.time, selected) + ' tarihinde görüldü';
    el.innerHTML = '<div><b>' + label(e.type) + ' uyumsuzluk</b> ' + when + '. ' +
      'Fiyat ' + money(e.from.price) + ' → ' + money(e.to.price) + ' (' + SHAPE[e.type][0] + '), ' +
      '<span class="rsi-t">RSI ' + rsiN(e.from.rsi) + ' → ' + rsiN(e.to.rsi) + '</span> (' + SHAPE[e.type][1] + '). ' +
      MEANING[e.type] + ' Grafikte ' + date(e.from.time, selected) + ' ile ' + date(e.to.time, selected) + ' arasındaki çizgi.</div>';
  }

  function renderTabs() {
    $('tabs').innerHTML = ORDER.map(function (tf) {
      return '<button data-tf="' + tf + '" class="' + (tf === selected ? 'on' : '') + '">' + TF[tf].label + '</button>';
    }).join('');
  }

  function select(tf) {
    if (!TF[tf] || tf === selected) return;
    selected = tf;
    renderTabs(); drawChart(true); renderList(); renderCards();
  }
  function onPick(e) {
    var b = e.target.closest('[data-tf]');
    if (!b) return;
    select(b.getAttribute('data-tf'));
    if (b.id !== 'tabs' && !b.closest('#tabs')) $('chartInfo').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('tabs').addEventListener('click', onPick);
  $('receipt').addEventListener('click', onPick);
  $('receipt').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(e); } });
  $('others').addEventListener('click', onPick);

  // --- Tarayıcı bildirimi (sekme açıkken) ------------------------------------

  var KEY = 'rc-notify-v2', note = { on: false, seen: {} }, primed = false;
  try { note = Object.assign(note, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* yok say */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(note)); } catch (e) { /* yok say */ } }
  function allowed() { return 'Notification' in window && Notification.permission === 'granted' && note.on; }

  function notifyCheck() {
    if (!allowed()) { primed = true; return; }
    ORDER.forEach(function (tf) {
      var r = results[tf];
      if (!r || r.error) return;
      var events = r.pending.concat(r.divs.filter(function (d) { return r.closed.length - 1 - d.confirmIndex <= 2; }));
      events.forEach(function (e) {
        var k = asset + ':' + tf + ':' + e.type + ':' + e.from.time + (e.potential ? ':pot' : ':' + e.to.time);
        if (note.seen[k]) return;
        note.seen[k] = Date.now();
        if (!primed && note.fresh) return; // bildirim yeni açıldıysa mevcutları sessizce işaretle
        try {
          new Notification(A().name + ' ' + TF[tf].label + ': ' + label(e.type) + (e.potential ? ' oluşuyor' : ' onaylandı'), {
            body: 'Fiyat ' + money(e.from.price) + ' → ' + money(e.to.price) + ' · RSI ' + rsiN(e.from.rsi) + ' → ' + rsiN(e.to.rsi) + ' · Tavsiye değildir', tag: k
          });
        } catch (err) { /* yok say */ }
      });
    });
    primed = true; note.fresh = false; save();
  }

  function renderNotify() {
    var b = $('notifyBtn'), n = $('notifyNote');
    if (!('Notification' in window)) { b.disabled = true; n.textContent = 'Bu tarayıcı bildirim desteklemiyor. iPhone’da siteyi “Ana Ekrana Ekle” ile açın veya Telegram kanalını kullanın.'; return; }
    var on = allowed(), denied = Notification.permission === 'denied';
    b.classList.toggle('on', on);
    b.disabled = denied;
    b.textContent = denied ? 'Bildirim engelli' : on ? 'Tarayıcı bildirimi açık ✓' : 'Tarayıcı bildirimi aç';
    n.textContent = denied ? 'Tarayıcı ayarlarından bu site için bildirime izin verin.'
      : on ? 'Bu sekme açıkken bildirim gelir. Sekme kapalıyken de haber almak için Telegram kanalına katılın.'
      : 'Bildirim yalnızca bu sekme açıkken gelir.';
  }
  $('notifyBtn').addEventListener('click', function () {
    if (allowed()) { note.on = false; save(); renderNotify(); return; }
    Notification.requestPermission().then(function (p) {
      note.on = p === 'granted'; note.fresh = true; primed = false; save(); renderNotify();
      if (note.on) notifyCheck();
    });
  });

  // --- Başlat ----------------------------------------------------------------

  if (CFG.telegramUrl) { $('tgBtn').href = CFG.telegramUrl; $('tgBtn').hidden = false; }
  else $('notifyBtn').className = 'btn btn-silver';
  $('yr').textContent = new Date().getFullYear();
  applyAsset(); renderTabs(); renderNotify(); renderCards();
  loadAll();
  setInterval(function () { if (!document.hidden) loadAll(); }, REFRESH_MS);
})();
