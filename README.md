# RC. · Gümüş RSI Uyumsuzluk

**Rues Community (RC)** gümüş yatırımcıları için RSI uyumsuzluk (divergence) tarayıcısı ve bildirim botu.

| Tür | Anlamı |
|---|---|
| 🟢 **Pozitif** | Fiyat daha düşük dip, RSI daha yüksek dip → olası yükseliş dönüşü |
| 🔴 **Negatif** | Fiyat daha yüksek tepe, RSI daha düşük tepe → olası düşüş dönüşü |
| 🔵 **Gizli Pozitif** | Fiyat daha yüksek dip, RSI daha düşük dip → yükseliş trendi devamı |
| 🟠 **Gizli Negatif** | Fiyat daha düşük tepe, RSI daha yüksek tepe → düşüş trendi devamı |

İki aşamada bildirim gider:

- **⏳ Oluşuyor:** İkinci dip/tepe oluştu ama henüz onaylanmadı (pivotun sağında 5 mum tamamlanmadı). Fiyat yeni dip/tepe yaparsa iptal olabilir.
- **✅ Onaylandı:** Pivot onaylandı, uyumsuzluk kesinleşti.

## Nasıl çalışır

```
GitHub Actions (her 10 dk) ──► Vercel /api/check (Frankfurt)
                                  │  Twelve Data (spot XAG/USD) veya Binance'ten mumları çeker, 5 dk saklar
                                  │  RSI + uyumsuzluk hesaplar (js/divergence.js)
                                  │  Daha önce gönderildi mi? → Upstash Redis
                                  └► Telegram kanalı / Discord
```

Site (`index.html`) aynı motoru tarayıcıda çalıştırır: en üstte Günlük, sonra 4 saat, 1 saat ve haftalık uyumsuzluk durumu görünür. Grafik TradingView'den gömülüdür (`BINANCE:XAGUSDT.P`, `js/config.js` içinden değiştirilebilir). Sayfa açıkken tarayıcı bildirimi de verebilir.

## Vercel'e bağlama (tek seferlik)

1. [vercel.com/new](https://vercel.com/new) → GitHub ile giriş → **`ruesandora/rc-istiyor`** reposunu **Import** et.
   Framework: *Other*, build komutu yok. **Deploy**.
   - Bundan sonra her push'ta otomatik yayın olur; her dal / PR için ayrı **önizleme linki** gelir.
2. Önizleme kontrolü: `https://<site>.vercel.app/api/check?dry=1` → şu an bildirilecek olayları JSON olarak gösterir (hiçbir şey göndermez).

### Bildirimleri açmak

1. **Telegram botu:** Telegram'da [@BotFather](https://t.me/BotFather) → `/newbot` → token'ı al.
2. **Kanal:** Bir Telegram kanalı aç (ör. `@rcgumus`), botu kanala **yönetici** olarak ekle.
3. **Tekrar önleme deposu:** Vercel projesi → **Storage** → **Upstash (Redis)** → ücretsiz planla oluştur ve projeye bağla
   (`KV_REST_API_URL` ve `KV_REST_API_TOKEN` otomatik eklenir).
4. Vercel → **Settings → Environment Variables**:

| Değişken | Örnek | Açıklama |
|---|---|---|
| `TWELVEDATA_API_KEY` | *(isteğe bağlı)* | Spot XAG/USD verisi ([twelvedata.com](https://twelvedata.com/register)). Yoksa Binance kullanılır |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC…` | BotFather'dan |
| `TELEGRAM_CHAT_ID` | `@rcgumus` | Kanal kullanıcı adı veya `-100…` ID |
| `CRON_SECRET` | uzun rastgele metin | /api/check'i yalnızca zamanlayıcı çağırabilsin |
| `SITE_URL` | `https://rc-gumus.vercel.app` | Mesajdaki "Grafiği aç" linki |
| `DISCORD_WEBHOOK_URL` | *(isteğe bağlı)* | Discord kanalına da gönderir |
| `ALERT_TIMEFRAMES` | `1d,4h,1h,1w` | Taranacak periyotlar |
| `ALERT_POTENTIAL` | `on` | `off` → yalnızca onaylananlar |

   Değişkenleri ekledikten sonra **Redeploy**.
5. Deneme mesajı: `https://<site>.vercel.app/api/check?test=1&key=<CRON_SECRET>` → kanala "bildirim testi" düşmeli.
6. **Zamanlayıcı:** GitHub repo → **Settings → Secrets and variables → Actions**:
   - `ALERT_URL` = `https://<site>.vercel.app/api/check`
   - `CRON_SECRET` = Vercel'dekiyle aynı

   `.github/workflows/alerts.yml` her 10 dakikada bir çalışır (yalnızca varsayılan daldan). **Actions → Uyumsuzluk bildirimleri → Run workflow** ile elle de tetiklenebilir.
7. Sitedeki "Telegram kanalına katıl" butonu için `js/config.js` içine kanal linkini yaz.

## Geliştirme

```bash
npm test                        # motor + API testleri (ağ taklit edilir)
python3 -m http.server 8080     # siteyi yerelde aç
npx vercel dev                  # API dahil yerelde çalıştır
```

## Dosyalar

- `js/divergence.js`: RSI (Wilder), pivot, onaylı ve oluşmakta olan uyumsuzluk motoru (tarayıcı + Node)
- `js/data.js`: veri kaynakları (Binance → Bybit → OKX)
- `js/app.js`: durum kartları, TradingView grafiği, liste, tarayıcı bildirimleri
- `js/config.js`: Telegram linki ve grafik sembolü
- `lib/alerts.js`: bildirim mantığı, mesaj biçimi, Telegram/Discord, Redis
- `api/check.js`: Vercel fonksiyonu

> ⚠️ Yatırım tavsiyesi değildir. Yalnızca eğitim ve bilgilendirme amaçlıdır.
