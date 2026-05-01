// Yahoo Finance API via Vite proxy
const CHART_BASE = '/api/yahoo/v8/finance/chart';
const SEARCH_BASE = '/api/search/v1/finance/search';

let requestQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  while (requestQueue.length > 0) {
    const { resolve, reject, fn } = requestQueue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (e) {
      reject(e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  isProcessing = false;
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, fn });
    processQueue();
  });
}

export async function searchSymbol(query) {
  if (!query || query.length < 1) return [];
  try {
    const res = await fetch(
      `${SEARCH_BASE}?q=${encodeURIComponent(query)}&lang=en-US&region=US&quotesCount=8&newsCount=0`
    );
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    return (data.quotes || [])
      .filter((q) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'CRYPTOCURRENCY')
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        type: q.quoteType,
        exchange: q.exchDisp || q.exchange,
      }));
  } catch (e) {
    console.warn('Search error:', e);
    return [];
  }
}

export async function getQuote(symbol) {
  return enqueue(async () => {
    const res = await fetch(
      `${CHART_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false`
    );
    if (!res.ok) throw new Error(`Quote failed for ${symbol}`);
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error(`No data for ${symbol}`);

    const meta = result.meta;
    const closes = result.indicators?.quote?.[0]?.close || [];
    const prevClose = meta.chartPreviousClose || meta.previousClose || closes[closes.length - 2] || meta.regularMarketPrice;

    return {
      symbol: meta.symbol,
      name: meta.shortName || meta.longName || meta.symbol,
      price: meta.regularMarketPrice,
      previousClose: prevClose,
      change: meta.regularMarketPrice - prevClose,
      changePercent: ((meta.regularMarketPrice - prevClose) / prevClose) * 100,
      currency: meta.currency || 'USD',
      marketState: meta.marketState,
      exchange: meta.exchangeName,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      regularMarketVolume: meta.regularMarketVolume,
    };
  });
}

export async function getChart(symbol, range = '3mo', interval = '1d') {
  return enqueue(async () => {
    const intervalMap = {
      '1d': '5m', '5d': '15m', '1mo': '1d', '3mo': '1d',
      '6mo': '1d', '1y': '1wk', '5y': '1mo', 'ytd': '1d', 'max': '1mo',
    };
    const int = interval === '1d' ? intervalMap[range] || '1d' : interval;

    const res = await fetch(
      `${CHART_BASE}/${encodeURIComponent(symbol)}?interval=${int}&range=${range}&includePrePost=false`
    );
    if (!res.ok) throw new Error(`Chart failed for ${symbol}`);
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error(`No chart data for ${symbol}`);

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const volumes = quote.volume || [];

    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        points.push({
          time: timestamps[i] * 1000,
          open: opens[i],
          high: highs[i],
          low: lows[i],
          close: closes[i],
          volume: volumes[i],
        });
      }
    }
    return {
      symbol: result.meta.symbol,
      name: result.meta.shortName || result.meta.longName || result.meta.symbol,
      currency: result.meta.currency || 'USD',
      points,
    };
  });
}

export async function getMultipleQuotes(symbols) {
  if (!symbols || symbols.length === 0) return {};
  return enqueue(async () => {
    const res = await fetch(`/api/custom-yahoo/quote?symbols=${encodeURIComponent(symbols.join(','))}`);
    if (!res.ok) throw new Error('Quotes failed');
    const data = await res.json();
    const results = {};
    for (const q of data.quoteResponse?.result || []) {
      results[q.symbol] = {
        symbol: q.symbol,
        name: q.shortName || q.longName || q.symbol,
        price: q.regularMarketPrice,
        previousClose: q.regularMarketPreviousClose,
        change: q.regularMarketChange,
        changePercent: q.regularMarketChangePercent,
        currency: q.currency || 'USD',
        marketState: q.marketState,
        exchange: q.exchange,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow,
        regularMarketVolume: q.regularMarketVolume,
        marketCap: q.marketCap,
        trailingPE: q.trailingPE,
        eps: q.epsTrailingTwelveMonths,
        dividendYield: q.dividendYield,
        beta: q.beta,
        quoteType: q.quoteType,
        shortName: q.shortName,
        longName: q.longName
      };
    }
    return results;
  });
}

export function isMarketOpen() {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = now.getUTCHours();
  const min = now.getUTCMinutes();
  const totalMin = hour * 60 + min;
  return totalMin >= 13 * 60 + 30 && totalMin < 20 * 60;
}

export async function getFinancials(symbol) {
  return enqueue(async () => {
    const res = await fetch(`/api/custom-yahoo/financials?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error(`Financials failed for ${symbol}`);
    const data = await res.json();
    const result = data.quoteSummary?.result?.[0];
    if (!result) return null;

    return {
      incomeStatement: result.incomeStatementHistory?.incomeStatementHistory || [],
      earningsQuarterly: result.earnings?.financialsChart?.quarterly || [],
      epsQuarterly: result.earnings?.earningsChart?.quarterly || [],
      overview: result.assetProfile?.longBusinessSummary || null,
    };
  });
}

export async function getNews(symbol, count = 12) {
  return enqueue(async () => {
    try {
      const res = await fetch(`${SEARCH_BASE}?q=${encodeURIComponent(symbol)}&lang=en-US&region=US&quotesCount=0&newsCount=${count}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.news || [];
    } catch (e) {
      console.warn('News error:', e);
      return [];
    }
  });
}

export async function getTrendingTickers(count = 10) {
  return enqueue(async () => {
    try {
      const res = await fetch(`/api/yahoo/v1/finance/trending/US?count=${count}`);
      if (!res.ok) return [];
      const data = await res.json();
      const quotes = data.finance?.result?.[0]?.quotes || [];
      return quotes.map(q => q.symbol);
    } catch (e) {
      console.warn('Trending error:', e);
      return [];
    }
  });
}

// Map of well-known ETF providers to logo URLs
// Map of well-known ETF providers to logo URLs
const ETF_LOGO_MAP = {
  vanguard: 'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
  vuaa: 'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
  vusa: 'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
  vwrp: 'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
  vwrl: 'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
  ishares: 'https://www.google.com/s2/favicons?domain=ishares.com&sz=128',
  cspx: 'https://www.google.com/s2/favicons?domain=ishares.com&sz=128',
  swda: 'https://www.google.com/s2/favicons?domain=ishares.com&sz=128',
  blackrock: 'https://www.google.com/s2/favicons?domain=blackrock.com&sz=128',
  spdr: 'https://www.google.com/s2/favicons?domain=ssga.com&sz=128',
  invesco: 'https://www.google.com/s2/favicons?domain=invesco.com&sz=128',
  schwab: 'https://www.google.com/s2/favicons?domain=schwab.com&sz=128',
  fidelity: 'https://www.google.com/s2/favicons?domain=fidelity.com&sz=128',
  ark: 'https://www.google.com/s2/favicons?domain=ark-invest.com&sz=128',
  wisdomtree: 'https://www.google.com/s2/favicons?domain=wisdomtree.com&sz=128',
  amundi: 'https://www.google.com/s2/favicons?domain=amundi.com&sz=128',
  xtrackers: 'https://www.google.com/s2/favicons?domain=dws.com&sz=128',
};

const CRYPTO_LOGO_MAP = {
  'BTC-USD': 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  'ETH-USD': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  'USDT-USD': 'https://assets.coingecko.com/coins/images/325/small/tether.png',
  'SOL-USD': 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  'BNB-USD': 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  'XRP-USD': 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  'ADA-USD': 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  'DOT-USD': 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
};

const DOMAIN_MAP = {
  // US Tech & Major
  'AAPL': 'apple.com', 'MSFT': 'microsoft.com', 'GOOGL': 'google.com', 'GOOG': 'google.com',
  'AMZN': 'amazon.com', 'META': 'meta.com', 'TSLA': 'tesla.com', 'NVDA': 'nvidia.com',
  'NFLX': 'netflix.com', 'PYPL': 'paypal.com', 'ADBE': 'adobe.com', 'INTC': 'intel.com',
  'CSCO': 'cisco.com', 'PEP': 'pepsico.com', 'KO': 'cocacola.com', 'DIS': 'disney.com',
  'WMT': 'walmart.com', 'JPM': 'jpmorganchase.com', 'AMD': 'amd.com', 'AVGO': 'broadcom.com',
  'QCOM': 'qualcomm.com', 'SQ': 'squareup.com', 'UBER': 'uber.com', 'ABNB': 'airbnb.com',
  'CRM': 'salesforce.com', 'ORCL': 'oracle.com',
  // European
  'MC.PA': 'lvmh.com', 'ASML': 'asml.com', 'SAP': 'sap.com', 'SAN.MC': 'santander.com',
  'BBVA.MC': 'bbva.com', 'ITX.MC': 'inditex.com', 'TEF.MC': 'telefonica.com', 'REP.MC': 'repsol.com',
  'IBE.MC': 'iberdrola.com', 'VOW3.DE': 'volkswagen.com', 'AIR.PA': 'airbus.com', 'SIE.DE': 'siemens.com',
  'BMW.DE': 'bmw.com', 'MBG.DE': 'mercedes-benz.com', 'LVMH.PA': 'lvmh.com',
  'NESN.SW': 'nestle.com', 'NOVN.SW': 'novartis.com', 'ROG.SW': 'roche.com', 'HSBA.L': 'hsbc.com',
  // Others
  'BABA': 'alibaba.com', 'TCEHY': 'tencent.com', 'TM': 'toyota.com', 'SONY': 'sony.com',
  'SHOP': 'shopify.com', 'SPOT': 'spotify.com', 'SHEL.L': 'shell.com', 'BP.L': 'bp.com'
};

export function getLogoUrl(symbol, quote, preferCors = false) {
  const clean = symbol.split('.')[0].toUpperCase();
  const cleanLower = clean.toLowerCase();
  
  // 1. Check ETF providers first
  if (ETF_LOGO_MAP[cleanLower]) return ETF_LOGO_MAP[cleanLower];
  
  const n = (quote?.shortName || quote?.longName || quote?.name || symbol || '').toLowerCase();
  for (const [key, url] of Object.entries(ETF_LOGO_MAP)) {
    if (n.includes(key)) return url;
  }

  // 2. Try CRYPTO_LOGO_MAP
  if (CRYPTO_LOGO_MAP[symbol]) return CRYPTO_LOGO_MAP[symbol];
  
  // 3. For Charts (CORS-friendly), use FMP primarily as it's reliable and has CORS
  if (preferCors) {
    return `https://financialmodelingprep.com/image-stock/${clean}.png`;
  }

  // 4. Try direct domain map via Google
  if (DOMAIN_MAP[symbol]) return `https://www.google.com/s2/favicons?domain=${DOMAIN_MAP[symbol]}&sz=128`;
  if (DOMAIN_MAP[clean]) return `https://www.google.com/s2/favicons?domain=${DOMAIN_MAP[clean]}&sz=128`;
  
  // 5. Guess domain for stocks
  if (!symbol.includes('.')) {
    return `https://www.google.com/s2/favicons?domain=${symbol.toLowerCase()}.com&sz=128`;
  }

  return `https://financialmodelingprep.com/image-stock/${clean}.png`;
}

export async function getEvents(symbol) {
  return enqueue(async () => {
    const res = await fetch(`/api/custom-yahoo/financials?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.quoteSummary?.result?.[0]?.calendarEvents || null;
  });
}

export async function getDividends(symbol) {
  return enqueue(async () => {
    const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5y&events=div`);
    if (!res.ok) return {};
    const data = await res.json();
    return data.chart?.result?.[0]?.events?.dividends || {};
  });
}

// Currency conversion using free API
let fxRatesCache = null;
let fxRatesCacheTime = 0;

export async function getExchangeRates(baseCurrency = 'usd') {
  const now = Date.now();
  // Cache for 30 minutes
  if (fxRatesCache && fxRatesCache[baseCurrency] && now - fxRatesCacheTime < 30 * 60 * 1000) {
    return fxRatesCache[baseCurrency];
  }
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency.toLowerCase()}.json`);
    if (!res.ok) throw new Error('FX fetch failed');
    const data = await res.json();
    if (!fxRatesCache) fxRatesCache = {};
    fxRatesCache[baseCurrency] = data[baseCurrency.toLowerCase()] || {};
    fxRatesCacheTime = now;
    return fxRatesCache[baseCurrency];
  } catch (e) {
    console.warn('FX error:', e);
    return {};
  }
}

/**
 * Fetches the historical exchange rate for a given pair at a specific timestamp.
 * @param {string} from - Source currency (e.g. 'EUR')
 * @param {string} to - Target currency (e.g. 'USD')
 * @param {number} timestamp - Unix timestamp in seconds
 */
export async function getHistoricalExchangeRate(from, to, timestamp) {
  if (from === to) return 1.0;
  const pair = `${from}${to}=X`.toUpperCase();
  
  return enqueue(async () => {
    try {
      // Fetch 2 days of 1h data around the timestamp to find the closest match
      const p1 = timestamp - 86400;
      const p2 = timestamp + 86400;
      const res = await fetch(`/api/yahoo/v8/finance/chart/${pair}?period1=${p1}&period2=${p2}&interval=1h`);
      if (!res.ok) return null;
      
      const data = await res.json();
      const result = data.chart?.result?.[0];
      if (!result || !result.timestamp) return null;
      
      // Find the index of the closest timestamp
      let closestIdx = 0;
      let minDiff = Math.abs(result.timestamp[0] - timestamp);
      
      for (let i = 1; i < result.timestamp.length; i++) {
        const diff = Math.abs(result.timestamp[i] - timestamp);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      
      return result.indicators.quote[0].close[closestIdx] || result.indicators.quote[0].open[closestIdx];
    } catch (e) {
      console.warn(`Historical FX error for ${pair}:`, e);
      return null;
    }
  });
}

// ===== Discover / Research APIs =====

export async function getTrendingSymbols() {
  return enqueue(async () => {
    try {
      const res = await fetch('/api/yahoo/v1/finance/trending/US');
      if (!res.ok) return [];
      const data = await res.json();
      return data.finance?.result?.[0]?.quotes?.map(q => q.symbol).slice(0, 10) || [];
    } catch (e) {
      return [];
    }
  });
}

export async function getScreenerSymbols(scrId = 'day_gainers', count = 10) {
  return enqueue(async () => {
    try {
      const res = await fetch(`/api/yahoo/ws/screeners/v1/finance/screener/predefined/saved?count=${count}&scrIds=${scrId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.finance?.result?.[0]?.quotes?.map(q => q.symbol) || [];
    } catch (e) {
      return [];
    }
  });
}

export async function getStockDeepDetails(symbol) {
  return enqueue(async () => {
    let deepData = null;
    let basicData = null;

    // 1. Try to get deep data via proxy (with crumbs)
    try {
      const modules = 'assetProfile,defaultKeyStatistics,financialData,summaryDetail,recommendationTrend,earnings';
      const res = await fetch(`/api/custom-yahoo/quoteSummary/${symbol}?modules=${modules}`);
      if (res.ok) {
        const data = await res.json();
        deepData = data.quoteSummary?.result?.[0];
      }
    } catch (e) {
      console.warn('Deep details fetch failed:', e);
    }

    // 2. Always get basic data from Chart API (very reliable, no crumbs)
    try {
      const res = await fetch(`/api/yahoo/v8/finance/chart/${symbol}?interval=1d&range=1d`);
      if (res.ok) {
        const data = await res.json();
        basicData = data.chart?.result?.[0]?.meta;
      }
    } catch (e) {
      console.warn('Basic details fetch failed:', e);
    }

    if (!basicData && !deepData) return null;

    // Merge data
    const price = deepData?.price || {
      regularMarketPrice: { raw: basicData?.regularMarketPrice, fmt: basicData?.regularMarketPrice?.toFixed(2) },
      regularMarketChange: { raw: (basicData?.regularMarketPrice - (basicData?.chartPreviousClose || 0)), fmt: (basicData?.regularMarketPrice - (basicData?.chartPreviousClose || 0))?.toFixed(2) },
      regularMarketChangePercent: { raw: basicData?.regularMarketPrice ? ((basicData.regularMarketPrice - (basicData.chartPreviousClose || 0)) / basicData.chartPreviousClose) : 0, fmt: (basicData?.regularMarketPrice ? ((basicData.regularMarketPrice - (basicData.chartPreviousClose || 0)) / basicData.chartPreviousClose * 100).toFixed(2) + '%' : '0.00%') },
      currency: basicData?.currency,
      currencySymbol: basicData?.currency === 'EUR' ? '€' : (basicData?.currency === 'GBP' ? '£' : '$'),
      shortName: basicData?.shortName,
      longName: basicData?.longName,
      exchangeName: basicData?.exchangeName
    };

    const summary = deepData?.summaryDetail || {
      fiftyTwoWeekLow: { fmt: basicData?.fiftyTwoWeekLow?.toFixed(2) },
      fiftyTwoWeekHigh: { fmt: basicData?.fiftyTwoWeekHigh?.toFixed(2) },
      regularMarketVolume: { fmt: basicData?.regularMarketVolume?.toLocaleString() }
    };

    return {
      price,
      summaryDetail: summary,
      assetProfile: deepData?.assetProfile || {},
      defaultKeyStatistics: deepData?.defaultKeyStatistics || {},
      recommendationTrend: deepData?.recommendationTrend || {},
      financialData: deepData?.financialData || {},
      symbol: symbol
    };
  });
}
