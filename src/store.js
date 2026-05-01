import { getUserStorageKey } from './auth.js';

let storeState = {
  portfolios: [],
  activeId: 'default',
  watchlist: []
};
let currentStorageKey = null;

export function initPortfolio() {
  currentStorageKey = getUserStorageKey() + '_data';
  storeState = loadPortfolio();
  
  // Ensure default portfolio exists
  if (storeState.portfolios.length === 0) {
    storeState.portfolios.push({
      id: 'default',
      name: 'Mi Portfolio',
      positions: [],
      history: [],
      transactionHistory: [],
      realizedGain: 0
    });
    savePortfolio();
  }

  // Migrate old data in portfolios if needed
  let changed = false;
  if (!storeState.watchlist) { storeState.watchlist = []; changed = true; }
  storeState.portfolios.forEach(port => {
    if (!port.transactionHistory) { port.transactionHistory = []; changed = true; }
    if (port.transactionHistory.length === 0 && port.positions && port.positions.length > 0) {
      port.positions.forEach(pos => {
        port.transactionHistory.push({
          id: pos.id + '_buy',
          type: 'buy',
          symbol: pos.symbol,
          name: pos.name,
          shares: pos.shares,
          price: pos.purchasePrice,
          currency: pos.purchaseCurrency || 'USD',
          exchangeRate: pos.purchaseExchangeRate || null,
          date: pos.purchaseDate,
          timestamp: pos.addedAt || Date.now(),
        });
      });
      changed = true;
    }
  });
  if (changed) savePortfolio();
}

function loadPortfolio() {
  if (!currentStorageKey) return { portfolios: [], activeId: 'default' };
  try {
    const data = localStorage.getItem(currentStorageKey);
    if (data) {
      const parsed = JSON.parse(data);
      // Migration from V1 (flat structure) to V2 (multiple portfolios)
      if (parsed.positions) {
        return {
          portfolios: [{
            id: 'default',
            name: 'Mi Portfolio',
            positions: parsed.positions || [],
            history: parsed.history || [],
            transactionHistory: parsed.transactionHistory || [],
            realizedGain: parsed.realizedGain || 0
          }],
          activeId: 'default'
        };
      }
      return parsed;
    }
  } catch (e) {
    console.warn('Failed to load portfolio:', e);
  }
  return { portfolios: [], activeId: 'default' };
}

function savePortfolio() {
  if (!currentStorageKey) return;
  try {
    localStorage.setItem(currentStorageKey, JSON.stringify(storeState));
  } catch (e) {
    console.warn('Failed to save portfolio:', e);
  }
}

// ===== Multiple Portfolios API =====
export function getPortfolios() {
  return storeState.portfolios.map(p => ({ id: p.id, name: p.name, positionCount: p.positions.length }));
}

export function getActivePortfolioId() {
  return storeState.activeId;
}

export function setActivePortfolioId(id) {
  storeState.activeId = id;
  savePortfolio();
}

export function addPortfolio(name) {
  const id = Date.now().toString(36);
  storeState.portfolios.push({
    id,
    name,
    positions: [],
    history: [],
    transactionHistory: [],
    realizedGain: 0
  });
  savePortfolio();
  return id;
}

export function renamePortfolio(id, newName) {
  const p = storeState.portfolios.find(port => port.id === id);
  if (p) {
    p.name = newName;
    savePortfolio();
  }
}

export function deletePortfolio(id) {
  if (storeState.portfolios.length <= 1) return; // Cannot delete last one
  storeState.portfolios = storeState.portfolios.filter(p => p.id !== id);
  if (storeState.activeId === id) {
    storeState.activeId = 'all';
  }
  savePortfolio();
}

export function getActivePortfolio() {
  if (storeState.activeId === 'all') return null;
  return storeState.portfolios.find(p => p.id === storeState.activeId) || storeState.portfolios[0];
}

// ===== Core Operations on Active Portfolio =====
export function getPositions() {
  const p = getActivePortfolio();
  if (p) return [...p.positions];
  
  // If 'all', return all combined
  let all = [];
  storeState.portfolios.forEach(port => {
    all = all.concat(port.positions.map(pos => ({ ...pos, portfolioId: port.id })));
  });
  return all;
}

export function getTransactionHistory() {
  const p = getActivePortfolio();
  if (p) return [...(p.transactionHistory || [])];
  
  let all = [];
  storeState.portfolios.forEach(port => {
    all = all.concat((port.transactionHistory || []).map(tx => ({ ...tx, portfolioId: port.id })));
  });
  return all.sort((a,b) => b.timestamp - a.timestamp);
}

export function getAllTimeSymbols() {
  const txs = getTransactionHistory();
  return [...new Set(txs.map(t => t.symbol))].filter(Boolean);
}

export function addPosition(symbol, name, shares, purchasePrice, purchaseDate, purchaseCurrency, purchaseExchangeRate) {
  const p = getActivePortfolio() || storeState.portfolios[0]; // If 'all', add to first portfolio
  
  const pos = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    symbol: symbol.toUpperCase(),
    name,
    shares: parseFloat(shares),
    purchasePrice: parseFloat(purchasePrice),
    purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
    purchaseCurrency: purchaseCurrency || 'USD',
    purchaseExchangeRate: purchaseExchangeRate ? parseFloat(purchaseExchangeRate) : null,
    addedAt: Date.now(),
  };
  p.positions.push(pos);

  p.transactionHistory.push({
    id: pos.id + '_buy',
    type: 'buy',
    symbol: pos.symbol,
    name: pos.name,
    shares: pos.shares,
    price: pos.purchasePrice,
    currency: pos.purchaseCurrency,
    exchangeRate: pos.purchaseExchangeRate,
    date: pos.purchaseDate,
    timestamp: Date.now(),
  });

  savePortfolio();
  return pos;
}

export function removeAllPositionsForSymbol(symbol) {
  const p = getActivePortfolio();
  if (!p) return; 
  p.positions = p.positions.filter((pos) => pos.symbol !== symbol);
  // FIX: Also remove transactions for this symbol
  if (p.transactionHistory) {
    p.transactionHistory = p.transactionHistory.filter((t) => t.symbol !== symbol);
  }
  savePortfolio();
}

/**
 * Repairs the transaction history by removing transactions for symbols 
 * that are no longer in the portfolio positions.
 */
export function syncTransactionsWithPositions() {
  const p = getActivePortfolio();
  if (!p) return;
  
  const activeSymbols = new Set(p.positions.map(pos => pos.symbol));
  
  if (p.transactionHistory) {
    const originalCount = p.transactionHistory.length;
    p.transactionHistory = p.transactionHistory.filter(t => activeSymbols.has(t.symbol));
    
    if (p.transactionHistory.length !== originalCount) {
      savePortfolio();
      return true; // Something was cleaned
    }
  }
  return false;
}

export function sellPosition(symbol, sharesToSell, sellPrice, sellDate) {
  const p = getActivePortfolio();
  if (!p) return 0; // Disallow when 'all'
  
  let remainingToSell = parseFloat(sharesToSell);
  const price = parseFloat(sellPrice) || 0;
  if (isNaN(remainingToSell) || remainingToSell <= 0) return 0;

  if (typeof p.realizedGain !== 'number') p.realizedGain = 0;

  const symbolPositions = p.positions
    .filter((pos) => pos.symbol === symbol)
    .sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate));

  let totalGainOnSale = 0;
  const totalSharesSold = remainingToSell;

  for (const pos of symbolPositions) {
    if (remainingToSell <= 0) break;
    
    if (pos.shares <= remainingToSell) {
      totalGainOnSale += (price - pos.purchasePrice) * pos.shares;
      remainingToSell -= pos.shares;
      p.positions = p.positions.filter((px) => px.id !== pos.id);
    } else {
      totalGainOnSale += (price - pos.purchasePrice) * remainingToSell;
      pos.shares -= remainingToSell;
      remainingToSell = 0;
    }
  }

  p.realizedGain += totalGainOnSale;

  p.transactionHistory.push({
    id: Date.now().toString(36) + '_sell',
    type: 'sell',
    symbol: symbol,
    shares: totalSharesSold - remainingToSell,
    price: price,
    gain: totalGainOnSale,
    date: sellDate || new Date().toISOString().split('T')[0],
    timestamp: Date.now(),
  });

  savePortfolio();
  return totalGainOnSale;
}

export function deleteTransaction(id) {
  const p = getActivePortfolio();
  if (!p || !p.transactionHistory) return;
  const originalCount = p.transactionHistory.length;
  p.transactionHistory = p.transactionHistory.filter(t => t.id !== id);
  if (p.transactionHistory.length !== originalCount) {
    savePortfolio();
    return true;
  }
  return false;
}

export function recordDividendTransaction(symbol, amount, date, shares, currency) {
  const p = getActivePortfolio();
  if (!p) return;
  p.transactionHistory.push({
    id: Date.now().toString(36) + '_div',
    type: 'dividend',
    symbol: symbol,
    amount: amount,
    shares: shares || 0,
    currency: currency || 'USD',
    date: date,
    timestamp: Date.now(),
  });
  savePortfolio();
}

export function getPortfolioStats(quotes) {
  if (storeState.activeId === 'all') {
    return getAllPortfoliosStats(quotes);
  }
  const p = getActivePortfolio();
  return calculateStatsForPositions(p.positions, quotes, p.realizedGain);
}

function calculateStatsForPositions(positions, quotes, realizedGain = 0) {
  const grouped = {};
  for (const pos of positions) {
    if (!grouped[pos.symbol]) {
      grouped[pos.symbol] = {
        symbol: pos.symbol,
        name: pos.name,
        entries: [],
        totalShares: 0,
        totalInvested: 0,
        totalInvestedEUR: 0,
      };
    }
    const g = grouped[pos.symbol];
    g.entries.push(pos);
    g.totalShares += pos.shares;
    g.totalInvested += pos.shares * pos.purchasePrice;
    
    if (pos.purchaseExchangeRate && pos.purchaseExchangeRate > 0) {
      g.totalInvestedEUR += (pos.shares * pos.purchasePrice) / pos.purchaseExchangeRate;
    } else {
      g.totalInvestedEUR += pos.shares * pos.purchasePrice;
    }
  }

  let totalInvested = 0;
  let totalInvestedEUR = 0;
  let totalValue = 0;
  let totalDailyChange = 0;

  const holdings = Object.values(grouped).map((group) => {
    const quote = quotes[group.symbol];
    const invested = group.totalInvested;
    const investedEUR = group.totalInvestedEUR;
    const shares = group.totalShares;
    const avgPrice = shares > 0 ? invested / shares : 0;
    const currentValue = quote ? shares * quote.price : invested;
    const gain = currentValue - invested;
    const gainPercent = invested > 0 ? (gain / invested) * 100 : 0;
    const dailyChange = quote ? shares * quote.change : 0;

    totalInvested += invested;
    totalInvestedEUR += investedEUR;
    totalValue += currentValue;
    totalDailyChange += dailyChange;

    return {
      id: group.entries[0].id,
      ids: group.entries.map((e) => e.id),
      entries: group.entries,
      symbol: group.symbol,
      name: group.name,
      shares,
      purchasePrice: avgPrice,
      purchaseDate: group.entries[0].purchaseDate,
      quote,
      currency: quote?.currency || group.entries[0].purchaseCurrency || 'USD',
      invested,
      investedEUR,
      currentValue,
      gain,
      gainPercent,
      dailyChange,
      dailyChangePercent: quote ? quote.changePercent : 0,
      weight: 0,
      entryCount: group.entries.length,
      isPortfolio: false,
    };
  });

  holdings.forEach((h) => {
    h.weight = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0;
  });

  return {
    holdings,
    totalInvested,
    totalInvestedEUR,
    totalValue,
    totalGain: totalValue - totalInvested,
    totalGainPercent: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
    totalDailyChange,
    totalDailyChangePercent: totalValue > 0 ? (totalDailyChange / (totalValue - totalDailyChange)) * 100 : 0,
    realizedGain: realizedGain || 0,
  };
}

function getAllPortfoliosStats(quotes) {
  let totalInvested = 0;
  let totalInvestedEUR = 0;
  let totalValue = 0;
  let totalDailyChange = 0;
  let realizedGain = 0;
  const portfolioHoldings = [];
  const allPositions = [];

  for (const port of storeState.portfolios) {
    const portStats = calculateStatsForPositions(port.positions, quotes, port.realizedGain);
    allPositions.push(...port.positions);
    
    portfolioHoldings.push({
      id: port.id,
      symbol: port.name,
      name: 'Portfolio',
      shares: 1,
      purchasePrice: portStats.totalInvested,
      purchaseDate: '',
      quote: { price: portStats.totalValue, change: portStats.totalDailyChange, changePercent: portStats.totalDailyChangePercent, currency: 'USD' },
      invested: portStats.totalInvested,
      investedEUR: portStats.totalInvestedEUR,
      currentValue: portStats.totalValue,
      gain: portStats.totalGain,
      gainPercent: portStats.totalGainPercent,
      dailyChange: portStats.totalDailyChange,
      dailyChangePercent: portStats.totalDailyChangePercent,
      weight: 0,
      entryCount: port.positions.length,
      isPortfolio: true,
      history: port.history || [],
    });

    totalInvested += portStats.totalInvested;
    totalInvestedEUR += portStats.totalInvestedEUR;
    totalValue += portStats.totalValue;
    totalDailyChange += portStats.totalDailyChange;
    realizedGain += (port.realizedGain || 0);
  }

  // Calculate combined holdings across all portfolios for charts
  const combinedStats = calculateStatsForPositions(allPositions, quotes);
  const combinedHoldings = combinedStats.holdings;

  portfolioHoldings.forEach((h) => {
    h.weight = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0;
  });

  return {
    holdings: portfolioHoldings,
    combinedHoldings: combinedHoldings,
    totalInvested,
    totalInvestedEUR,
    totalValue,
    totalGain: totalValue - totalInvested,
    totalGainPercent: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
    totalDailyChange,
    totalDailyChangePercent: totalValue > 0 ? (totalDailyChange / (totalValue - totalDailyChange)) * 100 : 0,
    realizedGain,
  };
}

export function recordSnapshot(stats) {
  const p = getActivePortfolio();
  if (!p) return; // Don't record snapshots for 'all' yet (or maybe we should?)
  
  const today = new Date().toISOString().split('T')[0];
  const existing = p.history.findIndex((h) => h.date === today);
  const snap = {
    date: today,
    totalValue: stats.totalValue,
    totalInvested: stats.totalInvested,
    timestamp: Date.now(),
  };
  if (existing >= 0) p.history[existing] = snap;
  else p.history.push(snap);
  if (p.history.length > 365) p.history = p.history.slice(-365);
  savePortfolio();
}

// Watchlist functions
export function getWatchlist() {
  return storeState.watchlist || [];
}

export function addToWatchlist(symbol) {
  if (!storeState.watchlist) storeState.watchlist = [];
  if (!storeState.watchlist.includes(symbol)) {
    storeState.watchlist.push(symbol);
    savePortfolio();
  }
}

export function removeFromWatchlist(symbol) {
  if (!storeState.watchlist) return;
  storeState.watchlist = storeState.watchlist.filter(s => s !== symbol);
  savePortfolio();
}
