/* RC — Gümüş RSI Uyumsuzluk: arayüz */
(function () {
  'use strict';

  var D = window.RCDiv, API = window.RCData, LWC = window.LightweightCharts;
  var TYPES = D.TYPES, TF = API.TIMEFRAMES;
  var TYPE_ORDER = ['bull', 'bear', 'hbull', 'hbear'];
  var TZ_SHIFT = 3 * 3600;          // Türkiye saati (UTC+3) grafikte gösterim için
  var FRESH_BARS = 10;
  var REFRESH_MS = 60 * 1000, SCAN_MS = 2 * 60 * 1000, CACHE_MS = 45 * 1000;

  var STORE_KEY = 'rc-rsi-div-v1';
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { saved = {}; }

  var state = {
    tf: TF[saved.tf] ? saved.tf : '4h',
    unit: saved.unit === 'try' ? 'try' : 'usd',
    show: Object.assign({ bull: true, bear: true, hbull: true, hbear: true }, saved.show || {}),
    opts: Object.assign({}, D.DEFAULTS, saved.opts || {}),
    mode: 'live',                   // live | demo | csv
    candles: [], result: null, source: '',
    csv: null, fitNext: true
  };

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ tf: state.tf, unit: state.unit, show: state.show, opts: state.opts })); } catch (e) { /* yok say */ }
  }

  var $ = function (id) { return document.getElementById(id); };

  // --- Biçimlendirme --------------------------------------------------------

  function decimals() { return 2; }
  function fmtPrice(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('tr-TR', { minimumFractionDigits: d == null ? decimals() : d, maximumFractionDigits: d == null ? decimals() : d });
  }
  function currency() { return state.unit === 'try' ? '₺' : '$'; }
  function fmtRsi(v) { return v == null ? '—' : v.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function fmtDate(t, tf) {
    var withTime = tf !== '1d' && tf !== '1w';
    return new Date(t * 1000).toLocaleString('tr-TR', Object.assign(
      { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: '2-digit' },
      withTime ? { hour: '2-digit', minute: '2-digit' } : {}));
  }
  function ago(bars, tf) {
    if (bars <= 0) return 'şimdi';
    return bars + ' mum önce' + (TF[tf] ? ' · ' + humanDur(bars * TF[tf].seconds) : '');
  }
  function humanDur(s) {
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d >= 1) return d + ' gün' + (h && d < 7 ? ' ' + h + ' sa' : '');
    if (h >= 1) return h + ' sa' + (m ? ' ' + m + ' dk' : '');
    return m + ' dk';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function badge(type, extra) { var t = TYPES[type]; return '<span class="sig' + (t.hidden ? ' dash' : '') + (extra ? ' ' + extra : '') + '" style="--c:' + t.color + '">' + t.label + '</span>'; }

  // --- Grafikler ------------------------------------------------------------

  var chartOpts = {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: 'rgba(233,232,228,.68)', fontFamily: "'Inter Tight', 'Helvetica Neue', Arial, sans-serif", fontSize: 12 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(233,232,228,.05)' } },
    rightPriceScale: { borderVisible: false, minimumWidth: 72 },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: 0,
      vertLine: { color: 'rgba(233,232,228,.35)', width: 1, style: 3, labelBackgroundColor: '#e9e8e4' },
      horzLine: { color: 'rgba(233,232,228,.35)', width: 1, style: 3, labelBackgroundColor: '#e9e8e4' } },
    localization: { locale: 'tr-TR', priceFormatter: function (v) { return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } }
  };

  var priceChart = LWC.createChart($('priceChart'), chartOpts);
  var rsiChart = LWC.createChart($('rsiChart'), Object.assign({}, chartOpts, {
    rightPriceScale: { borderVisible: false, minimumWidth: 72, scaleMargins: { top: 0.08, bottom: 0.08 } }
  }));

  var candleSeries = priceChart.addCandlestickSeries({
    upColor: '#e9e8e4', downColor: '#0b0b0c', borderUpColor: '#e9e8e4', borderDownColor: 'rgba(233,232,228,.5)',
    wickUpColor: 'rgba(233,232,228,.75)', wickDownColor: 'rgba(233,232,228,.4)'
  });
  var rsiSeries = rsiChart.addLineSeries({ color: '#e9e8e4', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 });
  rsiSeries.applyOptions({ autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; } });
  [[70, 'rgba(255,122,102,.45)'], [50, 'rgba(233,232,228,.15)'], [30, 'rgba(143,227,176,.45)']].forEach(function (l) {
    rsiSeries.createPriceLine({ price: l[0], color: l[1], lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
  });

  // Web yazı tipi grafikten sonra yüklenirse eksen metinleri yanlış ölçülür; yüklenince yeniden uygula
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      [priceChart, rsiChart].forEach(function (c) {
        c.applyOptions({ layout: { fontFamily: 'monospace' } });
        c.applyOptions({ layout: { fontFamily: chartOpts.layout.fontFamily } });
      });
    });
  }

  // Zaman eksenlerini senkronize et
  var syncing = false;
  function link(a, b) {
    a.timeScale().subscribeVisibleLogicalRangeChange(function (r) {
      if (syncing || !r) return;
      syncing = true; b.timeScale().setVisibleLogicalRange(r); syncing = false;
    });
  }
  link(priceChart, rsiChart); link(rsiChart, priceChart);

  // İmleç senkronizasyonu
  var byTime = {};
  function crossSync(src, dst, dstSeries, valueOf) {
    src.subscribeCrosshairMove(function (p) {
      if (!p || !p.time) { dst.clearCrosshairPosition && dst.clearCrosshairPosition(); $('rsiHover').textContent = ''; return; }
      var row = byTime[p.time];
      if (row) {
        var v = valueOf(row);
        if (v != null && dst.setCrosshairPosition) dst.setCrosshairPosition(v, p.time, dstSeries);
        $('rsiHover').textContent = fmtDate(row.c.time, state.tf) + '   RSI ' + fmtRsi(row.r) + '   K ' + currency() + fmtPrice(row.c.close);
      }
    });
  }
  crossSync(priceChart, rsiChart, rsiSeries, function (row) { return row.r; });
  crossSync(rsiChart, priceChart, candleSeries, function (row) { return row.c.close; });

  var divSeries = [];
  function clearDivLines() {
    divSeries.forEach(function (s) { try { s.chart.removeSeries(s.series); } catch (e) { /* yok say */ } });
    divSeries = [];
  }
  function addLine(chart, type, a, b, potential) {
    var t = TYPES[type];
    var s = chart.addLineSeries({
      color: potential ? t.color + 'aa' : t.color, lineWidth: 2, lineStyle: potential ? 1 : (t.hidden ? 2 : 0), lastPriceAnimation: 0,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false
    });
    s.setData([{ time: a.time + TZ_SHIFT, value: a.v }, { time: b.time + TZ_SHIFT, value: b.v }]);
    divSeries.push({ chart: chart, series: s });
  }

  // --- Veri yükleme --------------------------------------------------------

  var cache = {};
  function getData(tf, unit, force) {
    var key = tf + '|' + unit, c = cache[key];
    if (!force && c && Date.now() - c.at < CACHE_MS) return Promise.resolve(c.data);
    return API.loadSilver(tf, unit).then(function (d) { cache[key] = { at: Date.now(), data: d }; return d; });
  }

  function setLive(cls, text) {
    var el = $('live');
    el.className = 'live ' + cls;
    $('liveText').textContent = text;
  }
  function notice(html, kind) {
    var n = $('notice');
    if (!html) { n.hidden = true; n.innerHTML = ''; return; }
    n.hidden = false; n.className = 'notice' + (kind === 'err' ? ' err' : ''); n.innerHTML = html;
  }

  var loadSeq = 0;
  function load(force) {
    var seq = ++loadSeq;
    if (state.mode === 'csv') { analyze(); return Promise.resolve(); }
    setLive('', 'Yükleniyor…');
    return getData(state.tf, state.unit, force).then(function (d) {
      if (seq !== loadSeq) return;
      state.mode = 'live';
      state.candles = d.candles; state.source = d.source;
      notice(null);
      setLive('ok', 'Canlı · ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }));
      analyze();
    }).catch(function (e) {
      if (seq !== loadSeq) return;
      console.warn(e);
      if (state.candles.length && state.mode === 'live' && !state.fitNext) { setLive('err', 'Güncellenemedi'); return; }
      state.mode = 'demo';
      state.candles = API.demo(state.tf);
      state.source = 'DEMO (rastgele üretilmiş veri — gerçek fiyat değildir)';
      setLive('demo', 'Demo veri');
      notice('Canlı gümüş verisine şu an ulaşılamadı; ekranda <b>örnek (demo) veri</b> gösteriliyor. ' +
        'Ağ bağlantınızı kontrol edip tekrar deneyin veya Ayarlar’dan kendi CSV dosyanızı yükleyin.' +
        '<button class="link" id="retryBtn" type="button">Tekrar dene</button>' +
        '<small>' + esc(e && e.message ? e.message : e) + '</small>', 'err');
      var rb = $('retryBtn'); if (rb) rb.onclick = function () { state.fitNext = true; load(true); runScanner(true); };
      analyze();
    });
  }

  // --- Analiz ve çizim -----------------------------------------------------

  /** Yalnızca kapanmış mumlar (oluşan uyumsuzluk sunucudaki bildirimle aynı hesaplansın). */
  function closedOf(candles, tf) {
    if (!tf) return candles;
    var step = TF[tf].seconds, now = Date.now() / 1000;
    var n = candles.length;
    while (n > 0 && candles[n - 1].time + step > now) n--;
    return candles.slice(0, n);
  }

  function analyze() {
    var candles = state.candles;
    if (!candles.length) return;
    var res = D.findDivergences(candles, state.opts);
    state.result = res;
    var n = candles.length, d = decimals();

    candleSeries.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: Math.pow(10, -d) } });
    candleSeries.setData(candles.map(function (c) {
      return { time: c.time + TZ_SHIFT, open: c.open, high: c.high, low: c.low, close: c.close };
    }));
    byTime = {};
    rsiSeries.setData(candles.map(function (c, i) {
      byTime[c.time + TZ_SHIFT] = { c: c, r: res.rsi[i] };
      return res.rsi[i] == null ? { time: c.time + TZ_SHIFT } : { time: c.time + TZ_SHIFT, value: res.rsi[i] };
    }));

    var visible = res.divergences.filter(function (x) { return state.show[x.type]; });

    clearDivLines();
    var markers = [];
    visible.forEach(function (x) {
      var t = TYPES[x.type], low = t.side === 'low';
      addLine(priceChart, x.type, { time: x.from.time, v: x.from.price }, { time: x.to.time, v: x.to.price });
      addLine(rsiChart, x.type, { time: x.from.time, v: x.from.rsi }, { time: x.to.time, v: x.to.rsi });
      markers.push({ time: x.to.time + TZ_SHIFT, position: low ? 'belowBar' : 'aboveBar', color: t.color, shape: low ? 'arrowUp' : 'arrowDown', text: t.short });
    });
    var pending = D.findPotential(closedOf(candles, state.mode === 'csv' ? null : state.tf), state.opts, res.rsi).filter(function (x) { return state.show[x.type]; });
    pending.forEach(function (x) {
      var t = TYPES[x.type], low = t.side === 'low';
      addLine(priceChart, x.type, { time: x.from.time, v: x.from.price }, { time: x.to.time, v: x.to.price }, true);
      addLine(rsiChart, x.type, { time: x.from.time, v: x.from.rsi }, { time: x.to.time, v: x.to.rsi }, true);
      markers.push({ time: x.to.time + TZ_SHIFT, position: low ? 'belowBar' : 'aboveBar', color: t.color, shape: 'circle', text: t.short + '?' });
    });
    markers.sort(function (a, b) { return a.time - b.time; });
    candleSeries.setMarkers(markers);
    renderPending(pending);

    if (state.fitNext) {
      state.fitNext = false;
      var from = Math.max(0, n - 180);
      priceChart.timeScale().setVisibleLogicalRange({ from: from, to: n + 6 });
    }

    // Özet
    var last = candles[n - 1], prev = candles[n - 2] || last;
    $('unitLabel').textContent = state.unit === 'try' ? 'Gram — ₺' : 'XAG/USD — ons';
    $('cur').textContent = currency();
    $('price').textContent = fmtPrice(last.close);
    var ch = (last.close - prev.close) / prev.close * 100;
    $('change').innerHTML = '<span class="' + (ch >= 0 ? 'up' : 'down') + '">' + (ch >= 0 ? '▲ ' : '▼ ') +
      Math.abs(ch).toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + '%</span>&nbsp;&nbsp;son mum · ' + (state.mode === 'csv' ? 'CSV' : TF[state.tf].label);
    var r = res.rsi[n - 1];
    $('rsiNow').textContent = fmtRsi(r);
    $('rsiNow').style.color = r >= 70 ? 'var(--bear)' : r <= 30 ? 'var(--bull)' : '';
    $('gaugePin').style.left = (r == null ? 50 : Math.max(0, Math.min(100, r))) + '%';
    $('rsiZone').textContent = r == null ? '' : r >= 70 ? 'Aşırı alım bölgesi' : r <= 30 ? 'Aşırı satım bölgesi' : r >= 50 ? 'Nötr · alıcılar önde' : 'Nötr · satıcılar önde';
    $('rsiPeriodLabel').textContent = state.opts.period;
    $('tfLabel').textContent = state.mode === 'csv' ? 'CSV' : TF[state.tf].label;

    var lastDiv = visible[visible.length - 1];
    if (lastDiv) {
      $('lastSig').innerHTML = badge(lastDiv.type, 'metric-sig');
      $('lastSigAge').textContent = fmtDate(lastDiv.to.time, state.tf) + ' · ' + ago(n - 1 - lastDiv.to.i, state.mode === 'csv' ? null : state.tf);
    } else {
      $('lastSig').innerHTML = '<span class="metric-sig" style="color:var(--faint)">Sessiz</span>';
      $('lastSigAge').textContent = 'Seçili türlerde uyumsuzluk bulunamadı';
    }

    $('source').textContent = 'Kaynak: ' + state.source + ' · ' + n + ' mum · Saatler Türkiye saatidir (UTC+3). Uyumsuzluk, pivotun sağında ' + state.opts.right + ' mum oluştuktan sonra onaylanır.';
    renderTable(visible, n, pending);
  }

  function renderPending(list) {
    var el = $('pending');
    if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = list.map(function (x) {
      return '<span class="pending-tag">Oluşuyor</span>' + badge(x.type) + '<span class="mono">onaya ' + x.barsLeft + ' mum</span>';
    }).join('<br>');
  }

  function renderTable(list, n, pending) {
    var body = $('sigBody');
    pending = pending || [];
    $('sigCount').textContent = (list.length ? list.length + ' kayıt' : '') + (pending.length ? ' · ' + pending.length + ' oluşuyor' : '');
    if (!list.length && !pending.length) { body.innerHTML = '<tr><td colspan="5" class="empty">Uyumsuzluk bulunamadı.</td></tr>'; return; }
    var tf = state.mode === 'csv' ? null : state.tf;
    body.innerHTML = pending.concat(list.slice().reverse()).map(function (x, k) {
      var cur = currency();
      if (x.potential) {
        return '<tr class="pot" data-i="' + x.to.i + '">' +
          '<td>' + badge(x.type) + '</td>' +
          '<td><span class="tag-pot">Oluşuyor</span></td>' +
          '<td class="r">' + cur + fmtPrice(x.from.price) + '<span class="arrow">→</span>' + cur + fmtPrice(x.to.price) + '</td>' +
          '<td class="r">' + fmtRsi(x.from.rsi) + '<span class="arrow">→</span>' + fmtRsi(x.to.rsi) + '</td>' +
          '<td class="r">onaya ' + x.barsLeft + ' mum</td></tr>';
      }
      return '<tr data-i="' + x.to.i + '">' +
        '<td>' + badge(x.type) + '</td>' +
        '<td>' + fmtDate(x.to.time, state.tf) + '</td>' +
        '<td class="r">' + cur + fmtPrice(x.from.price) + '<span class="arrow">→</span>' + cur + fmtPrice(x.to.price) + '</td>' +
        '<td class="r">' + fmtRsi(x.from.rsi) + '<span class="arrow">→</span>' + fmtRsi(x.to.rsi) + '</td>' +
        '<td class="r" title="' + (n - 1 - x.to.i) + ' mum önce">' + (tf ? humanDur((n - 1 - x.to.i) * TF[tf].seconds) + ' önce' : (n - 1 - x.to.i) + ' mum önce') + '</td></tr>';
    }).join('');
  }

  $('sigBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    var i = +tr.getAttribute('data-i');
    priceChart.timeScale().setVisibleLogicalRange({ from: i - 70, to: i + 30 });
    $('priceChart').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // --- Periyot matrisi -----------------------------------------------------

  var scanSeq = 0;
  function runScanner(force) {
    var seq = ++scanSeq, box = $('scanner');
    var tfs = Object.keys(TF);
    if (!box.children.length || force) {
      box.innerHTML = tfs.map(function (tf) {
        return '<button type="button" class="cell" data-tf="' + tf + '">' +
          '<span class="cell-tf"><span>' + TF[tf].label + '</span><span class="cell-rsi">RSI —</span></span>' +
          '<span class="cell-sig none">Taranıyor</span><span class="cell-age">&nbsp;</span><span class="cell-pot">&nbsp;</span>' +
          '<span class="cell-bar"><i style="left:50%"></i></span></button>';
      }).join('');
    }
    markActiveScan();
    tfs.forEach(function (tf) {
      getData(tf, state.unit, force).then(function (d) {
        if (seq !== scanSeq) return;
        var res = D.findDivergences(d.candles, state.opts);
        var list = res.divergences.filter(function (x) { return state.show[x.type]; });
        var n = d.candles.length, last = list[list.length - 1], r = res.rsi[n - 1];
        var cell = box.querySelector('[data-tf="' + tf + '"]');
        if (!cell) return;
        var sig = cell.querySelector('.cell-sig'), age = cell.querySelector('.cell-age');
        if (last) {
          var fresh = (n - 1 - last.confirmIndex) <= FRESH_BARS;
          sig.className = 'cell-sig';
          sig.innerHTML = badge(last.type);
          age.innerHTML = ago(n - 1 - last.to.i, tf) + (fresh ? '<span class="fresh">Taze</span>' : '');
        } else {
          sig.className = 'cell-sig none'; sig.textContent = 'Sessiz'; age.textContent = 'Uyumsuzluk yok';
        }
        var pend = D.findPotential(closedOf(d.candles, tf), state.opts, res.rsi).filter(function (x) { return state.show[x.type]; });
        cell.querySelector('.cell-pot').innerHTML = pend.length
          ? pend.map(function (x) { return 'Oluşuyor: <b style="--c:' + TYPES[x.type].color + '">' + TYPES[x.type].label + '</b>'; }).join(' · ')
          : '&nbsp;';
        checkNotify(tf, d.candles);
        cell.querySelector('.cell-rsi').textContent = 'RSI ' + fmtRsi(r);
        var pin = cell.querySelector('.cell-bar i');
        pin.style.left = (r == null ? 50 : r) + '%';
        pin.style.background = r >= 70 ? 'var(--bear)' : r <= 30 ? 'var(--bull)' : '';
      }).catch(function () {
        if (seq !== scanSeq) return;
        var cell = box.querySelector('[data-tf="' + tf + '"]');
        if (!cell) return;
        cell.querySelector('.cell-sig').className = 'cell-sig none';
        cell.querySelector('.cell-sig').textContent = 'Veri yok';
      });
    });
  }
  // --- Tarayıcı bildirimleri (sayfa açıkken) ------------------------------

  var NOTIFY_KEY = 'rc-notify-v1';
  var notify = { on: false, seen: {} };
  try { notify = Object.assign(notify, JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}')); } catch (e) { /* yok say */ }
  var baseline = {};
  function saveNotify() {
    // en fazla 300 anahtar tut
    var keys = Object.keys(notify.seen);
    if (keys.length > 300) keys.sort(function (a, b) { return notify.seen[a] - notify.seen[b]; }).slice(0, keys.length - 300).forEach(function (k) { delete notify.seen[k]; });
    try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(notify)); } catch (e) { /* yok say */ }
  }
  function canNotify() { return 'Notification' in window && Notification.permission === 'granted' && notify.on; }

  // Sunucudaki mantığın aynısı: yalnızca kapanmış mumlar, yeni onaylar ve oluşanlar
  function checkNotify(tf, candles) {
    if (!canNotify() || state.mode !== 'live') return;
    var closed = closedOf(candles, tf);
    var res = D.findDivergences(closed, state.opts), last = closed.length - 1;
    var events = res.divergences.filter(function (x) { return x.confirmIndex >= last - 2; })
      .concat(D.findPotential(closed, state.opts, res.rsi))
      .filter(function (x) { return state.show[x.type]; });
    var key0 = state.unit + ':' + tf + ':';
    var first = !baseline[key0];
    baseline[key0] = true;
    events.forEach(function (x) {
      var key = key0 + x.type + ':' + x.from.time + (x.potential ? ':pot' : ':' + x.to.time);
      if (notify.seen[key]) return;
      notify.seen[key] = Date.now();
      if (first && notify.baselinePending) return; // bildirimi yeni açtıysa mevcut olanları sessizce işaretle
      var t = TYPES[x.type];
      var title = (x.potential ? 'Oluşuyor: ' : '') + t.label + ' uyumsuzluk · Gümüş ' + TF[tf].label;
      var body = 'Fiyat ' + currency() + fmtPrice(x.from.price) + ' → ' + currency() + fmtPrice(x.to.price) +
        ' · RSI ' + fmtRsi(x.from.rsi) + ' → ' + fmtRsi(x.to.rsi) +
        (x.potential ? ' · onaya ' + x.barsLeft + ' mum' : ' · onaylandı');
      try { new Notification(title, { body: body, tag: key, icon: document.querySelector('link[rel=icon]').href }); } catch (e) { /* yok say */ }
    });
    if (notify.baselinePending && Object.keys(baseline).length >= Object.keys(TF).length) notify.baselinePending = false;
    saveNotify();
  }

  function renderNotifyBtn() {
    var b = $('notifyBtn'), note = $('notifyNote');
    if (!('Notification' in window)) {
      b.disabled = true; b.textContent = 'Tarayıcı desteklemiyor';
      note.textContent = 'iPhone’da bildirim için siteyi “Ana Ekrana Ekle” ile açın veya Telegram kanalını kullanın.';
      return;
    }
    var on = canNotify();
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Tarayıcı bildirimi açık ✓' : 'Tarayıcı bildirimi aç';
    note.textContent = Notification.permission === 'denied'
      ? 'Bildirim izni engellenmiş; tarayıcı ayarlarından bu site için izin verin.'
      : on ? 'Bu sekme açık kaldığı sürece yeni uyumsuzluklarda bildirim alırsınız. Sekme kapalıyken de haber almak için Telegram kanalına katılın.' : '';
  }
  $('notifyBtn').addEventListener('click', function () {
    if (canNotify()) { notify.on = false; saveNotify(); renderNotifyBtn(); return; }
    Notification.requestPermission().then(function (p) {
      notify.on = p === 'granted';
      notify.baselinePending = true; baseline = {};
      saveNotify(); renderNotifyBtn();
      if (notify.on) {
        try { new Notification('RC. bildirimleri açık', { body: 'Yeni uyumsuzluk oluştuğunda burada göreceksiniz.' }); } catch (e) { /* yok say */ }
        runScanner(false);
      }
    });
  });

  (function initChannels() {
    var cfg = window.RC_CONFIG || {};
    if (cfg.telegramUrl) { $('tgBtn').href = cfg.telegramUrl; $('tgBtn').hidden = false; }
    if (cfg.discordUrl) { $('dcBtn').href = cfg.discordUrl; $('dcBtn').hidden = false; }
  })();

  function markActiveScan() {
    Array.prototype.forEach.call($('scanner').children, function (el) {
      el.classList.toggle('active', state.mode !== 'csv' && el.getAttribute('data-tf') === state.tf);
    });
  }
  $('scanner').addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (!cell) return;
    selectTf(cell.getAttribute('data-tf'));
    $('grafik').scrollIntoView({ behavior: 'smooth' });
  });
  $('scanBtn').addEventListener('click', function () { runScanner(true); });

  // --- Kontroller ----------------------------------------------------------

  function renderTfSeg() {
    $('tfSeg').innerHTML = Object.keys(TF).map(function (k) {
      return '<button data-tf="' + k + '" class="' + (state.mode !== 'csv' && k === state.tf ? 'on' : '') + '">' + TF[k].label + '</button>';
    }).join('');
  }
  function selectTf(tf) {
    state.tf = tf; state.fitNext = true;
    if (state.mode === 'csv') { state.mode = 'live'; state.csv = null; $('csvFile').value = ''; }
    persist(); renderTfSeg(); markActiveScan(); load();
  }
  $('tfSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tf]');
    if (b) selectTf(b.getAttribute('data-tf'));
  });

  function renderUnitSeg() {
    Array.prototype.forEach.call($('unitSeg').querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-unit') === state.unit);
    });
  }
  $('unitSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-unit]');
    if (!b || b.getAttribute('data-unit') === state.unit) return;
    if (state.mode === 'csv') { notice('CSV modunda birim değiştirilemez; veriler dosyadaki gibi gösterilir.'); return; }
    state.unit = b.getAttribute('data-unit'); state.fitNext = true;
    persist(); renderUnitSeg(); load(); runScanner(true);
  });

  function renderChips() {
    $('typeChips').innerHTML = TYPE_ORDER.map(function (k) {
      var t = TYPES[k];
      return '<button type="button" class="toggle' + (state.show[k] ? '' : ' off') + '" data-type="' + k + '" style="--c:' + t.color + '" title="' + esc(t.desc) + '" aria-pressed="' + !!state.show[k] + '">' +
        '<span class="ln' + (t.hidden ? ' dash' : '') + '"></span>' + t.label + '</button>';
    }).join('');
  }
  $('typeChips').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-type]');
    if (!b) return;
    var k = b.getAttribute('data-type');
    state.show[k] = !state.show[k];
    persist(); renderChips(); analyze(); runScanner(false);
  });

  var optInputs = { optPeriod: 'period', optLeft: 'left', optRight: 'right', optMin: 'minRange', optMax: 'maxRange' };
  function syncOptInputs() { Object.keys(optInputs).forEach(function (id) { $(id).value = state.opts[optInputs[id]]; }); }
  var optTimer = null;
  Object.keys(optInputs).forEach(function (id) {
    $(id).addEventListener('input', function () {
      var v = parseInt(this.value, 10), min = +this.min, max = +this.max;
      if (!isFinite(v)) return;
      state.opts[optInputs[id]] = Math.max(min, Math.min(max, v));
      if (state.opts.minRange > state.opts.maxRange) state.opts.maxRange = state.opts.minRange;
      clearTimeout(optTimer);
      optTimer = setTimeout(function () { persist(); analyze(); runScanner(false); }, 250);
    });
  });
  $('resetBtn').addEventListener('click', function () {
    state.opts = Object.assign({}, D.DEFAULTS); syncOptInputs(); persist(); analyze(); runScanner(false);
  });

  $('csvFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var candles = API.parseCsv(String(reader.result));
        state.mode = 'csv'; state.candles = candles; state.fitNext = true;
        state.source = 'CSV dosyası: ' + f.name;
        ++loadSeq;
        setLive('demo', 'CSV verisi');
        notice('Kendi yüklediğiniz <b>' + esc(f.name) + '</b> dosyası analiz ediliyor. Canlı veriye dönmek için bir zaman dilimi seçin.');
        renderTfSeg(); markActiveScan(); analyze();
      } catch (err) {
        notice('CSV okunamadı: ' + esc(err.message), 'err');
      }
    };
    reader.readAsText(f);
  });

  // --- Rehber -------------------------------------------------------------

  // Basit şema: üstte fiyat, altta RSI; iki pivot arası çizgi
  var SKETCH = {
    bull:  { price: [[10, 30], [45, 55], [70, 40], [105, 70], [130, 50], [170, 78]], pa: [45, 55], pb: [105, 70], rsi: [[10, 102], [45, 128], [70, 106], [105, 116], [130, 102], [170, 96]], ra: [45, 128], rb: [105, 116] },
    bear:  { price: [[10, 80], [45, 40], [70, 60], [105, 25], [130, 50], [170, 32]], pa: [45, 40], pb: [105, 25], rsi: [[10, 132], [45, 96], [70, 116], [105, 106], [130, 120], [170, 124]], ra: [45, 96], rb: [105, 106] },
    hbull: { price: [[10, 40], [45, 70], [70, 45], [105, 60], [130, 35], [170, 24]], pa: [45, 70], pb: [105, 60], rsi: [[10, 102], [45, 116], [70, 100], [105, 130], [130, 106], [170, 98]], ra: [45, 116], rb: [105, 130] },
    hbear: { price: [[10, 60], [45, 30], [70, 55], [105, 42], [130, 66], [170, 76]], pa: [45, 30], pb: [105, 42], rsi: [[10, 126], [45, 110], [70, 122], [105, 96], [130, 116], [170, 126]], ra: [45, 110], rb: [105, 96] }
  };
  var TAGS = { bull: 'Dönüş — yükseliş', bear: 'Dönüş — düşüş', hbull: 'Devam — yükseliş', hbear: 'Devam — düşüş' };
  var ROMAN = ['I', 'II', 'III', 'IV'];
  function sketch(k) {
    var s = SKETCH[k], c = TYPES[k].color, dash = TYPES[k].hidden ? ' stroke-dasharray="5 4"' : '';
    function pl(pts) { return pts.map(function (p) { return p.join(','); }).join(' '); }
    return '<svg viewBox="0 0 180 142" role="img" aria-label="' + TYPES[k].label + ' uyumsuzluk şeması">' +
      '<text x="0" y="10" fill="rgba(233,232,228,.4)" font-size="8" font-family="JetBrains Mono, monospace" letter-spacing="1.5">FİYAT</text>' +
      '<text x="0" y="93" fill="rgba(233,232,228,.4)" font-size="8" font-family="JetBrains Mono, monospace" letter-spacing="1.5">RSI</text>' +
      '<line x1="0" y1="84" x2="180" y2="84" stroke="rgba(233,232,228,.12)"/>' +
      '<polyline points="' + pl(s.price) + '" fill="none" stroke="rgba(233,232,228,.8)" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<polyline points="' + pl(s.rsi) + '" fill="none" stroke="rgba(233,232,228,.5)" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<line x1="' + s.pa[0] + '" y1="' + s.pa[1] + '" x2="' + s.pb[0] + '" y2="' + s.pb[1] + '" stroke="' + c + '" stroke-width="2"' + dash + '/>' +
      '<line x1="' + s.ra[0] + '" y1="' + s.ra[1] + '" x2="' + s.rb[0] + '" y2="' + s.rb[1] + '" stroke="' + c + '" stroke-width="2"' + dash + '/>' +
      [s.pa, s.pb, s.ra, s.rb].map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="#0b0b0c" stroke="' + c + '" stroke-width="1.5"/>'; }).join('') +
      '</svg>';
  }
  $('learnCards').innerHTML = TYPE_ORDER.map(function (k, idx) {
    var t = TYPES[k];
    return '<article class="g' + (t.hidden ? ' dash' : '') + '" style="--c:' + t.color + '">' +
      '<span class="g-roman">' + ROMAN[idx] + '.</span><h3>' + t.label + '</h3><span class="tag">' + TAGS[k] + '</span>' +
      '<p>' + t.desc.replace(/ — (.)/, function (m, c) { return '. ' + c.toLocaleUpperCase('tr-TR'); }) + '.</p>' + sketch(k) + '</article>';
  }).join('');

  // --- Başlat --------------------------------------------------------------

  $('yr').textContent = new Date().getFullYear();
  syncOptInputs(); renderTfSeg(); renderUnitSeg(); renderChips(); renderNotifyBtn();
  load().then(function () { runScanner(false); });

  setInterval(function () { if (state.mode !== 'csv' && !document.hidden) load(); }, REFRESH_MS);
  setInterval(function () { if (!document.hidden) runScanner(false); }, SCAN_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.mode !== 'csv') load(); });
})();
