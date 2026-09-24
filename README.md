# RC · Gümüş RSI Uyumsuzluk

**Rues Community (RC)** gümüş yatırımcıları için RSI uyumsuzluk (divergence) tarayıcısı.

| Tür | Anlamı |
|---|---|
| 🟢 **Pozitif** | Fiyat daha düşük dip, RSI daha yüksek dip → olası yükseliş dönüşü |
| 🔴 **Negatif** | Fiyat daha yüksek tepe, RSI daha düşük tepe → olası düşüş dönüşü |
| 🔵 **Gizli Pozitif** | Fiyat daha yüksek dip, RSI daha düşük dip → yükseliş trendi devamı |
| 🟠 **Gizli Negatif** | Fiyat daha düşük tepe, RSI daha yüksek tepe → düşüş trendi devamı |

## Özellikler
- Canlı XAG/USD mum verisi (anahtar gerekmez): sırayla Binance Futures `XAGUSDT`, Bybit, OKX denenir
- Ons ($) veya **Gram (₺)** görünüm (USDT/TRY kuruyla yaklaşık hesap)
- 15 dk · 1 saat · 4 saat · Günlük · Haftalık
- Fiyat ve RSI grafiğinde uyumsuzluk çizgileri ve işaretleri (normal = düz, gizli = kesikli çizgi)
- Tüm zaman dilimlerindeki son uyumsuzluğu gösteren **çoklu zaman dilimi tarayıcı**
- Ayarlanabilir RSI periyodu, pivot sol/sağ ve pivotlar arası min./maks. mum aralığı
- Kendi verin için CSV yükleme (`date, open, high, low, close` veya Türkçe başlıklar)
- Veriye ulaşılamazsa açıkça işaretlenmiş demo veri
- Mobil uyumlu, 60 sn’de bir otomatik yenileme

Tespit mantığı TradingView’in “RSI Divergence Indicator” yaklaşımıyla aynıdır: RSI üzerinde pivot dip/tepe bulunur (varsayılan 5 sol / 5 sağ mum), ardışık iki pivotta fiyat ile RSI karşılaştırılır.

## Çalıştırma
Derleme adımı yoktur, statik bir sitedir:

```bash
python3 -m http.server 8080   # sonra http://localhost:8080
node tests/divergence.test.js # motor testleri
```

## Yayınlama (GitHub Pages)
`main` dalına push edildiğinde `.github/workflows/pages.yml` siteyi yayınlar.
Repo ayarlarında **Settings → Pages → Source: GitHub Actions** seçilmelidir.

## Dosyalar
- `js/divergence.js`: RSI (Wilder), pivot ve uyumsuzluk motoru
- `js/data.js`: veri kaynakları, gram/₺ dönüşümü, CSV okuyucu, demo veri
- `js/app.js`: arayüz ve grafikler ([Lightweight Charts](https://github.com/tradingview/lightweight-charts))

> ⚠️ Yatırım tavsiyesi değildir. Yalnızca eğitim ve bilgilendirme amaçlıdır.
