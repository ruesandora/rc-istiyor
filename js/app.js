/* RC — Gümüş RSI Uyumsuzluk: arayüz */
(function () {
  'use strict';

  var D = window.RCDiv, API = window.RCData, LWC = window.LightweightCharts;
  var TYPES = D.TYPES, TF = API.TIMEFRAMES;
  var TYPE_ORDER = ['bull', 'bear', 'hbull', 'hbear'];
  var TZ_SHIFT = 3 * 3600;          // Türkiye saati (UTC+3) grafikte gösterim için
  var FRESH_BARS = 10;
  var REFRESH_MS = 60 * 1000, SCAN_MS = 5 * 60 * 1000, CACHE_MS = 45 * 1000;

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
  function badge(type) { var t = TYPES[type]; return '<span class="badge" style="--c:' + t.color + '">' + t.label + '</span>'; }

  // --- Grafikler ------------------------------------------------------------

  var chartOpts = {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8b97a8', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
    grid: { vertLines: { color: '#1a2230' }, horzLines: { color: '#1a2230' } },
    rightPriceScale: { borderColor: '#222c3a', minimumWidth: 72 },
    timeScale: { borderColor: '#222c3a', timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: 0, vertLine: { color: '#5b6b82', labelBackgroundColor: '#2a3547' }, horzLine: { color: '#5b6b82', labelBackgroundColor: '#2a3547' } },
    localization: { locale: 'tr-TR', priceFormatter: function (v) { return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } }
  };

  var priceChart = LWC.createChart($('priceChart'), chartOpts);
  var rsiChart = LWC.createChart($('rsiChart'), Object.assign({}, chartOpts, {
    rightPriceScale: { borderColor: '#222c3a', minimumWidth: 72, scaleMargins: { top: 0.08, bottom: 0.08 } }
  }));

  var candleSeries = priceChart.addCandlestickSeries({
    upColor: '#d6dbe2', downColor: '#5b6677', borderVisible: false,
    wickUpColor: '#d6dbe2', wickDownColor: '#5b6677'
  });
  var rsiSeries = rsiChart.addLineSeries({ color: '#c0c7d1', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 });
  rsiSeries.applyOptions({ autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; } });
  [[70, '#ef444488'], [50, '#8b97a855'], [30, '#22c55e88']].forEach(function (l) {
    rsiSeries.createPriceLine({ price: l[0], color: l[1], lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
  });

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
        $('rsiHover').textContent = fmtDate(row.c.time, state.tf) + '  ·  RSI ' + fmtRsi(row.r) + '  ·  K ' + fmtPrice(row.c.close);
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
  function addLine(chart, type, a, b) {
    var t = TYPES[type];
    var s = chart.addLineSeries({
      color: t.color, lineWidth: 2, lineStyle: t.hidden ? 2 : 0,
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
        '<button class="btn small" id="retryBtn" type="button">Tekrar dene</button>' +
        '<br><small style="opacity:.75">' + esc(e && e.message ? e.message : e) + '</small>', 'err');
      var rb = $('retryBtn'); if (rb) rb.onclick = function () { state.fitNext = true; load(true); runScanner(true); };
      analyze();
    });
  }

  // --- Analiz ve çizim -----------------------------------------------------

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
    markers.sort(function (a, b) { return a.time - b.time; });
    candleSeries.setMarkers(markers);

    if (state.fitNext) {
      state.fitNext = false;
      var from = Math.max(0, n - 180);
      priceChart.timeScale().setVisibleLogicalRange({ from: from, to: n + 6 });
    }

    // Özet
    var last = candles[n - 1], prev = candles[n - 2] || last;
    $('unitLabel').textContent = state.unit === 'try' ? 'gram / ₺' : 'XAG/USD (ons)';
    $('price').textContent = currency() + ' ' + fmtPrice(last.close);
    var ch = (last.close - prev.close) / prev.close * 100;
    $('change').innerHTML = '<span class="' + (ch >= 0 ? 'up' : 'down') + '">' + (ch >= 0 ? '▲ ' : '▼ ') +
      Math.abs(ch).toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + '%</span> son mum';
    var r = res.rsi[n - 1];
    $('rsiNow').textContent = fmtRsi(r);
    $('rsiNow').style.color = r >= 70 ? 'var(--bear)' : r <= 30 ? 'var(--bull)' : '';
    $('rsiZone').textContent = r == null ? '' : r >= 70 ? 'Aşırı alım bölgesi' : r <= 30 ? 'Aşırı satım bölgesi' : r >= 50 ? 'Nötr · alıcılar önde' : 'Nötr · satıcılar önde';
    $('rsiPeriodLabel').textContent = state.opts.period;
    $('tfLabel').textContent = state.mode === 'csv' ? 'CSV' : TF[state.tf].label;

    var lastDiv = visible[visible.length - 1];
    if (lastDiv) {
      $('lastSig').innerHTML = badge(lastDiv.type);
      $('lastSigAge').textContent = fmtDate(lastDiv.to.time, state.tf) + ' · ' + ago(n - 1 - lastDiv.to.i, state.mode === 'csv' ? null : state.tf);
    } else {
      $('lastSig').textContent = 'Yok';
      $('lastSigAge').textContent = 'Seçili türlerde uyumsuzluk bulunamadı';
    }

    $('source').textContent = 'Kaynak: ' + state.source + ' · ' + n + ' mum · Saatler Türkiye saatidir (UTC+3). Uyumsuzluk, pivotun sağında ' + state.opts.right + ' mum oluştuktan sonra onaylanır.';
    renderTable(visible, n);
    renderLegend();
  }

  function renderTable(list, n) {
    var body = $('sigBody');
    $('sigCount').textContent = list.length ? list.length + ' adet' : '';
    if (!list.length) { body.innerHTML = '<tr><td colspan="5" class="empty">Uyumsuzluk bulunamadı.</td></tr>'; return; }
    var tf = state.mode === 'csv' ? null : state.tf;
    body.innerHTML = list.slice().reverse().map(function (x, k) {
      var cur = currency();
      return '<tr data-i="' + x.to.i + '">' +
        '<td>' + badge(x.type) + '</td>' +
        '<td class="mono">' + fmtDate(x.to.time, state.tf) + '</td>' +
        '<td class="mono">' + cur + fmtPrice(x.from.price) + ' → ' + cur + fmtPrice(x.to.price) + '</td>' +
        '<td class="mono">' + fmtRsi(x.from.rsi) + ' → ' + fmtRsi(x.to.rsi) + '</td>' +
        '<td title="' + (n - 1 - x.to.i) + ' mum önce">' + (tf ? humanDur((n - 1 - x.to.i) * TF[tf].seconds) + ' önce' : (n - 1 - x.to.i) + ' mum önce') + '</td></tr>';
    }).join('');
  }

  $('sigBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    var i = +tr.getAttribute('data-i');
    priceChart.timeScale().setVisibleLogicalRange({ from: i - 70, to: i + 30 });
    $('priceChart').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function renderLegend() {
    $('legend').innerHTML = TYPE_ORDER.filter(function (k) { return state.show[k]; }).map(function (k) {
      var t = TYPES[k];
      return '<span><i class="' + (t.hidden ? 'dash' : '') + '" style="--c:' + t.color + '"></i>' + t.label + ' (' + t.short + ')</span>';
    }).join('');
  }

  // --- Çoklu zaman dilimi tarayıcı ----------------------------------------

  var scanSeq = 0;
  function runScanner(force) {
    var seq = ++scanSeq, box = $('scanner');
    var tfs = Object.keys(TF);
    if (!box.children.length || force) {
      box.innerHTML = tfs.map(function (tf) {
        return '<div class="scan-row" data-tf="' + tf + '"><span class="scan-tf">' + TF[tf].label + '</span><span class="scan-sig"><small>Taranıyor…</small></span><span class="scan-rsi"></span></div>';
      }).join('');
    }
    markActiveScan();
    tfs.forEach(function (tf) {
      getData(tf, state.unit, force).then(function (d) {
        if (seq !== scanSeq) return;
        var res = D.findDivergences(d.candles, state.opts);
        var list = res.divergences.filter(function (x) { return state.show[x.type]; });
        var n = d.candles.length, last = list[list.length - 1], r = res.rsi[n - 1];
        var row = box.querySelector('[data-tf="' + tf + '"]');
        if (!row) return;
        var sig = row.querySelector('.scan-sig');
        if (last) {
          var bars = n - 1 - last.to.i;
          var fresh = (n - 1 - last.confirmIndex) <= FRESH_BARS;
          sig.innerHTML = '<span>' + badge(last.type) + (fresh ? '<span class="fresh">Taze</span>' : '') + '</span><small>' + ago(bars, tf) + '</small>';
        } else {
          sig.innerHTML = '<span style="color:var(--muted)">Uyumsuzluk yok</span>';
        }
        row.querySelector('.scan-rsi').innerHTML = 'RSI <b class="mono" style="color:' + (r >= 70 ? 'var(--bear)' : r <= 30 ? 'var(--bull)' : 'var(--text)') + '">' + fmtRsi(r) + '</b>';
      }).catch(function () {
        if (seq !== scanSeq) return;
        var row = box.querySelector('[data-tf="' + tf + '"]');
        if (row) row.querySelector('.scan-sig').innerHTML = '<small>Veri alınamadı</small>';
      });
    });
  }
  function markActiveScan() {
    Array.prototype.forEach.call($('scanner').children, function (el) {
      el.classList.toggle('active', state.mode !== 'csv' && el.getAttribute('data-tf') === state.tf);
    });
  }
  $('scanner').addEventListener('click', function (e) {
    var row = e.target.closest('.scan-row');
    if (row) selectTf(row.getAttribute('data-tf'));
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
      return '<button class="chip' + (state.show[k] ? '' : ' off') + '" data-type="' + k + '" style="--c:' + t.color + '" title="' + esc(t.desc) + '"><span class="sw"></span>' + t.label + '</button>';
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

  // --- Eğitim kartları -----------------------------------------------------

  // Basit şema: üstte fiyat, altta RSI; iki pivot arası çizgi
  var SKETCH = {
    bull:  { price: [[20, 30], [45, 55], [70, 40], [95, 70], [120, 50], [150, 80]], pa: [45, 55], pb: [95, 70], rsi: [[20, 100], [45, 125], [70, 105], [95, 115], [120, 100], [150, 95]], ra: [45, 125], rb: [95, 115] },
    bear:  { price: [[20, 80], [45, 40], [70, 60], [95, 25], [120, 50], [150, 30]], pa: [45, 40], pb: [95, 25], rsi: [[20, 130], [45, 95], [70, 115], [95, 105], [120, 118], [150, 122]], ra: [45, 95], rb: [95, 105] },
    hbull: { price: [[20, 40], [45, 70], [70, 45], [95, 60], [120, 35], [150, 25]], pa: [45, 70], pb: [95, 60], rsi: [[20, 100], [45, 115], [70, 100], [95, 128], [120, 105], [150, 98]], ra: [45, 115], rb: [95, 128] },
    hbear: { price: [[20, 60], [45, 30], [70, 55], [95, 42], [120, 65], [150, 75]], pa: [45, 30], pb: [95, 42], rsi: [[20, 125], [45, 110], [70, 122], [95, 96], [120, 115], [150, 125]], ra: [45, 110], rb: [95, 96] }
  };
  var TAGS = { bull: 'Dönüş · Yükseliş', bear: 'Dönüş · Düşüş', hbull: 'Trend devamı · Yükseliş', hbear: 'Trend devamı · Düşüş' };
  function sketch(k) {
    var s = SKETCH[k], c = TYPES[k].color, dash = TYPES[k].hidden ? ' stroke-dasharray="5 4"' : '';
    function pl(pts) { return pts.map(function (p) { return p.join(','); }).join(' '); }
    return '<svg viewBox="0 0 170 140" role="img" aria-label="' + TYPES[k].label + ' uyumsuzluk şeması">' +
      '<text x="6" y="14" fill="#8b97a8" font-size="9">Fiyat</text><text x="6" y="92" fill="#8b97a8" font-size="9">RSI</text>' +
      '<line x1="0" y1="84" x2="170" y2="84" stroke="#222c3a"/>' +
      '<polyline points="' + pl(s.price) + '" fill="none" stroke="#c0c7d1" stroke-width="1.6"/>' +
      '<polyline points="' + pl(s.rsi) + '" fill="none" stroke="#8e99a8" stroke-width="1.4"/>' +
      '<line x1="' + s.pa[0] + '" y1="' + s.pa[1] + '" x2="' + s.pb[0] + '" y2="' + s.pb[1] + '" stroke="' + c + '" stroke-width="2.4"' + dash + '/>' +
      '<line x1="' + s.ra[0] + '" y1="' + s.ra[1] + '" x2="' + s.rb[0] + '" y2="' + s.rb[1] + '" stroke="' + c + '" stroke-width="2.4"' + dash + '/>' +
      [s.pa, s.pb, s.ra, s.rb].map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="' + c + '"/>'; }).join('') +
      '</svg>';
  }
  $('learnCards').innerHTML = TYPE_ORDER.map(function (k) {
    var t = TYPES[k];
    return '<div class="card" style="--c:' + t.color + '"><span class="tag">' + TAGS[k] + '</span><h3>' + t.label + ' uyumsuzluk</h3>' +
      '<p>' + t.desc.replace(/ — (.)/, function (m, c) { return '.<br>' + c.toLocaleUpperCase('tr-TR'); }) + '.</p>' + sketch(k) + '</div>';
  }).join('');

  // --- Başlat --------------------------------------------------------------

  $('yr').textContent = new Date().getFullYear();
  syncOptInputs(); renderTfSeg(); renderUnitSeg(); renderChips(); renderLegend();
  load().then(function () { runScanner(false); });

  setInterval(function () { if (state.mode !== 'csv' && !document.hidden) load(); }, REFRESH_MS);
  setInterval(function () { if (!document.hidden) runScanner(false); }, SCAN_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.mode !== 'csv') load(); });
})();
