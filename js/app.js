/* RC — Gümüş RSI Uyumsuzluk: arayüz */
(function () {
  'use strict';

  var D = window.RCDiv, API = window.RCData, CFG = window.RC_CONFIG || {};
  var TYPES = D.TYPES, TF = API.TIMEFRAMES;
  var ORDER = ['1d', '4h', '1h', '1w'];        // Günlük önce
  var FRESH_BARS = 10;                          // "yeni onaylandı" sayılacak süre (mum)
  var REFRESH_MS = 2 * 60 * 1000;
  var COLORS = { bull: 'var(--bull)', bear: 'var(--bear)', hbull: 'var(--hbull)', hbear: 'var(--hbear)' };
  var SHAPE = {
    bull: ['daha düşük dip', 'daha yüksek dip'],
    bear: ['daha yüksek tepe', 'daha düşük tepe'],
    hbull: ['daha yüksek dip', 'daha düşük dip'],
    hbear: ['daha düşük tepe', 'daha yüksek tepe']
  };

  var $ = function (id) { return document.getElementById(id); };
  var results = {};           // tf -> { candles, closed, divs, pending, rsi }
  var selected = '1d';

  // --- Biçim -----------------------------------------------------------------

  function money(v) { return '$' + v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num1(v) { return v == null ? '—' : v.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
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
  function label(type) { return TYPES[type].label.replace('Gizli Pozitif', 'Gizli pozitif').replace('Gizli Negatif', 'Gizli negatif'); }
  function typeHtml(type) { return '<span class="type" style="--c:' + COLORS[type] + '">' + label(type) + '</span>'; }
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
  function stateOf(r) {
    if (r.pending.length) return { kind: 'pot', ev: r.pending[r.pending.length - 1] };
    var last = r.divs[r.divs.length - 1];
    if (last && r.closed.length - 1 - last.confirmIndex <= FRESH_BARS) return { kind: 'new', ev: last };
    return { kind: 'none', ev: last };
  }

  function loadAll() {
    return Promise.all(ORDER.map(function (tf) {
      return API.loadSilver(tf).then(function (d) { results[tf] = analyze(tf, d); }, function (e) { results[tf] = { error: e.message }; });
    })).then(render);
  }

  // --- Çizim -----------------------------------------------------------------

  function card(tf) {
    var r = results[tf], main = tf === '1d';
    var cls = 'card' + (main ? ' main' : '') + (tf === selected ? ' sel' : '');
    if (!r) return '<button class="' + cls + ' skeleton" data-tf="' + tf + '"><div class="card-top"><span class="tf">' + TF[tf].label + '</span></div><span class="head">Yükleniyor…</span></button>';
    if (r.error) return '<button class="' + cls + ' none" data-tf="' + tf + '"><div class="card-top"><span class="tf">' + TF[tf].label + '</span></div><span class="head">Veri alınamadı</span><p class="detail">Birazdan tekrar denenecek.</p></button>';

    var st = stateOf(r), e = st.ev;
    var top = '<div class="card-top"><span class="tf">' + TF[tf].label + '</span><span class="rsi">RSI <b>' + num1(r.rsi) + '</b></span></div>';
    if (st.kind === 'none') {
      return '<button class="' + cls + ' none" data-tf="' + tf + '">' + top +
        '<span class="head">Uyumsuzluk yok</span>' +
        '<p class="detail">' + (e ? 'Son: ' + label(e.type) + ' · ' + date(e.to.time, tf) : 'Bu periyotta henüz uyumsuzluk bulunmadı.') + '</p></button>';
    }
    var t = e.type;
    var head = label(t) + (st.kind === 'pot' ? ' oluşuyor' : ' uyumsuzluk');
    var pill = st.kind === 'pot' ? '<span class="pill pot">Oluşuyor · onaya ' + e.barsLeft + ' mum</span>' : '<span class="pill new">Onaylandı · ' + ago(r.closed.length - 1 - e.confirmIndex, tf) + '</span>';
    return '<button class="' + cls + '" style="--c:' + COLORS[t] + '" data-tf="' + tf + '">' + top + pill +
      '<span class="head">' + head + '</span>' +
      '<div class="detail"><div>Fiyat ' + pair(e.from.price, e.to.price, money) + ' · ' + SHAPE[t][0] + '</div>' +
      '<div>RSI ' + pair(e.from.rsi, e.to.rsi, num1) + ' · ' + SHAPE[t][1] + '</div></div></button>';
  }

  function render() {
    $('status').innerHTML = ORDER.map(card).join('');

    var d = results['1d'];
    if (d && !d.error) {
      var c = d.candles, last = c[c.length - 1], prev = c[c.length - 2];
      var ch = (last.close - prev.close) / prev.close * 100;
      $('price').textContent = money(last.close);
      $('change').innerHTML = '<span class="' + (ch >= 0 ? 'up' : 'down') + '">' + (ch >= 0 ? '+' : '') + ch.toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + '%</span>';
    }
    var ok = ORDER.some(function (tf) { return results[tf] && !results[tf].error; });
    $('updated').textContent = ok
      ? 'Son güncelleme ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) + ' · her 2 dakikada yenilenir'
      : 'Veriye şu an ulaşılamıyor, birazdan tekrar denenecek.';
    renderList();
    notifyCheck();
  }

  function renderList() {
    var r = results[selected];
    $('listTf').textContent = TF[selected].label;
    if (!r || r.error) { $('rows').innerHTML = '<tr><td colspan="4" class="empty">' + (r ? 'Veri alınamadı.' : 'Yükleniyor…') + '</td></tr>'; return; }
    var items = r.pending.concat(r.divs.slice(-8).reverse());
    if (!items.length) { $('rows').innerHTML = '<tr><td colspan="4" class="empty">Uyumsuzluk bulunamadı.</td></tr>'; return; }
    $('rows').innerHTML = items.map(function (e) {
      return '<tr><td>' + typeHtml(e.type) + (e.potential ? '<span class="tag">Oluşuyor</span>' : '') + '</td>' +
        '<td>' + date(e.to.time, selected) + '</td>' +
        '<td>' + pair(e.from.price, e.to.price, money) + '</td>' +
        '<td>' + pair(e.from.rsi, e.to.rsi, num1) + '</td></tr>';
    }).join('');
  }

  // --- TradingView grafiği ---------------------------------------------------

  var tvLoading = null;
  function loadTv() {
    if (window.TradingView) return Promise.resolve();
    if (!tvLoading) tvLoading = new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = 'https://s3.tradingview.com/tv.js';
      s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    });
    return tvLoading;
  }
  function drawChart() {
    var sym = CFG.tvSymbol || 'BINANCE:XAGUSDT.P';
    $('tvSym').textContent = sym;
    $('chartTf').textContent = TF[selected].label;
    loadTv().then(function () {
      $('tv').innerHTML = '';
      new window.TradingView.widget({
        container_id: 'tv', autosize: true, symbol: sym, interval: TF[selected].tv,
        timezone: 'Europe/Istanbul', theme: 'dark', style: '1', locale: 'tr',
        studies: ['RSI@tv-basicstudies'], hide_side_toolbar: true, allow_symbol_change: false,
        save_image: false, backgroundColor: '#151517'
      });
    }).catch(function () { $('tv').innerHTML = '<p class="note" style="padding:20px">TradingView grafiği yüklenemedi.</p>'; });
  }

  function renderTabs() {
    $('tabs').innerHTML = ORDER.map(function (tf) {
      return '<button data-tf="' + tf + '" class="' + (tf === selected ? 'on' : '') + '">' + TF[tf].label + '</button>';
    }).join('');
  }

  function select(tf) {
    if (!TF[tf] || tf === selected) return;
    selected = tf;
    renderTabs(); drawChart(); renderList();
    $('status').innerHTML = ORDER.map(card).join('');
  }
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tf]'); if (b) select(b.getAttribute('data-tf')); });
  $('status').addEventListener('click', function (e) { var b = e.target.closest('[data-tf]'); if (b) select(b.getAttribute('data-tf')); });

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
        var k = tf + ':' + e.type + ':' + e.from.time + (e.potential ? ':pot' : ':' + e.to.time);
        if (note.seen[k]) return;
        note.seen[k] = Date.now();
        if (!primed && note.fresh) return; // bildirim yeni açıldıysa mevcutları sessizce işaretle
        try {
          new Notification('Gümüş ' + TF[tf].label + ': ' + label(e.type) + (e.potential ? ' oluşuyor' : ' onaylandı'), {
            body: 'Fiyat ' + money(e.from.price) + ' → ' + money(e.to.price) + ' · RSI ' + num1(e.from.rsi) + ' → ' + num1(e.to.rsi), tag: k
          });
        } catch (err) { /* yok say */ }
      });
    });
    primed = true; note.fresh = false; save();
  }

  function renderNotify() {
    var b = $('notifyBtn'), n = $('notifyNote');
    if (!('Notification' in window)) { b.disabled = true; n.textContent = 'Bu tarayıcı bildirim desteklemiyor. iPhone’da siteyi “Ana Ekrana Ekle” ile açın veya Telegram kanalını kullanın.'; return; }
    var on = allowed();
    b.classList.toggle('on', on);
    b.textContent = on ? 'Tarayıcı bildirimi açık ✓' : 'Tarayıcı bildirimi aç';
    n.textContent = Notification.permission === 'denied' ? 'Bildirim izni engelli; tarayıcı ayarlarından izin verin.'
      : on ? 'Bu sekme açıkken bildirim gelir. Sekme kapalıyken de haber almak için Telegram kanalına katılın.' : '';
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
  $('yr').textContent = new Date().getFullYear();
  renderTabs(); renderNotify(); drawChart();
  $('status').innerHTML = ORDER.map(card).join('');
  loadAll();
  setInterval(function () { if (!document.hidden) loadAll(); }, REFRESH_MS);
})();
