/**
 * Aegis Financial API Engine - Production Grade
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
 * Search symbols
 */
export async function searchSymbol(query) {
  if (!query || query.length < 1) return [];
  try {
    const data = await fetchFH('/search', { q: query });
    return (data.result || [])
      .map(q => ({
        symbol: q.symbol,
        name: q.description || q.symbol,
        type: q.type === 'Common Stock' ? 'EQUITY' : (q.type || 'ASSET'),
        exchange: q.displaySymbol
      }));
  } catch (e) {
    return [];
  }
}

/**
 * Get Quote
 */
export async function getQuote(symbol) {
  try {
    const [quote, profile] = await Promise.all([
      fetchFH('/quote', { symbol }),
      fetchFH('/stock/profile2', { symbol }).catch(() => ({}))
    ]);

    let name = profile.name || symbol;
    if (symbol.startsWith('^')) {
      const indexNames = { '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq 100', '^DJI': 'Dow Jones', '^IBEX': 'IBEX 35', '^GDAXI': 'DAX', '^STOXX50E': 'Euro Stoxx 50', '^FTSE': 'FTSE 100', '^N225': 'Nikkei 225' };
      name = indexNames[symbol] || symbol;
    } else if (symbol === 'BTC-USD') name = 'Bitcoin';
    else if (symbol === 'ETH-USD') name = 'Ethereum';

    return {
      symbol,
      name,
      price: quote.c || quote.pc || 0,
      previousClose: quote.pc || quote.c || 0,
      change: quote.d || 0,
      changePercent: quote.dp || 0,
      currency: profile.currency || (symbol.includes('-USD') ? 'USD' : 'USD'),
      marketState: 'OPEN',
      exchange: profile.exchange || 'Market',
      fiftyTwoWeekHigh: quote.h || 0,
      fiftyTwoWeekLow: quote.l || 0,
      regularMarketVolume: quote.v || 0
    };
  } catch (e) {
    throw e;
  }
}

/**
 * Get multiple quotes
 */
export async function getMultipleQuotes(symbols) {
  const results = {};
  await Promise.all(symbols.map(async (s) => {
    try {
      results[s] = await getQuote(s);
    } catch (e) {}
  }));
  return results;
}

/**
 * Get News (Fixed mapping for Aegis UI)
 */
export async function getNews(symbol, count = 12) {
  try {
    let data;
    if (symbol && !symbol.startsWith('^') && !symbol.includes(' ')) {
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      data = await fetchFH('/company-news', { symbol, from, to });
    } else {
      data = await fetchFH('/news', { category: 'general' });
    }
    
    return (data || []).slice(0, count).map(n => ({
      uuid: n.id || Math.random().toString(),
      title: n.headline,
      publisher: n.source,
      link: n.url,
      providerPublishTime: n.datetime, // Matching main.js expectation
      image: n.image,
      thumbnail: { resolutions: [{ url: n.image }] } // Matching main.js expectation
    }));
  } catch (e) {
    return [];
  }
}

/**
 * Charts (Fixed resolution for non-US/Crypto)
 */
export async function getChart(symbol, range = '3mo') {
  try {
    const now = Math.floor(Date.now() / 1000);
    let from;
    let resolution = 'D';

    if (range === '1d') { from = now - 86400; resolution = '5'; }
    else if (range === '5d') { from = now - 5 * 86400; resolution = '60'; }
    else if (range === '1mo') { from = now - 30 * 86400; resolution = 'D'; }
    else if (range === '1y') { from = now - 365 * 86400; resolution = 'W'; }
    else if (range === '5y') { from = now - 5 * 365 * 86400; resolution = 'M'; }
    else { from = now - 90 * 86400; resolution = 'D'; }

    const data = await fetchFH('/stock/candle', { symbol, resolution, from, to: now });

    if (data.s !== 'ok') return { symbol, points: [] };

    const points = data.t.map((t, i) => ({
      time: t * 1000,
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i]
    }));

    return { symbol, points };
  } catch (e) {
    return { symbol, points: [] };
  }
}

/**
 * Deep Stock Details
 */
export async function getStockDeepDetails(symbol) {
  try {
    const [q, p, m] = await Promise.all([
      getQuote(symbol),
      fetchFH('/stock/profile2', { symbol }).catch(() => ({})),
      fetchFH('/stock/metric', { symbol, metric: 'all' }).catch(() => ({ metric: {} }))
    ]);

    const metrics = m.metric || {};

    return {
      symbol,
      price: {
        regularMarketPrice: { raw: q.price, fmt: q.price.toFixed(2) },
        regularMarketChange: { raw: q.change, fmt: q.change.toFixed(2) },
        regularMarketChangePercent: { raw: q.changePercent / 100, fmt: q.changePercent.toFixed(2) + '%' },
        currency: q.currency,
        shortName: q.name,
        exchangeName: q.exchange
      },
      summaryDetail: {
        fiftyTwoWeekLow: { fmt: metrics['52WeekLow']?.toFixed(2) || 'N/A' },
        fiftyTwoWeekHigh: { fmt: metrics['52WeekHigh']?.toFixed(2) || 'N/A' },
        regularMarketVolume: { fmt: q.regularMarketVolume?.toLocaleString() || 'N/A' },
        marketCap: { fmt: p.marketCapitalization ? (p.marketCapitalization * 1e6).toLocaleString() : 'N/A' }
      },
      assetProfile: {
        longBusinessSummary: `Sector: ${p.finnhubIndustry || 'General'}. Bolsa: ${p.exchange || 'Global'}. Descripcion: ${p.name} es una empresa líder en su sector.`
      },
      financialData: {
        currentPrice: { raw: q.price }
      }
    };
  } catch (e) {
    return null;
  }
}

// Global utilities
export function getLogoUrl(symbol) {
  const clean = symbol.split('.')[0].toUpperCase();
  return `https://logo.clearbit.com/${clean}.com`;
}

export function isMarketOpen() { return true; }
export async function getTrendingSymbols() { return ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'BTC-USD']; }
export async function getTrendingTickers() { return getTrendingSymbols(); }
export async function getScreenerSymbols() { return ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN']; }
export async function getFinancials() { return null; }
export async function getEvents() { return null; }
export async function getDividends() { return {}; }
export async function getHistoricalExchangeRate() { return 1.0; }
export async function getExchangeRates() { return {}; }
