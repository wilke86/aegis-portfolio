/**
 * Aegis Financial API Engine
 * Powered by Finnhub.io
 */

const FINNHUB_KEY = 'd7qi6dhr01qudmimd5rgd7qi6dhr01qudmimd5s0';
const BASE_URL = 'https://finnhub.io/api/v1';

// Helpers
const fetchFH = async (endpoint, params = {}) => {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.append('token', FINNHUB_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub error: ${res.status}`);
  return res.json();
};

/**
 * Search for symbols
 */
export async function searchSymbol(query) {
  if (!query || query.length < 1) return [];
  try {
    const data = await fetchFH('/search', { q: query });
    return (data.result || [])
      .filter(q => q.type === 'Common Stock' || q.type === 'ETF')
      .map(q => ({
        symbol: q.symbol,
        name: q.description,
        type: q.type === 'Common Stock' ? 'EQUITY' : 'ETF',
        exchange: q.displaySymbol
      }));
  } catch (e) {
    console.error('Search error:', e);
    return [];
  }
}

/**
 * Get real-time quote
 */
export async function getQuote(symbol) {
  try {
    const [quote, profile] = await Promise.all([
      fetchFH('/quote', { symbol }),
      fetchFH('/stock/profile2', { symbol })
    ]);

    return {
      symbol: symbol,
      name: profile.name || symbol,
      price: quote.c,
      previousClose: quote.pc,
      change: quote.d,
      changePercent: quote.dp,
      currency: profile.currency || 'USD',
      marketState: 'OPEN', // Finnhub free doesn't give state easily
      exchange: profile.exchange,
      fiftyTwoWeekHigh: null, // Basic quote doesn't have it
      fiftyTwoWeekLow: null,
      regularMarketVolume: null
    };
  } catch (e) {
    console.error(`Quote error for ${symbol}:`, e);
    throw e;
  }
}

/**
 * Get chart data
 */
export async function getChart(symbol, range = '3mo') {
  try {
    const now = Math.floor(Date.now() / 1000);
    let from;
    let resolution = 'D';

    switch (range) {
      case '1d': from = now - 86400; resolution = '5'; break;
      case '5d': from = now - 5 * 86400; resolution = '30'; break;
      case '1mo': from = now - 30 * 86400; resolution = 'D'; break;
      case '3mo': from = now - 90 * 86400; resolution = 'D'; break;
      case '6mo': from = now - 180 * 86400; resolution = 'D'; break;
      case '1y': from = now - 365 * 86400; resolution = 'W'; break;
      case '5y': from = now - 5 * 365 * 86400; resolution = 'M'; break;
      default: from = now - 90 * 86400; resolution = 'D';
    }

    const data = await fetchFH('/stock/candle', {
      symbol,
      resolution,
      from,
      to: now
    });

    if (data.s !== 'ok') throw new Error('No chart data');

    const points = data.t.map((t, i) => ({
      time: t * 1000,
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i]
    }));

    return {
      symbol,
      points
    };
  } catch (e) {
    console.error(`Chart error for ${symbol}:`, e);
    throw e;
  }
}

/**
 * Get multiple quotes for dashboard
 */
export async function getMultipleQuotes(symbols) {
  const results = {};
  await Promise.all(symbols.map(async (s) => {
    try {
      const q = await getQuote(s);
      results[s] = q;
    } catch (e) {
      console.warn(`Skip ${s}`);
    }
  }));
  return results;
}

/**
 * Get news for a symbol or general
 */
export async function getNews(symbol) {
  try {
    let data;
    if (symbol) {
      const to = new Date().toISOString().split('T')[0];
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      const from = fromDate.toISOString().split('T')[0];
      data = await fetchFH('/company-news', { symbol, from, to });
    } else {
      data = await fetchFH('/news', { category: 'general' });
    }
    
    return (data || []).slice(0, 10).map(n => ({
      uuid: n.id,
      title: n.headline,
      publisher: n.source,
      link: n.url,
      provider_publish_time: n.datetime,
      thumbnail: { resolutions: [{ url: n.image }] }
    }));
  } catch (e) {
    return [];
  }
}

/**
 * Trending symbols (Mock for Finnhub free tier)
 */
export async function getTrendingSymbols() {
  // Finnhub free doesn't have a direct trending endpoint
  // We use a curated list of high-volume stocks for Aegis
  return ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'NFLX', 'AMD', 'PYPL'];
}

/**
 * Deep details for Stock Detail modal
 */
export async function getStockDeepDetails(symbol) {
  try {
    const [quote, profile, metrics] = await Promise.all([
      fetchFH('/quote', { symbol }),
      fetchFH('/stock/profile2', { symbol }),
      fetchFH('/stock/metric', { symbol, metric: 'all' })
    ]);

    const m = metrics.metric || {};

    return {
      symbol,
      price: {
        regularMarketPrice: { raw: quote.c, fmt: quote.c.toFixed(2) },
        regularMarketChange: { raw: quote.d, fmt: quote.d.toFixed(2) },
        regularMarketChangePercent: { raw: quote.dp / 100, fmt: quote.dp.toFixed(2) + '%' },
        currency: profile.currency || 'USD',
        shortName: profile.name,
        exchangeName: profile.exchange
      },
      summaryDetail: {
        fiftyTwoWeekLow: { fmt: m['52WeekLow']?.toFixed(2) },
        fiftyTwoWeekHigh: { fmt: m['52WeekHigh']?.toFixed(2) },
        regularMarketVolume: { fmt: quote.v?.toLocaleString() },
        marketCap: { fmt: (profile.marketCapitalization * 1000000)?.toLocaleString() }
      },
      assetProfile: {
        longBusinessSummary: `Company in the ${profile.finnhubIndustry} sector. Listed on ${profile.exchange}.`
      },
      financialData: {
        targetMeanPrice: { fmt: m['targetMeanPrice']?.toFixed(2) || 'N/A' },
        currentPrice: { raw: quote.c }
      }
    };
  } catch (e) {
    console.error('Deep details error:', e);
    return null;
  }
}

// Logo URL helper (compatible with existing Aegis logic)
export function getLogoUrl(symbol, quote) {
  return `https://logo.clearbit.com/${symbol.split('.')[0]}.com`;
}

// Unused but kept for compatibility
export function isMarketOpen() { return true; }
export async function getFinancials() { return null; }
export async function getEvents() { return null; }
export async function getDividends() { return {}; }
export async function getHistoricalExchangeRate() { return 1.0; }
export async function getExchangeRates() { return {}; }
export async function getScreenerSymbols() { return ['AAPL', 'MSFT', 'NVDA']; }
export async function getTrendingTickers() { return getTrendingSymbols(); }
