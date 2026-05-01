import Chart from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import { getLogoUrl } from './api.js';

const CHART_COLORS = [
  '#6366f1', '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981',
  '#ec4899', '#f97316', '#14b8a6', '#a855f7', '#3b82f6',
];

const chartInstances = {};

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: '₣', CAD: 'C$', AUD: 'A$' };
const getCurrSym = (cur) => CURRENCY_SYMBOLS[cur] || (cur ? cur + ' ' : '$');

function getThemeColors() {
  const isLight = document.body.classList.contains('light-mode');
  return {
    grid: isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.03)',
    text: isLight ? '#475569' : '#5a5a78',
    tooltipBg: isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 15, 35, 0.95)',
    tooltipBorder: isLight ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.2)',
    tooltipText: isLight ? '#0f172a' : '#f0f0ff',
    transparent: isLight ? 'rgba(255, 255, 255, 0)' : 'rgba(0, 0, 0, 0)'
  };
}

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function getGradient(ctx, chartArea, colorStart, colorEnd) {
  const isLight = document.body.classList.contains('light-mode');
  const actualStart = colorStart === 'rgba(0,0,0,0)' ? (isLight ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)') : colorStart;
  const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  gradient.addColorStop(0, actualStart);
  gradient.addColorStop(1, colorEnd);
  return gradient;
}

// Shared logo image cache
if (!window._pvLogoCache) window._pvLogoCache = {};

function loadLogoImage(symbol, quote) {
  const key = symbol;
  if (window._pvLogoCache[key]) return window._pvLogoCache[key];
  
  const url = getLogoUrl(symbol, quote, false);
  const img = new Image();
  // IMPORTANT: Do NOT set crossOrigin. This allows any image to be drawn on canvas 
  // (it taints the canvas, which is fine since we don't export it).
  img.src = url;
  
  window._pvLogoCache[key] = { img, loaded: false, url };
  img.onload = () => { window._pvLogoCache[key].loaded = true; };
  img.onerror = () => { window._pvLogoCache[key].failed = true; };
  return window._pvLogoCache[key];
}

export function createPerformanceChart(canvasId, chartData, purchasePrice) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !chartData?.points?.length) return;

  const labels = chartData.points.map((p) => new Date(p.time));
  const data = chartData.points.map((p) => p.close);
  const isPositive = data[data.length - 1] >= (purchasePrice || data[0]);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: isPositive ? '#10b981' : '#ef4444',
        borderWidth: 2,
        fill: true,
        backgroundColor: (context) => {
          const { ctx, chartArea } = context.chart;
          if (!chartArea) return 'transparent';
          return getGradient(ctx, chartArea,
            'rgba(0,0,0,0)',
            isPositive ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'
          );
        },
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: isPositive ? '#10b981' : '#ef4444',
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          borderColor: getThemeColors().tooltipBorder,
          borderWidth: 1,
          titleFont: { family: "'Inter'", size: 12 },
          bodyFont: { family: "'JetBrains Mono'", size: 13, weight: '600' },
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          padding: 12,
          callbacks: {
            title: (items) => {
              const d = new Date(items[0].parsed.x);
              return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
            },
            label: (item) => `${getCurrSym()}${item.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          grid: { color: getThemeColors().grid },
          ticks: { color: getThemeColors().text, font: { size: 11 }, maxTicksLimit: 8 },
          border: { display: false },
        },
        y: {
          grid: { color: getThemeColors().grid },
          ticks: {
            color: getThemeColors().text,
            font: { family: "'JetBrains Mono'", size: 11 },
            callback: (v) => getCurrSym() + v.toFixed(2),
          },
          border: { display: false },
        },
      },
    },
  });
}

export function createPortfolioChart(canvasId, holdings, chartDataMap, range, displayCurrency, convertFn, totalInvested, allTransactions) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || holdings.length === 0) return;

  // Find the chart with the most data points to use as base timeline
  let maxPoints = 0;
  let baseSymbol = null;
  for (const h of holdings) {
    const cd = chartDataMap[h.symbol];
    if (cd && cd.points.length > maxPoints) {
      maxPoints = cd.points.length;
      baseSymbol = h.symbol;
    }
  }
  if (!baseSymbol) return;

  const baseData = chartDataMap[baseSymbol];
  const labels = baseData.points.map((p) => new Date(p.time));

  // Initialize tracking for historical values
  const currentShares = {};
  const currentInvestedPerSymbol = {};
  let txIdx = 0;
  let sortedTxs = [];
  if (allTransactions) {
    // Sort transactions by date
    sortedTxs = [...allTransactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  const investedValues = [];
  const portfolioValues = labels.map((date, i) => {
    const ts = date.getTime();
    
    // Update state based on transactions up to this point
    if (allTransactions) {
      while (txIdx < sortedTxs.length && new Date(sortedTxs[txIdx].date).getTime() <= ts + 86400000) { // +1 day buffer for EOD matching
        const tx = sortedTxs[txIdx];
        const type = (tx.type || '').toUpperCase();
        const isBuy = type === 'BUY' || type === 'COMPRA';
        
        if (!currentShares[tx.symbol]) currentShares[tx.symbol] = 0;
        if (!currentInvestedPerSymbol[tx.symbol]) currentInvestedPerSymbol[tx.symbol] = 0;
        
        const sharesDelta = isBuy ? tx.shares : -Math.abs(tx.shares);
        currentShares[tx.symbol] += sharesDelta;
        
        // Update invested capital
        if (isBuy) {
          const fiatVal = tx.shares * tx.purchasePrice;
          currentInvestedPerSymbol[tx.symbol] += fiatVal;
        } else {
          // Proportional reduction of invested capital on sell
          const prevShares = currentShares[tx.symbol] - sharesDelta;
          if (prevShares > 0) {
            const ratio = Math.abs(sharesDelta) / prevShares;
            currentInvestedPerSymbol[tx.symbol] -= currentInvestedPerSymbol[tx.symbol] * ratio;
          } else {
            currentInvestedPerSymbol[tx.symbol] = 0;
          }
        }
        txIdx++;
      }
    }

    let totalVal = 0;
    let totalInv = 0;
    
    for (const h of holdings) {
      const shares = allTransactions ? (currentShares[h.symbol] || 0) : h.shares;
      const inv = allTransactions ? (currentInvestedPerSymbol[h.symbol] || 0) : h.invested;
      
      const cur = h.quote?.currency || 'USD';
      const cd = chartDataMap[h.symbol];
      
      if (shares > 0) {
        let price = 0;
        if (cd && cd.points[i]) price = cd.points[i].close;
        else if (cd && cd.points.length > 0) {
          const idx = Math.min(i, cd.points.length - 1);
          price = cd.points[idx].close;
        } else {
          price = h.currentPrice || 0;
        }
        totalVal += convertFn ? convertFn(shares * price, cur) : (shares * price);
      }
      totalInv += convertFn ? convertFn(inv, cur) : inv;
    }
    
    investedValues.push(totalInv);
    return totalVal;
  });

  const finalInv = investedValues[investedValues.length - 1];
  const isPositive = portfolioValues[portfolioValues.length - 1] >= finalInv;

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Valor del portfolio',
          data: portfolioValues,
          borderColor: isPositive ? '#10b981' : '#ef4444',
          borderWidth: 2.5,
          fill: true,
          backgroundColor: (context) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return 'transparent';
            const isLight = document.body.classList.contains('light-mode');
            const opacity = isLight ? 0.12 : 0.08;
            return getGradient(ctx, chartArea, 'rgba(0,0,0,0)',
              isPositive ? `rgba(16,185,129,${opacity})` : `rgba(239,68,68,${opacity})`);
          },
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: isPositive ? '#10b981' : '#ef4444',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
        },
        {
          label: 'Invertido',
          data: allTransactions ? investedValues : portfolioValues.map(() => totalInvested),
          borderColor: 'rgba(99,102,241,0.3)',
          borderWidth: 1,
          borderDash: [6, 4],
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          borderColor: getThemeColors().tooltipBorder,
          borderWidth: 1,
          titleFont: { family: "'Inter'", size: 12 },
          bodyFont: { family: "'JetBrains Mono'", size: 13, weight: '600' },
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          padding: 12,
          callbacks: {
            title: (items) => {
              const d = new Date(items[0].parsed.x);
              return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
            },
            label: (item) => `${item.dataset.label}: ${getCurrSym(displayCurrency)}${item.parsed.y.toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          grid: { color: getThemeColors().grid },
          ticks: { color: getThemeColors().text, font: { size: 11 }, maxTicksLimit: 8 },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          grid: { color: getThemeColors().grid },
          ticks: {
            color: getThemeColors().text,
            font: { family: "'JetBrains Mono'", size: 11 },
            callback: (v) => getCurrSym(displayCurrency) + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
          },
          border: { display: false },
        },
      },
    },
  });

  return { portfolioValues, isPositive, totalInvested };
}

export function createAllocationChart(canvasId, holdings, legendId) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || holdings.length === 0) return;

  const sorted = [...holdings].sort((a, b) => b.currentValue - a.currentValue);
  const labels = sorted.map((h) => h.symbol);
  const data = sorted.map((h) => h.currentValue);
  const colors = sorted.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          borderColor: getThemeColors().tooltipBorder,
          borderWidth: 1,
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          bodyFont: { family: "'JetBrains Mono'", size: 13, weight: '600' },
          padding: 12,
          callbacks: {
            label: (item) => {
              const pct = ((item.parsed / data.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
              return ` ${item.label}: $${item.parsed.toFixed(2)} (${pct}%)`;
            },
          },
        },
      },
    },
    plugins: [{
      id: 'customLogoPlugin',
      afterDraw(chart) {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        const holdingsRef = sorted;
        
        chart.data.labels.forEach((symbol, i) => {
          const arc = meta.data[i];
          if (!arc || arc.circumference < 0.15) return;
          
          const holding = holdingsRef[i];
          const cached = loadLogoImage(symbol, holding?.quote);
          
          if (!holding?.isPortfolio && cached.loaded && cached.img.complete && cached.img.naturalWidth > 0) {
            const midAngle = arc.startAngle + (arc.endAngle - arc.startAngle) / 2;
            const radius = (arc.innerRadius + arc.outerRadius) / 2;
            const posX = arc.x + Math.cos(midAngle) * radius;
            const posY = arc.y + Math.sin(midAngle) * radius;
            const size = 24;
            
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.arc(posX, posY, size / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(cached.img, posX - size / 2, posY - size / 2, size, size);
            ctx.restore();
          } else if (!holding?.isPortfolio && !cached.loaded && !cached.failed) {
            cached.img.addEventListener('load', () => {
              chart.update('none');
            }, { once: true });
          }
        });
      }
    }]
  });

  // Render legend with HTML logos (same format as holdings tab)
  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    legendEl.innerHTML = sorted.map((h, i) => {
      const iconHtml = h.isPortfolio
        ? '' 
        : `<img src="${getLogoUrl(h.symbol, h.quote)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: contain; background: transparent; filter: drop-shadow(0 0 3px rgba(255,255,255,0.4));" onerror="window.handleLogoError(this, '${h.symbol}')">`;
      
      return `
      <div class="legend-item" style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
        <div class="legend-dot" style="background:${colors[i]}; flex-shrink: 0;"></div>
        ${iconHtml}
        <span style="font-weight: 600; color: var(--text-primary);">${h.symbol}</span>
        <span style="color: var(--text-muted); font-size: 0.9rem;">(${h.weight.toFixed(1)}%)</span>
      </div>
    `;}).join('');
  }
}

export function createHistoricalAllocationChart(canvasId, holdings, chartDataMap, allTransactions) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || holdings.length === 0 || !allTransactions) return;

  // Find the chart with the most data points to use as base timeline
  let maxPoints = 0;
  let baseSymbol = null;
  for (const h of holdings) {
    const cd = chartDataMap[h.symbol];
    if (cd && cd.points.length > maxPoints) {
      maxPoints = cd.points.length;
      baseSymbol = h.symbol;
    }
  }
  if (!baseSymbol) return;

  const sortedTxs = [...allTransactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (sortedTxs.length === 0) return;
  const firstTxTime = new Date(sortedTxs[0].date).getTime();

  const baseData = chartDataMap[baseSymbol];
  if (!baseData || !baseData.points) return;
  let allLabels = baseData.points.map((p) => new Date(p.time));
  
  // Find index where timeline starts (the first point at or AFTER the first transaction)
  let startIdx = allLabels.findIndex(l => l.getTime() >= firstTxTime);
  if (startIdx === -1) startIdx = 0;

  const labels = allLabels.slice(startIdx);
  let txIdx = 0;
  const currentShares = {};

  // Calculate historical shares and values
  const historicalValues = {};
  holdings.forEach((h, i) => {
    historicalValues[h.symbol] = {
      values: new Array(labels.length).fill(0),
      color: CHART_COLORS[i % CHART_COLORS.length]
    };
  });

  const totals = new Array(labels.length).fill(0);

  labels.forEach((date, i) => {
    const ts = date.getTime();
    
    // Update shares up to this date
    while (txIdx < sortedTxs.length && new Date(sortedTxs[txIdx].date).getTime() <= ts + 86400000) {
      const tx = sortedTxs[txIdx];
      const type = (tx.type || '').toUpperCase();
      const isBuy = type === 'BUY' || type === 'COMPRA';
      if (!currentShares[tx.symbol]) currentShares[tx.symbol] = 0;
      currentShares[tx.symbol] += isBuy ? tx.shares : -Math.abs(tx.shares);
      txIdx++;
    }

    let dailyTotal = 0;
    holdings.forEach(h => {
      const shares = currentShares[h.symbol] || 0;
      if (shares <= 0) return;
      
      const cd = chartDataMap[h.symbol];
      let price = h.currentPrice || 0;
      
      const priceIdx = i + startIdx;
      if (cd && cd.points[priceIdx]) price = cd.points[priceIdx].close;
      else if (cd && cd.points.length > 0) {
        const idx = Math.min(priceIdx, cd.points.length - 1);
        price = cd.points[idx].close;
      }
      
      const val = shares * price;
      historicalValues[h.symbol].values[i] = val;
      dailyTotal += val;
    });
    totals[i] = dailyTotal;
  });

  // Convert absolute values to percentages (100% stacked)
  const datasets = holdings.map((h) => {
    const data = historicalValues[h.symbol].values.map((v, i) => {
      return totals[i] > 0 ? (v / totals[i]) * 100 : 0;
    });
    
    return {
      label: h.symbol,
      data: data,
      borderColor: historicalValues[h.symbol].color,
      backgroundColor: historicalValues[h.symbol].color,
      fill: false,
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 6,
    };
  });

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: getThemeColors().text, font: { family: "'Inter'", size: 10 }, usePointStyle: true }
        },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          callbacks: {
            label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'month',
            displayFormats: { month: 'MMM yyyy' }
          },
          grid: { display: false },
          ticks: { color: getThemeColors().text, font: { size: 10 }, maxRotation: 0 }
        },
        y: {
          beginAtZero: true,
          max: 100,
          grid: { color: getThemeColors().grid },
          ticks: {
            color: getThemeColors().text,
            font: { size: 10 },
            callback: (v) => v + '%'
          }
        }
      }
    }
  });
}

export function createGainLossChart(canvasId, holdings, displayCurrency, convertFn, getCurrSymFn) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || holdings.length === 0) return;

  const sorted = [...holdings].sort((a, b) => b.gain - a.gain);
  const labels = sorted.map((h) => h.symbol);
  
  // Convert gains using convertFn if provided, else use raw gain
  const data = sorted.map((h) => {
    const cur = h.quote?.currency || h.currency || 'USD';
    return convertFn ? convertFn(h.gain, cur) : h.gain;
  });
  
  const colors = data.map((v) => v >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)');
  const borderColors = data.map((v) => v >= 0 ? '#10b981' : '#ef4444');

  // Pre-load logos
  sorted.forEach((h) => { if (!h.isPortfolio) loadLogoImage(h.symbol, h.quote); });

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.4,
        categoryPercentage: 0.8,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          borderColor: getThemeColors().tooltipBorder,
          borderWidth: 1,
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          bodyFont: { family: "'JetBrains Mono'", size: 13, weight: '600' },
          padding: 12,
          callbacks: {
            label: (item) => {
              const v = item.parsed.x;
              const sym = getCurrSymFn ? getCurrSymFn(displayCurrency) : '$';
              return ` ${v >= 0 ? '+' : ''}${sym}${Math.abs(v).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: getThemeColors().grid },
          grace: '10%',
          ticks: {
            color: getThemeColors().text,
            font: { family: "'JetBrains Mono'", size: 11 },
            callback: (v) => {
              const sym = getCurrSymFn ? getCurrSymFn(displayCurrency) : '$';
              return (v >= 0 ? '+' : '-') + sym + Math.abs(v).toLocaleString(undefined, {maximumFractionDigits: 0});
            },
          },
          border: { display: false },
        },
        y: {
          grid: { display: false },
          ticks: { 
            color: getThemeColors().text, 
            font: { family: "'Inter'", size: 12, weight: '600' },
            padding: 38 
          },
          border: { display: false },
        },
      },
    },
    plugins: [{
      id: 'barLogoPlugin',
      afterDraw(chart) {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        const holdingsRef = sorted;
        
        meta.data.forEach((bar, i) => {
          const symbol = chart.data.labels[i];
          const holding = holdingsRef[i];
          const cached = loadLogoImage(symbol, holding?.quote);
          
          if (!holding?.isPortfolio && cached.loaded && cached.img.complete && cached.img.naturalWidth > 0) {
            const { y } = bar.tooltipPosition();
            const size = 24;
            const logoX = 8; 
            const logoY = y - size / 2;
            
            ctx.save();
            ctx.fillStyle = getThemeColors().grid;
            ctx.beginPath();
            ctx.arc(logoX + size / 2, logoY + size / 2, size / 2 + 2, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(logoX + size / 2, logoY + size / 2, size / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(cached.img, logoX, logoY, size, size);
            ctx.restore();
          } else if (!holding?.isPortfolio && !cached.loaded && !cached.failed) {
            cached.img.addEventListener('load', () => {
              chart.update('none');
            }, { once: true });
          }
        });
      }
    }],
  });
}

export function createIndividualChart(canvasId, holdings) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || holdings.length === 0) return;

  const sorted = [...holdings].sort((a, b) => b.gainPercent - a.gainPercent);
  const labels = sorted.map((h) => h.symbol);
  const data = sorted.map((h) => h.gainPercent);
  const colors = sorted.map((h) => h.gainPercent >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)');
  const borderColors = sorted.map((h) => h.gainPercent >= 0 ? '#10b981' : '#ef4444');

  // Pre-load logos
  sorted.forEach((h) => { if (!h.isPortfolio) loadLogoImage(h.symbol, h.quote); });

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.4,
        categoryPercentage: 0.8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          borderColor: getThemeColors().tooltipBorder,
          borderWidth: 1,
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          bodyFont: { family: "'JetBrains Mono'", size: 13, weight: '600' },
          padding: 12,
          callbacks: {
            label: (item) => {
              const v = item.parsed.y;
              return ` ${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: getThemeColors().text, font: { family: "'Inter'", size: 12, weight: '600' } },
          border: { display: false },
        },
        y: {
          grid: { color: getThemeColors().grid },
          grace: '15%',
          ticks: {
            color: getThemeColors().text,
            font: { family: "'JetBrains Mono'", size: 11 },
            callback: (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%',
          },
          border: { display: false },
        },
      },
    },
    plugins: [{
      id: 'vertBarLogoPlugin',
      afterDraw(chart) {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        const holdingsRef = sorted;
        
        meta.data.forEach((bar, i) => {
          const symbol = chart.data.labels[i];
          const holding = holdingsRef[i];
          const cached = loadLogoImage(symbol, holding?.quote);
          
          if (!holding?.isPortfolio && cached.loaded && cached.img.complete && cached.img.naturalWidth > 0) {
            const { x, y } = bar.tooltipPosition();
            const size = 22;
            const isPositive = data[i] >= 0;
            const logoX = x - size / 2;
            const logoY = isPositive ? y - size - 8 : y + 8;
            
            ctx.save();
            ctx.fillStyle = getThemeColors().grid;
            ctx.beginPath();
            ctx.arc(logoX + size / 2, logoY + size / 2, size / 2 + 2, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(logoX + size / 2, logoY + size / 2, size / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(cached.img, logoX, logoY, size, size);
            ctx.restore();
          } else if (!holding?.isPortfolio && !cached.loaded && !cached.failed) {
            cached.img.addEventListener('load', () => {
              chart.update('none');
            }, { once: true });
          }
        });
      }
    }],
  });
}

export function createMiniChart(canvas, data, isPositive) {
  if (!canvas) return;
  if (canvas.id) destroyChart(canvas.id);
  
  const instance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{
        data,
        borderColor: isPositive ? '#10b981' : '#ef4444',
        borderWidth: 1.5,
        fill: true,
        backgroundColor: isPositive ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
        tension: 0.4,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      elements: { line: { capBezierPoints: true } },
    },
  });

  if (canvas.id) chartInstances[canvas.id] = instance;
  return instance;
}

export function createFinancialCharts(canvasIncome, canvasCashflow, canvasEps, financials) {
  destroyChart(canvasIncome);
  destroyChart(canvasCashflow);
  destroyChart(canvasEps);
  
  if (!financials || !financials.incomeStatement || financials.incomeStatement.length === 0) {
    const incCanvas = document.getElementById(canvasIncome);
    if (incCanvas) incCanvas.parentElement.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center">No hay datos financieros disponibles</p>';
    return;
  }

  const incomeData = [...financials.incomeStatement].reverse(); // oldest to newest
  const cashflowData = financials.cashFlow ? [...financials.cashFlow].reverse() : [];

  const labels = incomeData.map(d => d.endDate?.fmt?.substring(0, 4) || '');
  
  const revenues = incomeData.map(d => d.totalRevenue?.raw || 0);
  const netIncomes = incomeData.map(d => d.netIncome?.raw || 0);
  
  const canvasInc = document.getElementById(canvasIncome);
  if (canvasInc) {
    chartInstances[canvasIncome] = new Chart(canvasInc, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ingresos',
            data: revenues,
            backgroundColor: 'rgba(99,102,241,0.8)',
            borderRadius: 4,
          },
          {
            label: 'Beneficio Neto',
            data: netIncomes,
            backgroundColor: 'rgba(16,185,129,0.8)',
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8b8ba7', font: { family: "'Inter'", size: 12 } } },
          tooltip: {
            backgroundColor: 'rgba(15,15,35,0.95)',
            borderColor: 'rgba(99,102,241,0.2)',
            borderWidth: 1,
            callbacks: {
              label: (item) => ` ${item.dataset.label}: $${(item.raw / 1e9).toFixed(2)}B`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8b8ba7' } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#8b8ba7', callback: v => '$' + (v / 1e9).toFixed(0) + 'B' } }
        }
      }
    });
  }

  const canvasCF = document.getElementById(canvasCashflow);
  const qData = financials.earningsQuarterly || [];
  if (canvasCF && qData.length > 0) {
    const qRevenues = qData.map(d => d.revenue?.raw || 0);
    const qEarnings = qData.map(d => d.earnings?.raw || 0);
    const qLabels = qData.map(d => d.date || '');
    
    chartInstances[canvasCashflow] = new Chart(canvasCF, {
      type: 'bar',
      data: {
        labels: qLabels,
        datasets: [
          {
            label: 'Ingresos (Trimestral)',
            data: qRevenues,
            backgroundColor: 'rgba(99,102,241,0.8)',
            borderRadius: 4,
          },
          {
            label: 'Beneficio Neto (Trimestral)',
            data: qEarnings,
            backgroundColor: 'rgba(16,185,129,0.8)',
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8b8ba7', font: { family: "'Inter'", size: 12 } } },
          tooltip: {
            backgroundColor: 'rgba(15,15,35,0.95)',
            borderColor: 'rgba(6,182,212,0.2)',
            borderWidth: 1,
            callbacks: {
              label: (item) => ` ${item.dataset.label}: $${(item.raw / 1e9).toFixed(2)}B`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8b8ba7' } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#8b8ba7', callback: v => '$' + (v / 1e9).toFixed(2) + 'B' } }
        }
      }
    });
  }

  const canvasEPS = document.getElementById(canvasEps);
  const epsData = financials.epsQuarterly || [];
  if (canvasEPS && epsData.length > 0) {
    const eLabels = epsData.map(d => d.date || '');
    const eActual = epsData.map(d => d.actual?.raw || 0);
    const eEstimate = epsData.map(d => d.estimate?.raw || 0);
    
    chartInstances[canvasEps] = new Chart(canvasEPS, {
      type: 'bar',
      data: {
        labels: eLabels,
        datasets: [
          {
            label: 'Estimado',
            data: eEstimate,
            backgroundColor: 'rgba(99,102,241,0.3)',
            borderColor: 'rgba(99,102,241,0.8)',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Reportado',
            data: eActual,
            backgroundColor: 'rgba(16,185,129,0.8)',
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: getThemeColors().text, font: { family: "'Inter'", size: 12 } } },
          tooltip: {
            backgroundColor: getThemeColors().tooltipBg,
            borderColor: getThemeColors().tooltipBorder,
            borderWidth: 1,
            titleColor: getThemeColors().tooltipText,
            bodyColor: getThemeColors().tooltipText,
            callbacks: {
              label: (item) => ` ${item.dataset.label}: $${item.raw.toFixed(2)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: getThemeColors().text } },
          y: { grid: { color: getThemeColors().grid }, ticks: { color: getThemeColors().text, callback: v => '$' + v.toFixed(2) } }
        }
      }
    });
  }
}

export function createCompoundChart(canvasId, years, dataPrincipal, dataTotal) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const labels = Array.from({ length: years + 1 }, (_, i) => `Año ${i}`);
  
  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Acumulado',
          data: dataTotal,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.2)',
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 6,
        },
        {
          label: 'Total Invertido',
          data: dataPrincipal,
          borderColor: 'rgba(99, 102, 241, 0.5)',
          backgroundColor: 'rgba(150, 150, 150, 0.1)',
          fill: true,
          tension: 0,
          pointRadius: 0,
        }
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: getThemeColors().text, font: { family: "'Inter'", size: 12 } }
        },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          borderColor: getThemeColors().tooltipBorder,
          borderWidth: 1,
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          padding: 12,
          callbacks: {
            label: (item) => `${item.dataset.label}: $${item.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: getThemeColors().text, maxTicksLimit: 10 },
          border: { display: false },
        },
        y: {
          grid: { color: getThemeColors().grid },
          ticks: {
            color: getThemeColors().text,
            callback: (v) => '$' + v.toLocaleString()
          },
          border: { display: false },
        },
      },
    },
  });
}

export function createDoughnutChart(canvasId, labels, data, legendId) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const colors = [
    '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', 
    '#06b6d4', '#f97316', '#a855f7', '#14b8a6', '#64748b'
  ];

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 15
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '75%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          borderColor: getThemeColors().tooltipBorder,
          borderWidth: 1,
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          padding: 12,
          callbacks: {
            label: (item) => ` ${item.label}: ${item.parsed.toFixed(1)}%`
          }
        }
      }
    }
  });

  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    legendEl.innerHTML = labels.map((l, i) => `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 10px; height: 10px; border-radius: 2px; background: ${colors[i % colors.length]};"></div>
          <span style="color: var(--text-secondary);">${l}</span>
        </div>
        <span style="font-weight: 600; color: var(--text-primary);">${data[i].toFixed(1)}%</span>
      </div>
    `).join('');
  }
}

export function createHorizontalBarChart(canvasId, labels, data, colors) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors || '#6366f1',
        borderRadius: 4,
        barThickness: 20
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: getThemeColors().tooltipBg,
          titleColor: getThemeColors().tooltipText,
          bodyColor: getThemeColors().tooltipText,
          callbacks: {
            label: (item) => ` Contribución: ${item.parsed.x.toFixed(1)}%`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: 'var(--text-muted)', callback: (v) => v + '%' }
        },
        y: {
          grid: { display: false },
          ticks: { color: 'var(--text-primary)' }
        }
      }
    }
  });
}
export function createBenchmarkLineChart(canvasId, labels, realValues, simValues) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const { grid, text } = getThemeColors();
  const currency = localStorage.getItem('pv_display_currency') || 'USD';
  const sym = getCurrSym(currency);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Tu Cartera',
          data: realValues,
          borderColor: 'rgba(99, 102, 241, 1)',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 6,
          borderWidth: 3
        },
        {
          label: 'Cartera Indexada',
          data: simValues,
          borderColor: 'rgba(6, 182, 212, 1)',
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 6,
          borderWidth: 2,
          borderDash: [5, 5]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: text, usePointStyle: true, boxWidth: 6, font: { weight: '600' } }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => {
              const val = context.parsed.y;
              return `${context.dataset.label}: ${sym}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
          grid: { display: false },
          ticks: { color: text, font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: grid },
          ticks: {
            color: text,
            font: { size: 10 },
            callback: (value) => sym + value.toLocaleString()
          }
        }
      }
    }
  });
}
