// Çalıştır: node tests/divergence.test.js
'use strict';
const assert = require('assert');
const D = require('../js/divergence.js');
const API = require('../js/data.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }

// Kapanışlar üzerinden yapay mum dizisi üret (high/low kapanışa yakın)
function candles(closes) {
  return closes.map((c, i) => ({ time: 1700000000 + i * 3600, open: c, high: c + 0.05, low: c - 0.05, close: c }));
}
function lin(a, b, n) { return Array.from({ length: n }, (_, i) => a + (b - a) * (i + 1) / n); }
// Yatay, dalgalı hazırlık bölgesi (RSI ≈ 50 civarı)
function side(c, n) { return Array.from({ length: n }, (_, i) => c + (i % 2 ? 0.6 : -0.6)); }

test('RSI: sürekli artışta 100, sürekli düşüşte 0', () => {
  const up = D.rsi(lin(1, 50, 40), 14);
  const down = D.rsi(lin(50, 1, 40), 14);
  assert.strictEqual(up[13], null);
  assert.strictEqual(up[39], 100);
  assert.ok(down[39] < 0.0001);
});

test('RSI: bilinen örnekle (Wilder) eşleşir', () => {
  // Wilder örneği — 14 periyot ilk RSI ≈ 70.46
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const r = D.rsi(c, 14);
  assert.ok(Math.abs(r[14] - 70.46) < 0.1, 'RSI=' + r[14]);
});

test('Pivotlar: dip ve tepe', () => {
  const v = [5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3];
  assert.deepStrictEqual(D.pivots(v, 3, 3, 'low'), [4]);
  assert.deepStrictEqual(D.pivots(v, 3, 2, 'high'), [8]);
});

// Senaryo kurucusu: düşüş → dip A → tepki → dip B → toparlanma
function twoLows(depthA, depthB, bounce) {
  const closes = [];
  closes.push(...side(34, 24));             // hazırlık
  closes.push(...lin(34, depthA, 8));       // sert düşüş → dip A
  closes.push(...lin(depthA, bounce, 10));  // güçlü tepki
  closes.push(...lin(bounce, depthB, 6));   // zayıf son düşüş → dip B
  closes.push(...lin(depthB, depthB + 4, 12));
  return closes;
}
function twoHighs(peakA, peakB, pull) {
  const closes = [];
  closes.push(...side(26, 24));
  closes.push(...lin(26, peakA, 8));
  closes.push(...lin(peakA, pull, 10));
  closes.push(...lin(pull, peakB, 6));
  closes.push(...lin(peakB, peakB - 4, 12));
  return closes;
}
function types(closes) { return D.findDivergences(candles(closes)).divergences.map(d => d.type); }

test('Pozitif (normal yükseliş): fiyat LL, RSI HL', () => {
  const t = types(twoLows(26, 25.5, 33));
  assert.ok(t.includes('bull'), t.join(','));
  assert.ok(!t.includes('hbull'));
});

test('Gizli pozitif: fiyat HL, RSI LL', () => {
  // A: yavaş düşüşle sığ dip, B: sert düşüşle daha yüksek dip
  const closes = [];
  closes.push(...side(30, 24));
  closes.push(...lin(30, 28, 4));    // kısa düşüş → dip A (RSI çok düşmez)
  closes.push(...lin(28, 36, 12));   // güçlü yükseliş
  closes.push(...lin(36, 29, 8));    // derin geri çekilme → dip B (fiyat A'dan yüksek, RSI daha düşük)
  closes.push(...lin(29, 34, 12));
  const t = types(closes);
  assert.ok(t.includes('hbull'), t.join(','));
});

test('Negatif (normal düşüş): fiyat HH, RSI LH', () => {
  const t = types(twoHighs(34, 34.5, 27));
  assert.ok(t.includes('bear'), t.join(','));
});

test('Gizli negatif: fiyat LH, RSI HH', () => {
  const closes = [];
  closes.push(...side(36, 24));
  closes.push(...lin(36, 38, 4));    // kısa yükseliş → tepe A
  closes.push(...lin(38, 30, 12));   // güçlü düşüş
  closes.push(...lin(30, 37, 8));    // sert tepki → tepe B (A'dan düşük, RSI daha yüksek)
  closes.push(...lin(37, 32, 12));
  const t = types(closes);
  assert.ok(t.includes('hbear'), t.join(','));
});

test('Aralık filtresi: maxRange dışındaki pivotlar eşleşmez', () => {
  const c = candles(twoLows(26, 25.5, 33));
  const all = D.findDivergences(c).divergences.filter(d => d.type === 'bull');
  assert.ok(all.length > 0);
  const none = D.findDivergences(c, { maxRange: 5 }).divergences.filter(d => d.type === 'bull');
  assert.strictEqual(none.length, 0);
});

test('Sonuçlar zaman sıralı ve alanlar tutarlı', () => {
  const r = D.findDivergences(candles(API.demo('1h')));
  for (let i = 1; i < r.divergences.length; i++) assert.ok(r.divergences[i].to.i >= r.divergences[i - 1].to.i);
  r.divergences.forEach(d => {
    assert.ok(d.to.i > d.from.i);
    assert.ok(d.confirmIndex >= d.to.i);
    assert.ok(D.TYPES[d.type]);
  });
});

test('CSV: virgül ayraçlı İngilizce başlık', () => {
  const rows = ['Date,Open,High,Low,Close'];
  for (let i = 0; i < 40; i++) rows.push(`2025-01-${String((i % 28) + 1).padStart(2, '0')}T${String(Math.floor(i / 28)).padStart(2, '0')}:00:00Z,30,31,29,${30 + i / 10}`);
  const c = API.parseCsv(rows.join('\n'));
  assert.strictEqual(c.length, 40);
  assert.ok(c[0].time < c[1].time);
});

test('CSV: noktalı virgül + Türkçe başlık + ondalık virgül', () => {
  const rows = ['Tarih;Şimdi;Açılış;Yüksek;Düşük'];
  for (let i = 1; i <= 31; i++) rows.push(`${String(i).padStart(2, '0')}.03.2025;1.234,${10 + i};1.230,00;1.240,50;1.220,25`);
  const c = API.parseCsv(rows.join('\n'));
  assert.strictEqual(c.length, 31);
  assert.ok(Math.abs(c[0].close - 1234.11) < 1e-9);
  assert.strictEqual(c[0].high, 1240.5);
});

console.log(`\n${passed} test geçti.`);
