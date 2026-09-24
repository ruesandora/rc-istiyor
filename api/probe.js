// GEÇİCİ: ücretsiz veri kaynaklarını Vercel'den dener. Birleştirilmeyecek.
'use strict';
const targets = {
  yahoo_SI_F_1h: 'https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=1h&range=60d',
  yahoo_SI_F_1wk: 'https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=1wk&range=10y',
  yahoo_XAGUSD_X_1h: 'https://query1.finance.yahoo.com/v8/finance/chart/XAGUSD=X?interval=1h&range=60d',
  stooq_xagusd_d: 'https://stooq.com/q/d/l/?s=xagusd&i=d',
  stooq_xagusd_w: 'https://stooq.com/q/d/l/?s=xagusd&i=w',
  stooq_xagusd_60: 'https://stooq.com/q/a2/d/?s=xagusd&i=60',
  tiingo_fx: 'https://api.tiingo.com/tiingo/fx/xagusd/prices?resampleFreq=1hour',
  kucoin_xag: 'https://api-futures.kucoin.com/api/v1/kline/query?symbol=XAGUSDTM&granularity=60',
  bitget_xag: 'https://api.bitget.com/api/v2/mix/market/candles?symbol=XAGUSDT&productType=USDT-FUTURES&granularity=1H&limit=5',
  gold_api: 'https://api.gold-api.com/price/XAG'
};
module.exports = async (req, res) => {
  const out = {};
  await Promise.all(Object.entries(targets).map(async ([k, url]) => {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; rc-probe)' } });
      const t = await r.text();
      let summary = t.slice(0, 160);
      try {
        const j = JSON.parse(t);
        const res0 = j.chart && j.chart.result && j.chart.result[0];
        if (res0) summary = { n: res0.timestamp ? res0.timestamp.length : 0, first: res0.timestamp && new Date(res0.timestamp[0] * 1000).toISOString(), last: res0.meta && res0.meta.regularMarketPrice, err: j.chart.error };
      } catch (e) { /* metin */ }
      out[k] = { status: r.status, lines: t.split('\n').length, summary };
    } catch (e) { out[k] = { error: e.message }; }
  }));
  res.setHeader('cache-control', 'no-store');
  res.status(200).json(out);
};
