import './style.css';
import { searchSymbol, getQuote, getChart, getMultipleQuotes, isMarketOpen, getFinancials, getLogoUrl, getEvents, getDividends, getExchangeRates, getNews, getTrendingTickers, getHistoricalExchangeRate, getTrendingSymbols, getScreenerSymbols, getStockDeepDetails } from './api.js';
import {
  initPortfolio, getPortfolios, getActivePortfolioId, setActivePortfolioId, addPortfolio, renamePortfolio, deletePortfolio,
  getPositions, getTransactionHistory, getAllTimeSymbols, addPosition, removeAllPositionsForSymbol, sellPosition, recordDividendTransaction,
  getPortfolioStats, recordSnapshot, syncTransactionsWithPositions, getActivePortfolio, getWatchlist, addToWatchlist, removeFromWatchlist
} from './store.js';
import {
  createPerformanceChart, createPortfolioChart, createAllocationChart, createHistoricalAllocationChart,
  createGainLossChart, createIndividualChart, createMiniChart, createFinancialCharts,
  createCompoundChart, createDoughnutChart, createHorizontalBarChart, createBenchmarkLineChart
} from './charts.js';
import {
  isAuthenticated, getSession, login, register, logout, verifyEmail, resendVerificationCode, approveUser, verifyLicense, deleteAccount,
  getAllUsers, adminDeleteUser, requestPasswordReset, confirmPasswordReset, supabase
} from './auth.js';
import { translations } from './translations.js';

// ===== Global Utilities =====
let currentLang = localStorage.getItem('aegis_lang') || 'es';

function t(key) {
  return translations[currentLang]?.[key] || key;
}

function updateUILanguage() {
  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.dataset.t;
    el.textContent = t(key);
  });
  
  // Specific UI updates
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.placeholder = t('search_placeholder');

  const marketText = document.querySelector('.market-status span');
  if (marketText) {
    marketText.textContent = isMarketOpen() ? t('market_open') : t('market_closed');
  }

  // Update language buttons active state
  document.querySelectorAll('.lang-btn').forEach(btn => {
    if (btn.dataset.lang === currentLang) {
      btn.style.color = 'var(--text-primary)';
      btn.style.fontWeight = '700';
    } else {
      btn.style.color = 'var(--text-muted)';
      btn.style.fontWeight = '400';
    }
  });
  
  if (currentStats) {
    renderDashboard(currentStats);
    renderPortfolioChart(currentStats, currentRange);
    if (currentView === 'holdings') renderHoldings();
    if (currentView === 'discover') renderDiscover();
  }
}
function updateWlBtnState(btn, isWatched) {
  if (!btn) return;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="${isWatched ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
  btn.style.color = isWatched ? '#6366f1' : 'var(--text-muted)';
  if (isWatched) {
    btn.style.background = 'rgba(99, 102, 241, 0.1)';
    btn.style.borderColor = 'rgba(99, 102, 241, 0.2)';
  } else {
    btn.style.background = 'rgba(255, 255, 255, 0.05)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
  }
}

window.handleLogoError = (img, symbol) => {
  if (img.dataset.step === "2") return;
  const clean = symbol ? symbol.split('.')[0].toUpperCase() : '';
  
  if (!img.dataset.step) {
    img.dataset.step = "1";
    // Try Google as first fallback
    img.src = `https://www.google.com/s2/favicons?domain=${clean.toLowerCase()}.com&sz=128`;
    return;
  }
  
  if (img.dataset.step === "1") {
    img.dataset.step = "2";
    // Last resort FMP
    img.src = `https://financialmodelingprep.com/image-stock/${clean}.png`;
  }
};

// ===== State =====
let currentView = 'dashboard';
let currentStats = null;
let currentQuotes = {};
let chartDataCache = {};
let selectedStock = null;
let detailSymbol = null;
let detailMaxShares = 0;
let searchTimeout = null;
let refreshInterval = null;
let stockDetailsCache = {};
let currentRange = '3mo';
let displayCurrency = localStorage.getItem('pv_display_currency') || 'USD';
let fxRates = {}; // rates FROM USD to other currencies
let allocationChartType = 'donut'; // 'donut' or 'temporal'

// ===== Formatters =====
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: '₣', CAD: 'C$', AUD: 'A$' };
const getCurrSym = (cur) => CURRENCY_SYMBOLS[cur] || cur + ' ';

const fmt = (v, cur) => {
  if (v == null || isNaN(v)) return getCurrSym(cur || displayCurrency) + '0.00';
  const sym = getCurrSym(cur || displayCurrency);
  return (v < 0 ? '-' + sym : sym) + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtPct = (v) => {
  if (v == null || isNaN(v)) return '0.00%';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
};

const fmtSign = (v, cur) => {
  if (v == null || isNaN(v)) return getCurrSym(cur || displayCurrency) + '0.00';
  const sym = getCurrSym(cur || displayCurrency);
  return (v >= 0 ? '+' : '-') + sym + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ===== Currency Conversion Helpers =====
function convertToUSD(val, from) {
  if (!from || from === 'USD') return val;
  const rate = fxRates[from.toLowerCase()];
  if (!rate) return val;
  return val / rate;
}

function convertFromUSD(val, to) {
  if (!to || to === 'USD') return val;
  const rate = fxRates[to.toLowerCase()];
  if (!rate) return val;
  return val * rate;
}

function convertToDisplay(val, from) {
  const usd = convertToUSD(val, from);
  return convertFromUSD(usd, displayCurrency);
}

const fmtBig = (v) => {
  if (v == null) return '-';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  return '$' + v.toLocaleString();
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  setupAuth();
  updateUILanguage();

  // Check for admin approval via URL (?approve=base64_email)
  const urlParams = new URLSearchParams(window.location.search);
  const approveEmailB64 = urlParams.get('approve');
  if (approveEmailB64) {
    try {
      const email = atob(approveEmailB64);
      const session = getSession();
      
      // Si ya es admin, aprobamos. Si no, guardamos para después del login.
      if (session && session.email === 'joanwilke86@gmail.com') {
        handleAdminApproval(email);
      } else {
        sessionStorage.setItem('pending_approval_email', email);
        showToast('Inicia sesión como admin para completar la aprobación', 'info');
      }
    } catch (e) {
      console.error('Invalid approval link');
    }
  }

  if (isAuthenticated()) {
    enterApp();
  }
});

// Esta función se llama después de cualquier login exitoso
export function checkPostLoginActions() {
  const pendingEmail = sessionStorage.getItem('pending_approval_email');
  const session = getSession();
  
  if (pendingEmail && session && session.email === 'joanwilke86@gmail.com') {
    sessionStorage.removeItem('pending_approval_email');
    handleAdminApproval(pendingEmail);
  }
}

async function handleAdminApproval(email) {
  console.log('[ADMIN] Intentando aprobar usuario:', email);
  showToast(`Procesando aprobación de ${email}...`, 'info');
  
  try {
    const result = await approveUser(email);
    if (result.success) {
      showToast(`¡Usuario ${email} aprobado con éxito!`, 'success');
      console.log('[ADMIN] Aprobación completada.');
    } else {
      showToast(result.error || 'No se pudo aprobar el usuario', 'error');
    }
  } catch (err) {
    showToast('Error de conexión al aprobar', 'error');
  } finally {
    // Limpiar la URL
    const url = new URL(window.location.href);
    url.searchParams.delete('approve');
    window.history.replaceState({}, document.title, url.pathname);
  }
}

function enterApp() {
  const session = getSession();
  window.isAdmin = session && session.email === 'joanwilke86@gmail.com';

  // Hide auth
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-header').style.display = '';

  // Actualizar info del usuario en la cabecera
  if (session) {
    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-dropdown-name');
    const emailEl = document.getElementById('user-dropdown-email');
    
    if (avatarEl) avatarEl.textContent = session.avatar || session.name.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = session.name;
    if (emailEl) emailEl.textContent = session.email;
  }

  // Asegurar que el contenedor principal esté visible
  document.getElementById('main-content').style.display = '';

  if (window.isAdmin) {
    // Modo Admin: Ocultar navegación y vistas normales
    const nav = document.querySelector('.header-nav');
    if (nav) nav.style.visibility = 'hidden';
    document.getElementById('btn-add-position').style.display = 'none';
    document.getElementById('portfolio-selector-container').style.display = 'none';
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById('admin-panel').style.display = 'block';
    setupAdminPanel();
  } else {
    // Modo Cliente: Mostrar navegación y vistas normales
    const nav = document.querySelector('.header-nav');
    if (nav) nav.style.visibility = 'visible';
    document.getElementById('btn-add-position').style.display = 'flex';
    document.getElementById('portfolio-selector-container').style.display = 'flex';
    document.getElementById('admin-panel').style.display = 'none';
    document.querySelectorAll('.view').forEach(v => v.style.display = ''); 
    
    const activeView = document.querySelector('.nav-btn.active')?.dataset.view || 'dashboard';
    switchView(activeView);
    initPortfolio();
  }

  // Currency selector
  const currencySelect = document.getElementById('currency-selector');
  if (currencySelect) {
    currencySelect.value = displayCurrency;
    currencySelect.addEventListener('change', async (e) => {
      displayCurrency = e.target.value;
      localStorage.setItem('pv_display_currency', displayCurrency);
      // Re-fetch FX rates for new currency and re-render
      await loadFxRates();
      if (currentStats) {
        renderDashboard(currentStats);
        renderPortfolioChart(currentStats, currentRange);
        if (currentView === 'holdings') renderHoldings();
      }
    });
  }

  // Allocation Chart Toggle
  const btnToggleAlloc = document.getElementById('btn-toggle-allocation');
  if (btnToggleAlloc) {
    btnToggleAlloc.addEventListener('click', async () => {
      allocationChartType = allocationChartType === 'donut' ? 'temporal' : 'donut';
      btnToggleAlloc.textContent = allocationChartType === 'donut' ? 'Evolución Temporal' : 'Vista Actual';
      if (currentStats) {
        if (allocationChartType === 'temporal') {
          btnToggleAlloc.innerHTML = '<div class="loading-spinner" style="width:12px; height:12px; border-width:2px;"></div>';
          await loadChartData(getAllTimeSymbols(), 'max');
          btnToggleAlloc.textContent = 'Vista Actual';
        }
        renderDashboard(currentStats);
        renderPortfolioChart(currentStats, currentRange);
      }
    });
  }

  setupNav();
  setupAddModal();
  setupDetailModal();
  setupSellModal();
  setupHoldings();
  setupUserMenu();
  setupPortfolios();
  setupDiscover();
  setupTheme();
  setupCalculator();
  setupDiversification();
  setupTaxSimulator();
  setupBenchmark();
  updateMarketStatus();
  refreshPortfolio();

  // Auto-refresh every 60 seconds
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    refreshPortfolio();
    updateMarketStatus();
  }, 60000);
}

// ===== Auth =====
function setupAuth() {
  const loginForm = document.getElementById('form-login');
  const registerForm = document.getElementById('form-register');
  const verifyForm = document.getElementById('form-verify');
  const licenseForm = document.getElementById('form-license');
  const pendingScreen = document.getElementById('screen-pending-approval');
  const authTabs = document.querySelector('.auth-tabs');
  
  const loginError = document.getElementById('login-error');
  const registerError = document.getElementById('register-error');
  const verifyError = document.getElementById('verify-error');
  const licenseError = document.getElementById('license-error');

  let pendingEmail = '';

  if (!isAuthenticated()) {
    document.getElementById('app-header').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';
  }

  const hideAllForms = () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    verifyForm.style.display = 'none';
    licenseForm.style.display = 'none';
    pendingScreen.style.display = 'none';
    document.getElementById('form-reset-request').style.display = 'none';
    document.getElementById('form-reset-confirm').style.display = 'none';
    authTabs.style.display = 'none';
  };

  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      hideAllForms();
      authTabs.style.display = 'flex';
      loginForm.style.display = isLogin ? 'block' : 'none';
      registerForm.style.display = isLogin ? 'none' : 'block';
    });
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = loginForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Verificando...</span>';
    btn.disabled = true;

    const result = await login(email, password);
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (result.success) {
      loginError.style.display = 'none';
      enterApp();
      checkPostLoginActions();
      showToast('Sesión iniciada', 'success');
    } else {
      if (result.status) {
        pendingEmail = email;
        if (result.status === 'pending_email') showVerificationScreen();
        else if (result.status === 'pending_approval') showPendingApprovalScreen();
        else if (result.status === 'pending_license') showLicenseScreen();
      }
      loginError.textContent = result.error;
      loginError.style.display = 'block';
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const btn = registerForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Enviando...</span>';
    btn.disabled = true;

    const result = await register(name, email, password);
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (result.success) {
      if (result.admin) {
        enterApp();
        showToast('Admin activado', 'success');
      } else {
        registerError.style.display = 'none';
        pendingEmail = email;
        showVerificationScreen();
        showToast('Código enviado', 'success');
      }
    } else {
      registerError.textContent = result.error;
      registerError.style.display = 'block';
    }
  });

  verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('verify-code').value;
    const btn = verifyForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Validando...</span>';
    btn.disabled = true;

    const result = await verifyEmail(pendingEmail, code);
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (result.success) {
      verifyError.style.display = 'none';
      showPendingApprovalScreen();
      showToast('Email verificado', 'success');
    } else {
      verifyError.textContent = result.error;
      verifyError.style.display = 'block';
    }
  });

  licenseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('license-code').value;
    const btn = licenseForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Activando...</span>';
    btn.disabled = true;

    const result = await verifyLicense(pendingEmail, code);
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (result.success) {
      licenseError.style.display = 'none';
      enterApp();
      showToast('¡Cuenta activada!', 'success');
    } else {
      licenseError.textContent = result.error;
      licenseError.style.display = 'block';
    }
  });

  document.getElementById('btn-show-reset').addEventListener('click', () => {
    hideAllForms();
    authTabs.style.display = 'none';
    document.getElementById('form-reset-request').style.display = 'block';
  });

  const resetRequestForm = document.getElementById('form-reset-request');
  resetRequestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reset-email').value;
    const btn = resetRequestForm.querySelector('button[type="submit"]');
    const errorEl = document.getElementById('reset-request-error');
    
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Enviando...</span>';
    btn.disabled = true;

    const result = await requestPasswordReset(email);
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (result.success) {
      errorEl.style.display = 'none';
      pendingEmail = email;
      hideAllForms();
      document.getElementById('form-reset-confirm').style.display = 'block';
      showToast('Código enviado a tu email', 'success');
    } else {
      errorEl.textContent = result.error;
      errorEl.style.display = 'block';
    }
  });

  const resetConfirmForm = document.getElementById('form-reset-confirm');
  resetConfirmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('reset-code').value;
    const newPassword = document.getElementById('reset-new-password').value;
    const btn = resetConfirmForm.querySelector('button[type="submit"]');
    const errorEl = document.getElementById('reset-confirm-error');

    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Actualizando...</span>';
    btn.disabled = true;

    const result = await confirmPasswordReset(pendingEmail, code, newPassword);
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (result.success) {
      errorEl.style.display = 'none';
      showToast('Contraseña actualizada con éxito', 'success');
      hideAllForms();
      authTabs.style.display = 'flex';
      document.getElementById('tab-login').click();
    } else {
      errorEl.textContent = result.error;
      errorEl.style.display = 'block';
    }
  });

  document.querySelectorAll('.btn-back-to-login, #btn-verify-back').forEach(btn => {
    btn.addEventListener('click', () => {
      hideAllForms();
      authTabs.style.display = 'flex';
      document.getElementById('tab-login').click();
    });
  });

  document.getElementById('btn-resend-code').addEventListener('click', async () => {
    if (!pendingEmail) return;
    const btn = document.getElementById('btn-resend-code');
    btn.textContent = 'Enviando...';
    const result = await resendVerificationCode(pendingEmail);
    btn.textContent = '¿No has recibido el código? Reenviar';
    if (result.success) showToast('Nuevo código enviado', 'success');
    else showToast(result.error, 'error');
  });

  document.querySelectorAll('.btn-delete-test-account').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!pendingEmail) {
        showToast('No hay email pendiente para eliminar', 'error');
        return;
      }
      if (confirm('¿Seguro que quieres eliminar esta cuenta y empezar de nuevo?')) {
        const result = await deleteAccount(pendingEmail);
        if (result.success) {
          showToast('Cuenta eliminada. Ya puedes registrarte de nuevo.', 'success');
          hideAllForms();
          authTabs.style.display = 'flex';
          document.getElementById('tab-register').click();
        } else {
          showToast(result.error, 'error');
        }
      }
    });
  });

  function showVerificationScreen() {
    hideAllForms();
    verifyForm.style.display = 'block';
    document.getElementById('verify-code').value = '';
    document.getElementById('verify-code').focus();
  }

  let approvalPollInterval;
  function startApprovalPolling(email) {
    if (approvalPollInterval) clearInterval(approvalPollInterval);
    approvalPollInterval = setInterval(async () => {
      const { data: user } = await supabase
        .from('app_users')
        .select('status')
        .eq('email', email.toLowerCase().trim())
        .single();
      
      if (user && user.status === 'pending_license') {
        clearInterval(approvalPollInterval);
        showLicenseScreen();
        showToast('¡Tu solicitud ha sido aprobada!', 'success');
      }
    }, 5000);
  }

  function showPendingApprovalScreen() {
    hideAllForms();
    authTabs.style.display = 'none';
    document.getElementById('screen-pending-approval').style.display = 'block';
    if (pendingEmail) startApprovalPolling(pendingEmail);
  }

  function showLicenseScreen() {
    hideAllForms();
    licenseForm.style.display = 'block';
  }
}

// ===== User Menu =====
function setupUserMenu() {
  const avatarBtn = document.getElementById('user-avatar-btn');
  const dropdown = document.getElementById('user-dropdown');

  avatarBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === 'block';
    dropdown.style.display = isOpen ? 'none' : 'block';
  });

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
  });
  dropdown?.addEventListener('click', (e) => e.stopPropagation());

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    if (refreshInterval) clearInterval(refreshInterval);
    logout();
    // Reset state
    currentStats = null;
    currentQuotes = {};
    chartDataCache = {};
    // Show auth screen
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-header').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';
    dropdown.style.display = 'none';
    // Clear form fields
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').style.display = 'none';
  });

  // Theme Toggle
  const themeBtn = document.getElementById('btn-toggle-theme');
  themeBtn?.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('pv_theme', isLight ? 'light' : 'dark');
    updateThemeUI(isLight);
    
    // Re-render charts with new theme colors
    if (currentStats) {
      renderDashboard(currentStats);
      renderPortfolioChart(currentStats, currentRange);
    }
  });

  // Language Toggle
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentLang = btn.dataset.lang;
      localStorage.setItem('aegis_lang', currentLang);
      updateUILanguage();
    });
  });
}

function setupTheme() {
  const savedTheme = localStorage.getItem('pv_theme');
  const isLight = savedTheme === 'light';
  if (isLight) {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
  updateThemeUI(isLight);
}

function updateThemeUI(isLight) {
  const text = document.getElementById('theme-text');
  const sunIcon = document.querySelector('#btn-toggle-theme .sun-icon');
  const moonIcon = document.querySelector('#btn-toggle-theme .moon-icon');
  
  if (text) text.textContent = isLight ? 'Modo oscuro' : 'Modo claro';
  if (sunIcon && moonIcon) {
    sunIcon.style.display = isLight ? 'none' : 'block';
    moonIcon.style.display = isLight ? 'block' : 'none';
  }
}


// ===== Navigation =====
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
    });
  });

  // Global News Tabs Toggle
  document.querySelectorAll('#global-news-tabs .detail-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#global-news-tabs .detail-tab').forEach(t => {
        t.classList.remove('active');
        t.style.borderColor = 'transparent';
        t.style.background = 'transparent';
        t.style.color = 'var(--text-muted)';
      });
      const activeTab = e.target;
      activeTab.classList.add('active');
      activeTab.style.borderColor = 'var(--border-card)';
      activeTab.style.background = 'var(--bg-card)';
      activeTab.style.color = 'var(--text-primary)';
      document.getElementById('search-news-input').value = '';
      renderGlobalNews(activeTab.dataset.newsType);
    });
  });

  const searchNewsInput = document.getElementById('search-news-input');
  let newsSearchTimeout = null;
  searchNewsInput?.addEventListener('input', (e) => {
    clearTimeout(newsSearchTimeout);
    newsSearchTimeout = setTimeout(() => {
      const val = e.target.value.trim();
      if (val) {
        document.querySelectorAll('#global-news-tabs .detail-tab').forEach(t => {
          t.classList.remove('active');
          t.style.borderColor = 'transparent';
          t.style.background = 'transparent';
          t.style.color = 'var(--text-muted)';
        });
        renderGlobalNews('search', val);
      } else {
        document.querySelector('#global-news-tabs .detail-tab[data-news-type="portfolio"]')?.click();
      }
    }, 500);
  });
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'holdings') renderHoldings();
  if (view === 'news') {
    const activeTab = document.querySelector('#global-news-tabs .detail-tab.active');
    const searchVal = document.getElementById('search-news-input')?.value.trim();
    if (searchVal) {
      renderGlobalNews('search', searchVal);
    } else {
      renderGlobalNews(activeTab ? activeTab.dataset.newsType : 'portfolio');
    }
  }
  if (view === 'discover') initDiscoverData();
    if (view === 'tools') {
    // Tools view is static for now, no special init needed
  }
}

// ===== Benchmark Tool =====
function setupBenchmark() {
  const btnOpen = document.getElementById('btn-open-benchmark');
  const btnClose = document.getElementById('modal-close-benchmark');
  const modal = document.getElementById('modal-benchmark');
  const indexSelect = document.getElementById('benchmark-index');
  const btnRepair = document.getElementById('btn-repair-bench');

  btnOpen?.addEventListener('click', () => {
    modal.style.display = 'flex';
    runMarketBenchmark();
  });

  btnClose?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  indexSelect?.addEventListener('change', () => {
    runMarketBenchmark();
  });

  const benchTf = document.getElementById('bench-timeframe');
  benchTf?.addEventListener('click', (e) => {
    if (e.target.classList.contains('tf-btn')) {
      benchTf.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      runMarketBenchmark();
    }
  });

  btnRepair?.addEventListener('click', () => {
    if (confirm('¿Quieres limpiar el historial de transacciones de activos que ya no tienes? Esto arreglará errores en el gráfico.')) {
      const cleaned = syncTransactionsWithPositions();
      if (cleaned) {
        showToast('Historial reparado con éxito', 'success');
        runMarketBenchmark();
      } else {
        showToast('Tu historial ya está sincronizado', 'info');
      }
    }
  });
}

async function runMarketBenchmark() {
  const modal = document.getElementById('modal-benchmark');
  const listEl = document.getElementById('bench-details-list');
  const verdictEl = document.getElementById('bench-verdict');
  const indexSymbol = document.getElementById('benchmark-index').value || 'SPY';
  
  const rangeBtn = document.querySelector('#bench-timeframe .tf-btn.active');
  const benchRange = rangeBtn ? rangeBtn.dataset.range : '1y';
  
  if (!modal || modal.style.display === 'none') return;

  listEl.innerHTML = '<div class="loading-spinner"></div> Generando Cartera Virtual...';
  verdictEl.innerHTML = '';

  try {
    // 1. EXACT REAL PORTFOLIO (Clone from Dashboard or Fetch)
    if (!currentStats) {
      listEl.innerHTML = 'Error: No hay datos en el Dashboard. Carga tu cartera primero.';
      return;
    }

    const realTotalValue = displayCurrency === 'EUR' ? currentStats.totalValueEUR : currentStats.totalValue;
    
    // Recalculate invested total and gain % using the same logic as renderDashboard for currency parity
    let cvtTotalValue = 0, cvtTotalInvested = 0;
    for (const h of currentStats.holdings) {
      const cur = h.currency || 'USD';
      cvtTotalValue += convertToDisplay(h.currentValue, cur);
      if (displayCurrency === 'EUR') {
        cvtTotalInvested += h.investedEUR || convertToDisplay(h.invested, cur);
      } else {
        cvtTotalInvested += convertToDisplay(h.invested, cur);
      }
    }
    const realTotalInvested = cvtTotalInvested;
    const realGainPct = cvtTotalInvested > 0 ? ((cvtTotalValue - cvtTotalInvested) / cvtTotalInvested) * 100 : 0;

    let chartHoldings = currentStats.holdings;
    if (getActivePortfolioId() === 'all') {
      const allPositions = getPositions();
      const grouped = {};
      for (const pos of allPositions) {
        if (!grouped[pos.symbol]) {
          grouped[pos.symbol] = { symbol: pos.symbol, shares: 0, quote: currentQuotes[pos.symbol] || { currency: pos.purchaseCurrency || 'USD' } };
        }
        grouped[pos.symbol].shares += pos.shares;
      }
      chartHoldings = Object.values(grouped);
    }

    // Ensure we have chart data for the selected benchRange
    const dataMap = {};
    const missingSymbols = [];
    chartHoldings.forEach((h) => {
      const key = `${h.symbol}_${benchRange}`;
      if (chartDataCache[key]) {
        dataMap[h.symbol] = chartDataCache[key];
      } else {
        missingSymbols.push(h.symbol);
      }
    });

    if (missingSymbols.length > 0) {
      listEl.innerHTML = '<div class="loading-spinner"></div> Descargando datos históricos para ' + benchRange + '...';
      const fetchedData = await Promise.all(missingSymbols.map(s => getChart(s, benchRange)));
      missingSymbols.forEach((s, i) => {
        if (fetchedData[i]) {
          const key = `${s}_${benchRange}`;
          chartDataCache[key] = fetchedData[i];
          dataMap[s] = fetchedData[i];
        }
      });
    }

    let maxPoints = 0;
    let baseSymbol = null;
    for (const h of chartHoldings) {
      const cd = dataMap[h.symbol];
      if (cd && cd.points.length > maxPoints) {
        maxPoints = cd.points.length;
        baseSymbol = h.symbol;
      }
    }

    if (!baseSymbol) {
      listEl.innerHTML = '<p style="color:var(--text-muted)">Error al cargar datos históricos.</p>';
      return;
    }

    const baseData = dataMap[baseSymbol];
    const chartLabelsMs = baseData.points.map(p => p.time < 1e11 ? p.time * 1000 : p.time);

    const realSeries = [];
    const currentRealShares = {}; 
    let txIdxReal = 0;

    // We need all transactions for the symbols currently in the portfolio
    const activeSymbols = chartHoldings.map(h => h.symbol);
    const allTransactions = getTransactionHistory()
      .filter(t => activeSymbols.includes(t.symbol))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    chartLabelsMs.forEach((ts, i) => {
      // Update real share counts based on transactions up to this date
      while (txIdxReal < allTransactions.length && new Date(allTransactions[txIdxReal].date).getTime() <= ts) {
        const tx = allTransactions[txIdxReal];
        const rawType = (tx.type || '').toUpperCase();
        const isBuy = rawType === 'BUY' || rawType === 'COMPRA';
        if (!currentRealShares[tx.symbol]) currentRealShares[tx.symbol] = 0;
        currentRealShares[tx.symbol] += isBuy ? tx.shares : -Math.abs(tx.shares);
        txIdxReal++;
      }

      let total = 0;
      for (const h of chartHoldings) {
        const sharesAtTs = currentRealShares[h.symbol] || 0;
        if (sharesAtTs <= 0) continue;

        const cur = h.quote?.currency || 'USD';
        const cd = dataMap[h.symbol];
        let price = 0;
        if (cd && cd.points[i]) price = cd.points[i].close;
        else if (cd && cd.points.length > 0) {
          const idx = Math.min(i, cd.points.length - 1);
          price = cd.points[idx].close;
        } else {
          price = currentQuotes[h.symbol]?.price || 0;
        }
        total += convertToDisplay(sharesAtTs * price, cur);
      }
      realSeries.push(total);
    });

    // 2. VIRTUAL PORTFOLIO (Shadow Cash Flows)
    const transactions = [...allTransactions]; // Reuse the same sorted transactions

    // We need 'max' index data to get prices for old transactions, and benchRange for the daily chart
    const [indexDataMax, indexDataRange] = await Promise.all([
      getChart(indexSymbol, 'max'),
      getChart(indexSymbol, benchRange)
    ]);
    
    if (!indexDataMax || !indexDataMax.points.length || !indexDataRange || !indexDataRange.points.length) {
      throw new Error('No index data found');
    }

    const getIndexPriceAtDate = (dateStr) => {
      const targetTime = new Date(dateStr).getTime();
      let price = indexDataMax.points[0].close;
      for (const p of indexDataMax.points) {
        const ptTime = p.time < 1e11 ? p.time * 1000 : p.time;
        if (ptTime > targetTime + 86400000) break; // 1 day buffer
        price = p.close;
      }
      return price;
    };

    let currentVirtualShares = 0;
    let currentVirtualInvested = 0;
    let txIdx = 0;
    const lotHistory = [];

    const processVirtualTransaction = (t) => {
      const rawType = (t.type || '').toUpperCase();
      const isBuy = rawType === 'BUY' || rawType === 'COMPRA';
      const absShares = Math.abs(t.shares);
      
      const assetCur = currentQuotes[t.symbol]?.currency || 'USD';
      const fiatAmountDisplay = convertToDisplay(absShares * t.price, assetCur);
      const fiatAmountUSD = convertToUSD(fiatAmountDisplay, displayCurrency);
      
      const idxPrice = getIndexPriceAtDate(t.date);
      const virtualSharesDelta = fiatAmountUSD / idxPrice;

      if (isBuy) {
        currentVirtualShares += virtualSharesDelta;
        currentVirtualInvested += fiatAmountDisplay;
      } else {
        currentVirtualShares -= virtualSharesDelta;
        currentVirtualInvested -= fiatAmountDisplay;
      }

      lotHistory.push({
        date: t.date,
        type: isBuy ? 'buy' : 'sell',
        symbol: t.symbol,
        fiatDisplay: fiatAmountDisplay,
        virtualSharesDelta: virtualSharesDelta,
        idxPrice: idxPrice
      });
    };

    // Pre-process transactions before the chart starts
    const chartStartTime = chartLabelsMs[0];
    while (txIdx < transactions.length && new Date(transactions[txIdx].date).getTime() < chartStartTime) {
      processVirtualTransaction(transactions[txIdx]);
      txIdx++;
    }

    const simSeries = [];
    chartLabelsMs.forEach((ts) => {
      // Process transactions that occurred on or before this day
      while (txIdx < transactions.length && new Date(transactions[txIdx].date).getTime() <= ts) {
        processVirtualTransaction(transactions[txIdx]);
        txIdx++;
      }

      // Find index price at this exact chart tick using DAILY indexDataRange
      let idxPriceAtTick = indexDataRange.points[0].close;
      for (const p of indexDataRange.points) {
        const ptTime = p.time < 1e11 ? p.time * 1000 : p.time;
        if (ptTime > ts + 86400000) break;
        idxPriceAtTick = p.close;
      }

      const virtualValueUSD = currentVirtualShares * idxPriceAtTick;
      const virtualValueDisplay = convertFromUSD(virtualValueUSD, displayCurrency);
      simSeries.push(virtualValueDisplay);
    });

    // 3. UI RENDERING
    const finalRealValue = realSeries[realSeries.length - 1];
    const finalRealGainPct = realTotalInvested > 0 ? ((finalRealValue - realTotalInvested) / realTotalInvested) * 100 : 0;
    
    const finalVirtualValue = simSeries[simSeries.length - 1];
    const finalVirtualInvested = Math.max(0.01, currentVirtualInvested);
    const virtualGainPct = ((finalVirtualValue - finalVirtualInvested) / finalVirtualInvested) * 100;

    document.getElementById('bench-real-value').textContent = fmt(finalRealValue);
    document.getElementById('bench-real-gain').textContent = fmtPct(realGainPct);
    
    document.getElementById('bench-index-value').textContent = fmt(finalVirtualValue);
    document.getElementById('bench-index-gain').textContent = fmtPct(virtualGainPct);

    const diff = realGainPct - virtualGainPct;
    verdictEl.innerHTML = diff > 0 ? 
      `<strong>¡Batiendo al mercado!</strong> Tu selección ha rendido un <strong>${diff.toFixed(2)}%</strong> más que el índice.` :
      `<strong>Coste de oportunidad:</strong> El índice habría rendido un <strong>${Math.abs(diff).toFixed(2)}%</strong> más.`;
    verdictEl.style.color = diff > 0 ? 'var(--green)' : 'var(--red)';
    verdictEl.style.background = diff > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';

    createBenchmarkLineChart('chart-benchmark-line', chartLabelsMs, realSeries, simSeries);

    // Render Breakdown Table
    let tableHTML = `
      <div style="padding: 8px 0 4px 0; font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">Cartera Virtual (Copia exacta de transacciones)</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
        <div style="font-weight: 600; font-size: 0.75rem; color: var(--text-secondary); border-bottom: 1px solid var(--border-card); padding-bottom: 4px;">Tu Movimiento Real</div>
        <div style="font-weight: 600; font-size: 0.75rem; color: var(--text-secondary); border-bottom: 1px solid var(--border-card); padding-bottom: 4px;">Robot del Índice</div>
    `;

    lotHistory.forEach(lot => {
      const dateFmt = new Date(lot.date).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
      
      let realText = '';
      let indexText = '';

      if (lot.type === 'buy') {
        realText = `
          <div style="font-size: 0.75rem; display: flex; justify-content: space-between; margin-bottom: 2px;">
            <span style="font-weight: 600;">Compra ${lot.symbol} <span style="color:var(--text-muted);font-weight:normal;">(${dateFmt})</span></span>
            <span>${fmt(lot.fiatDisplay)}</span>
          </div>
        `;
        indexText = `
          <div style="font-size: 0.75rem; display: flex; justify-content: space-between; margin-bottom: 2px;">
            <span style="font-weight: 600;">Compra Índice <span style="color:var(--text-muted);font-weight:normal;">(${dateFmt})</span></span>
            <span>${fmt(lot.fiatDisplay)}</span>
          </div>
        `;
      } else {
        realText = `
          <div style="font-size: 0.75rem; display: flex; justify-content: space-between; margin-bottom: 2px;">
            <span style="font-weight: 600; color:var(--text-secondary);">Venta ${lot.symbol} <span style="font-weight:normal;">(${dateFmt})</span></span>
            <span style="color: var(--text-muted)">-${fmt(lot.fiatDisplay)}</span>
          </div>
        `;
        indexText = `
          <div style="font-size: 0.75rem; display: flex; justify-content: space-between; margin-bottom: 2px;">
            <span style="font-weight: 600; color:var(--text-secondary);">Venta Índice <span style="font-weight:normal;">(${dateFmt})</span></span>
            <span style="color: var(--text-muted)">-${fmt(lot.fiatDisplay)}</span>
          </div>
        `;
      }

      tableHTML += `
        <div style="background: var(--bg-body); padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-card);">
          ${realText}
        </div>
        <div style="background: var(--bg-body); padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-card);">
          ${indexText}
        </div>
      `;
    });

    tableHTML += `</div>`;
    listEl.innerHTML = tableHTML;

  } catch (e) {
    console.error('Benchmark error:', e);
    listEl.innerHTML = '<p style="color:var(--red);">Error en la reconstrucción. Verifica los datos de tus activos.</p>';
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  setupBenchmark();
});
// Strip exchange suffix from symbol for better news search (e.g. VUAA.DE -> VUAA, ASML.AS -> ASML)
function stripExchangeSuffix(symbol) {
  return symbol.split('.')[0];
}

async function renderGlobalNews(type, query = '') {
  const container = document.getElementById('global-news-container');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div> <span style="color:var(--text-muted); margin-left:8px;">Cargando noticias...</span>';

  try {
    let newsList = [];
    if (type === 'search' && query) {
      // Try ticker first, then also by name if we know it
      const cleanTicker = stripExchangeSuffix(query.trim().toUpperCase());
      newsList = await getNews(cleanTicker, 20);
      // If the holding exists in our portfolio, also search by name for better results
      const holding = currentStats?.holdings?.find(h => stripExchangeSuffix(h.symbol) === cleanTicker);
      if (holding && holding.name) {
        const nameResults = await getNews(holding.name.split(' ').slice(0, 3).join(' '), 10);
        if (nameResults) newsList.push(...nameResults);
      }
      // Deduplicate
      const seen = new Set();
      newsList = newsList.filter(n => {
        if(seen.has(n.uuid)) return false;
        seen.add(n.uuid);
        return true;
      });
      newsList.sort((a, b) => (b.providerPublishTime || 0) - (a.providerPublishTime || 0));
    } else if (type === 'portfolio') {
      const positions = getPositions();
      if (positions.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);">Añade posiciones a tu portfolio para ver noticias de tus empresas.</p>';
        return;
      }
      // Build a map of unique symbols to their names
      const symbolMap = {};
      positions.forEach(p => {
        const clean = stripExchangeSuffix(p.symbol);
        if (!symbolMap[clean]) symbolMap[clean] = p.name;
      });
      // Also grab names from currentStats (which has Yahoo-fetched names)
      if (currentStats?.holdings) {
        currentStats.holdings.forEach(h => {
          const clean = stripExchangeSuffix(h.symbol);
          if (h.name) symbolMap[clean] = h.name;
        });
      }
      
      const allTickers = Object.keys(symbolMap);
      
      // Search by company NAME (not ticker) for much better results
      const searchQueries = allTickers.map(ticker => {
        const name = symbolMap[ticker];
        // Use first 3 words of name for focused search
        const shortName = name ? name.split(' ').slice(0, 3).join(' ') : ticker;
        return shortName;
      });
      
      const responses = await Promise.all(searchQueries.map(q => getNews(q, 10)));
      responses.forEach(res => { if(res) newsList.push(...res) });
      
      // Deduplicate and sort by date
      newsList.sort((a, b) => (b.providerPublishTime || 0) - (a.providerPublishTime || 0));
      const seen = new Set();
      newsList = newsList.filter(n => {
        if(seen.has(n.uuid)) return false;
        seen.add(n.uuid);
        return true;
      });
      
      // Prioritize news that mention our actual tickers in relatedTickers
      const portfolioTickers = new Set(allTickers.map(t => t.toUpperCase()));
      const relevant = [];
      const generic = [];
      for (const n of newsList) {
        const tickers = (n.relatedTickers || []).map(t => stripExchangeSuffix(t).toUpperCase());
        if (tickers.some(t => portfolioTickers.has(t))) {
          relevant.push(n);
        } else {
          generic.push(n);
        }
      }
      // Show relevant first, then fill with generic
      newsList = [...relevant, ...generic].slice(0, 60);
    } else {
      // General market: fetch trending tickers and get their news
      try {
        const trending = await getTrendingTickers(8);
        if (trending.length > 0) {
          const trendingResponses = await Promise.all(trending.slice(0, 6).map(s => getNews(stripExchangeSuffix(s), 6)));
          trendingResponses.forEach(res => { if(res) newsList.push(...res) });
          // Deduplicate
          const seen = new Set();
          newsList = newsList.filter(n => {
            if(seen.has(n.uuid)) return false;
            seen.add(n.uuid);
            return true;
          });
          newsList.sort((a, b) => (b.providerPublishTime || 0) - (a.providerPublishTime || 0));
          newsList = newsList.slice(0, 40);
        }
      } catch (e) {
        console.warn('Trending news error:', e);
      }
      // Fallback if trending returned nothing
      if (newsList.length === 0) {
        newsList = await getNews('stock market finance earnings', 20);
      }
    }

    if (!newsList || newsList.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);">No se han encontrado noticias.</p>';
      return;
    }

    container.innerHTML = newsList.map(n => {
      const thumbUrl = n.thumbnail?.resolutions?.[0]?.url;
      const imgHtml = thumbUrl ? `<img src="${thumbUrl}" alt="Thumbnail" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; flex-shrink: 0; background: rgba(255,255,255,0.05);">` : '';
      return `
        <a href="${n.link}" target="_blank" class="news-item glass-card" style="display: flex; gap: 20px; padding: 20px; text-decoration: none; color: inherit; align-items: flex-start; transition: transform 0.2s, background 0.2s;">
          ${imgHtml}
          <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="font-size: 0.85rem; color: var(--accent); margin-bottom: 8px; font-weight: 600;">${n.publisher} • ${new Date(n.providerPublishTime * 1000).toLocaleDateString()}</div>
              <h4 style="margin: 0 0 12px 0; color: var(--text-primary); font-size: 1.15rem; line-height: 1.5; font-weight: 600;">${n.title}</h4>
            </div>
            ${n.relatedTickers?.length ? `<div style="font-size: 0.8rem; color: var(--text-muted); display:flex; gap:6px; flex-wrap:wrap;">${n.relatedTickers.slice(0,5).map(t => `<span style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 4px;">${t}</span>`).join('')}</div>` : ''}
          </div>
        </a>
      `;
    }).join('');

  } catch (e) {
    console.warn('Error fetching global news:', e);
    container.innerHTML = '<p style="color:var(--text-muted);">Error al cargar las noticias.</p>';
  }
}

// ===== Market Status =====
function updateMarketStatus() {
  const el = document.getElementById('market-status');
  const open = isMarketOpen();
  el.querySelector('.status-dot').classList.toggle('open', open);
  el.querySelector('span').textContent = open ? 'Mercado abierto' : 'Mercado cerrado';
}

// ===== Toast =====
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === 'success' ? '✅' : '❌'} ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===== Refresh Portfolio =====
async function loadFxRates() {
  try {
    const rates = await getExchangeRates('usd');
    fxRates = rates;
  } catch (e) {
    console.warn('Could not load FX rates:', e);
  }
}

async function refreshPortfolio() {
  const positions = getPositions();
  if (positions.length === 0) {
    showEmptyState(true);
    return;
  }
  showEmptyState(false);

  // Load FX rates if not yet loaded
  if (Object.keys(fxRates).length === 0) {
    await loadFxRates();
  }

  // Optimistic update using existing quotes (instant UI feedback)
  currentStats = getPortfolioStats(currentQuotes || {});
  renderDashboard(currentStats);
  if (currentView === 'holdings') renderHoldings();

  const symbols = [...new Set(positions.map((p) => p.symbol))];
  try {
    currentQuotes = await getMultipleQuotes(symbols);
    currentStats = getPortfolioStats(currentQuotes);
    recordSnapshot(currentStats);
    renderDashboard(currentStats);
    if (currentView === 'holdings') renderHoldings();
  } catch (e) {
    console.error('Refresh error:', e);
  }

  // Fetch chart data separately so dashboard renders immediately
  try {
    const allSymbols = getAllTimeSymbols();
    // For the temporal allocation chart, we always need 'max' history
    if (allocationChartType === 'temporal') {
      await loadChartData(allSymbols, 'max');
    }
    await loadChartData(symbols, currentRange);
    if (currentStats) renderPortfolioChart(currentStats, currentRange);
  } catch (e) {
    console.warn('Chart data error:', e);
  }
  
  // Calculate and render accumulated dividends
  loadDividends(currentStats);
}

let dividendsCache = {};
async function loadDividends(stats) {
  let totalDividends = 0;
  try {
    const promises = stats.holdings.map(async (h) => {
      if (!dividendsCache[h.symbol]) {
        dividendsCache[h.symbol] = await getDividends(h.symbol);
      }
      const divs = dividendsCache[h.symbol];
      if (!divs) return;
      const cur = h.quote?.currency || 'USD';
      let holdingDivs = 0;
      h.entries.forEach(entry => {
        const purchaseMs = new Date(entry.purchaseDate).getTime();
        for (const key in divs) {
          const div = divs[key];
          if (div.date * 1000 >= purchaseMs) {
            holdingDivs += div.amount * entry.shares;
          }
        }
      });
      totalDividends += convertToDisplay(holdingDivs, cur);
    });
    await Promise.all(promises);
    const divEl = document.getElementById('dividends-value');
    if (divEl) divEl.textContent = fmt(totalDividends);
  } catch (e) {
    console.warn("Dividend error:", e);
  }
}

async function loadChartData(symbols, range) {
  const promises = symbols.map(async (sym) => {
    const key = `${sym}_${range}`;
    if (!chartDataCache[key]) {
      try {
        chartDataCache[key] = await getChart(sym, range);
      } catch (e) {
        console.warn(`Chart data error for ${sym}:`, e);
      }
    }
  });
  await Promise.all(promises);
}

// ===== Empty State =====
function showEmptyState(show) {
  document.getElementById('empty-state').style.display = show ? 'flex' : 'none';
  document.getElementById('summary-row').style.display = show ? 'none' : '';
  document.querySelectorAll('.charts-row').forEach((el) => {
    el.style.display = show ? 'none' : '';
  });
  if (show) {
    document.getElementById('btn-add-first')?.addEventListener('click', openAddModal);
  }
}

// ===== Render Dashboard =====
function renderDashboard(stats) {
  // Compute converted totals
  let cvtTotalValue = 0, cvtTotalInvested = 0, cvtDailyChange = 0;
  for (const h of stats.holdings) {
    const cur = h.currency || 'USD';
    cvtTotalValue += convertToDisplay(h.currentValue, cur);
    cvtDailyChange += convertToDisplay(h.dailyChange, cur);
    // For total invested: if displaying in EUR, use the stored EUR equivalent
    if (displayCurrency === 'EUR') {
      cvtTotalInvested += h.investedEUR || convertToDisplay(h.invested, cur);
    } else {
      cvtTotalInvested += convertToDisplay(h.invested, cur);
    }
  }
  const cvtGain = cvtTotalValue - cvtTotalInvested;
  const cvtGainPct = cvtTotalInvested > 0 ? (cvtGain / cvtTotalInvested) * 100 : 0;
  const cvtDailyPct = cvtTotalValue > 0 ? (cvtDailyChange / (cvtTotalValue - cvtDailyChange)) * 100 : 0;

  // Summary cards
  const totalValueEl = document.getElementById('total-value');
  totalValueEl.textContent = fmt(cvtTotalValue);
  animateValue(totalValueEl);

  document.getElementById('invested-value').textContent = fmt(cvtTotalInvested);

  const gainValueEl = document.getElementById('gain-value');
  gainValueEl.textContent = fmtSign(cvtGain);
  gainValueEl.className = 'summary-value ' + (cvtGain >= 0 ? 'positive' : 'negative');
  gainValueEl.style.color = cvtGain >= 0 ? 'var(--green)' : 'var(--red)';

  const gainPctEl = document.getElementById('gain-percent');
  gainPctEl.innerHTML = `<span class="change-percent">(${fmtPct(cvtGainPct)})</span>`;
  gainPctEl.className = 'summary-change ' + (cvtGain >= 0 ? 'positive' : 'negative');

  const totalChangeEl = document.getElementById('total-change');
  totalChangeEl.innerHTML = `
    <span class="change-amount">${fmtSign(cvtGain)}</span>
    <span class="change-percent">(${fmtPct(cvtGainPct)})</span>
  `;
  totalChangeEl.className = 'summary-change ' + (cvtGain >= 0 ? 'positive' : 'negative');

  const dailyValueEl = document.getElementById('daily-value');
  dailyValueEl.textContent = fmtSign(cvtDailyChange);
  dailyValueEl.style.color = cvtDailyChange >= 0 ? 'var(--green)' : 'var(--red)';

  const dailyPctEl = document.getElementById('daily-percent');
  dailyPctEl.innerHTML = `<span class="change-percent">(${fmtPct(cvtDailyPct)})</span>`;
  dailyPctEl.className = 'summary-change ' + (stats.totalDailyChange >= 0 ? 'positive' : 'negative');

  // When in 'all portfolios' mode, stats.holdings already contains the portfolios.
  // When in a specific portfolio, stats.holdings contains the individual stocks.
  const chartAssets = stats.holdings;

  // Allocation chart (only render donut here, temporal is rendered in renderPortfolioChart)
  const allocContainer = document.getElementById('chart-allocation-container');
  const allocLegend = document.getElementById('allocation-legend');
  
  if (allocationChartType === 'donut') {
    if (allocContainer) allocContainer.classList.add('chart-container-donut');
    if (allocLegend) allocLegend.style.display = 'flex';
    createAllocationChart('chart-allocation', chartAssets, 'allocation-legend');
  } else {
    if (allocContainer) allocContainer.classList.remove('chart-container-donut');
    if (allocLegend) allocLegend.style.display = 'none';
    // Temporal chart will be rendered by renderPortfolioChart
  }

  // Gain/loss chart
  createGainLossChart('chart-gainloss', chartAssets, displayCurrency, convertToDisplay, getCurrSym);

  // Individual performance chart
  createIndividualChart('chart-individual', chartAssets);
}

function animateValue(el) {
  el.style.transform = 'scale(1.03)';
  el.style.transition = 'transform 0.3s ease';
  setTimeout(() => { el.style.transform = 'scale(1)'; }, 300);
}

function renderPortfolioChart(stats, range) {
  let chartHoldings = stats.holdings;
  
  // If we are in 'all' portfolios mode, holdings are portfolios, not stocks.
  // The performance chart needs the actual stocks to aggregate their historical data.
  if (getActivePortfolioId() === 'all') {
    // Group all underlying positions by symbol to get actual stock holdings
    const allPositions = getPositions();
    const grouped = {};
    for (const pos of allPositions) {
      if (!grouped[pos.symbol]) {
        grouped[pos.symbol] = { 
          symbol: pos.symbol, 
          shares: 0, 
          invested: 0, 
          investedEUR: 0, 
          quote: currentQuotes[pos.symbol] || { currency: pos.purchaseCurrency || 'USD' } 
        };
      }
      grouped[pos.symbol].shares += pos.shares;
      grouped[pos.symbol].invested += pos.shares * pos.purchasePrice;
      if (pos.purchaseExchangeRate) grouped[pos.symbol].investedEUR += (pos.shares * pos.purchasePrice) / pos.purchaseExchangeRate;
      else grouped[pos.symbol].investedEUR += pos.shares * pos.purchasePrice;
    }
    chartHoldings = Object.values(grouped);
  }

  const dataMap = {};
  chartHoldings.forEach((h) => {
    const key = `${h.symbol}_${range}`;
    if (chartDataCache[key]) dataMap[h.symbol] = chartDataCache[key];
  });
  
  // Use pre-calculated totals from stats object for consistency
  const cvtTotalInvested = displayCurrency === 'EUR' ? stats.totalInvestedEUR : stats.totalInvested;

  const chartRes = createPortfolioChart('chart-performance', chartHoldings, dataMap, range, displayCurrency, convertToDisplay, cvtTotalInvested, getTransactionHistory());
  
  if (allocationChartType === 'temporal') {
    const allSymbols = getAllTimeSymbols();
    const historyDataMap = {};
    allSymbols.forEach(s => {
      const key = `${s}_max`;
      if (chartDataCache[key]) historyDataMap[s] = chartDataCache[key];
    });
    // For historical chart, we need a "holding" object even for closed positions
    const allHoldings = allSymbols.map(s => {
      const current = chartHoldings.find(h => h.symbol === s);
      if (current) return current;
      return { symbol: s, shares: 0, currentPrice: historyDataMap[s]?.points?.slice(-1)[0]?.close || 0 };
    });
    createHistoricalAllocationChart('chart-allocation', allHoldings, historyDataMap, getTransactionHistory());
  }
  
  const statsEl = document.getElementById('portfolio-chart-stats');
  if (statsEl) {
    if (chartRes && chartRes.portfolioValues && chartRes.portfolioValues.length > 0) {
      const vals = chartRes.portfolioValues;
      const first = vals[0];
      const last = vals[vals.length - 1];
      const change = last - first;
      const changePct = first > 0 ? (change / first) * 100 : 0;
      statsEl.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
      statsEl.innerHTML = `${change >= 0 ? '+' : ''}${fmt(Math.abs(change))} (${fmtPct(changePct)})`;
    } else {
      statsEl.innerHTML = '';
    }
  }
}

// ===== Performance Timeframe =====
document.getElementById('perf-timeframe')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.tf-btn');
  if (!btn) return;
  document.querySelectorAll('#perf-timeframe .tf-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentRange = btn.dataset.range;

  if (currentStats) {
    let symbols = [];
    if (getActivePortfolioId() === 'all') {
      const positions = getPositions();
      symbols = [...new Set(positions.map((p) => p.symbol))];
    } else {
      symbols = [...new Set(currentStats.holdings.map((h) => h.symbol))];
    }
    
    await loadChartData(symbols, currentRange);
    renderPortfolioChart(currentStats, currentRange);
  }
});

// ===== Holdings View =====
function setupHoldings() {
  document.getElementById('search-holdings-input')?.addEventListener('input', () => renderHoldings());
  document.getElementById('sort-holdings-select')?.addEventListener('change', () => renderHoldings());
}

function renderHoldings() {
  if (!currentStats) return;
  const grid = document.getElementById('holdings-grid');
  const search = document.getElementById('search-holdings-input')?.value?.toLowerCase() || '';
  const sort = document.getElementById('sort-holdings-select')?.value || 'value-desc';

  let holdings = currentStats.holdings.filter((h) =>
    h.symbol.toLowerCase().includes(search) || h.name.toLowerCase().includes(search)
  );

  const sortFns = {
    'value-desc': (a, b) => b.currentValue - a.currentValue,
    'value-asc': (a, b) => a.currentValue - b.currentValue,
    'gain-desc': (a, b) => b.gainPercent - a.gainPercent,
    'gain-asc': (a, b) => a.gainPercent - b.gainPercent,
    'name-asc': (a, b) => a.symbol.localeCompare(b.symbol),
  };
  holdings.sort(sortFns[sort] || sortFns['value-desc']);

  grid.innerHTML = holdings.map((h) => {
    const cur = h.quote?.currency || 'USD';
    const isForex = cur !== displayCurrency;
    const cvtValue = convertToDisplay(h.currentValue, cur);
    const cvtInvested = convertToDisplay(h.invested, cur);
    const cvtGain = cvtValue - cvtInvested;
    const logoHtml = h.isPortfolio
      ? ''
      : `<img src="${getLogoUrl(h.symbol, h.quote)}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: contain; background: transparent; padding: 0; filter: drop-shadow(0 0 3px rgba(255,255,255,0.4));" onerror="window.handleLogoError(this, '${h.symbol}')">`;

    return `
    <div class="holding-card glass-card" data-symbol="${h.symbol}" data-id="${h.id}">
      <div class="holding-card-header">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${logoHtml}
          <div>
            <div class="holding-card-symbol">${h.symbol}${isForex && !h.isPortfolio ? ` <span style="font-size:0.65rem; padding:2px 5px; background:rgba(99,102,241,0.2); border-radius:4px; font-weight:600; color:var(--accent); vertical-align:middle;">${cur}</span>` : ''}</div>
            <div class="holding-card-name">${h.name}</div>
          </div>
        </div>
        <div class="holding-card-price">
          <div class="price">${fmt(convertToDisplay(h.quote?.price || h.purchasePrice, cur))}</div>
          <div class="change ${h.dailyChangePercent >= 0 ? 'positive' : 'negative'}">${fmtPct(h.dailyChangePercent)} hoy</div>
        </div>
      </div>
      <div class="holding-card-chart"><canvas id="mini-${h.id}"></canvas></div>
      <div class="holding-card-stats">
        <div>
          <div class="holding-stat-label">Valor</div>
          <div class="holding-stat-value">${fmt(cvtValue)}</div>
        </div>
        <div>
          <div class="holding-stat-label">Invertido</div>
          <div class="holding-stat-value">${fmt(cvtInvested)}</div>
        </div>
        <div>
          <div class="holding-stat-label">Ganancia</div>
          <div class="holding-stat-value ${cvtGain >= 0 ? 'positive' : 'negative'}">${fmtSign(cvtGain)}</div>
        </div>
        <div>
          <div class="holding-stat-label">Retorno</div>
          <div class="holding-stat-value ${h.gainPercent >= 0 ? 'positive' : 'negative'}">${fmtPct(h.gainPercent)}</div>
        </div>
      </div>
    </div>
  `;}).join('');

  // Add click events
  grid.querySelectorAll('.holding-card').forEach((card) => {
    card.addEventListener('click', () => {
      const isPort = holdings.find(h => h.id === card.dataset.id)?.isPortfolio;
      if (isPort) {
        document.getElementById('portfolio-selector').value = card.dataset.id;
        setActivePortfolioId(card.dataset.id);
        refreshPortfolio();
      } else {
        openDetailModal(card.dataset.symbol);
      }
    });
  });

  // Render mini charts
  holdings.forEach(async (h) => {
    const canvas = document.getElementById(`mini-${h.id}`);
    if (!canvas) return;

    if (h.isPortfolio) {
      // Use portfolio history for mini-chart
      if (h.history && h.history.length >= 2) {
        const historyData = h.history.slice(-30).map(p => p.totalValue);
        createMiniChart(canvas, historyData, h.gainPercent >= 0);
      }
      return;
    }

    const key = `${h.symbol}_1mo`;
    if (!chartDataCache[key]) {
      try {
        chartDataCache[key] = await getChart(h.symbol, '1mo');
      } catch (e) { /* skip */ }
    }
    const cd = chartDataCache[key];
    if (cd) {
      const closes = cd.points.map((p) => p.close);
      createMiniChart(canvas, closes, h.gainPercent >= 0);
    }
  });
}

// ===== Add Position Modal =====
function setupAddModal() {
  document.getElementById('btn-add-position')?.addEventListener('click', openAddModal);
  document.getElementById('modal-close-add')?.addEventListener('click', closeAddModal);
  document.getElementById('btn-cancel-add')?.addEventListener('click', closeAddModal);
  document.getElementById('modal-add')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-add') closeAddModal();
  });

  const symbolInput = document.getElementById('input-symbol');
  symbolInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = symbolInput.value.trim();
    if (q.length < 1) {
      document.getElementById('search-results').style.display = 'none';
      return;
    }
    searchTimeout = setTimeout(async () => {
      const results = await searchSymbol(q);
      renderSearchResults(results);
    }, 300);
  });

  const sharesInput = document.getElementById('input-shares');
  const priceInput = document.getElementById('input-price');
  const rateInput = document.getElementById('input-exchange-rate');
  const sourceCurrencySelect = document.getElementById('select-source-currency');
  const toggleBtn = document.getElementById('btn-toggle-exchange');

  [sharesInput, priceInput, rateInput, sourceCurrencySelect].forEach((input) => {
    input?.addEventListener('input', updateFormSummary);
    input?.addEventListener('change', updateFormSummary);
  });

  toggleBtn.addEventListener('click', () => {
    const section = document.getElementById('exchange-section');
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    toggleBtn.classList.toggle('active', isHidden);
    toggleBtn.innerHTML = isHidden 
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><path d="M18 6L6 18M6 6l12 12"/></svg> Quitar cambio de divisa'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><path d="M7 16V4M7 4L3 8M7 4L11 8M17 8v12M17 20l4-4M17 20l-4-4"/></svg> Añadir cambio de divisa (Opcional)';
    updateFormSummary();
  });

  document.getElementById('btn-fetch-rate')?.addEventListener('click', fetchHistoricalRate);

  document.getElementById('btn-confirm-add')?.addEventListener('click', confirmAdd);
  document.getElementById('input-date').valueAsDate = new Date();
  
  // Set default time to now
  const now = new Date();
  document.getElementById('input-time').value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

async function fetchHistoricalRate() {
  const dateStr = document.getElementById('input-date').value;
  const timeStr = document.getElementById('input-time').value;
  const sourceCurrency = document.getElementById('select-source-currency').value;
  const targetCurrency = selectedStock?.quote?.currency || 'USD';
  const rateInput = document.getElementById('input-exchange-rate');
  const fetchBtn = document.getElementById('btn-fetch-rate');

  if (!dateStr) {
    showToast('Selecciona una fecha primero', 'error');
    return;
  }

  try {
    fetchBtn.disabled = true;
    const originalText = fetchBtn.textContent;
    fetchBtn.textContent = '...';
    
    // Combine date and time
    const dateTimeStr = timeStr ? `${dateStr}T${timeStr}` : `${dateStr}T12:00`;
    const timestamp = Math.floor(new Date(dateTimeStr).getTime() / 1000);
    
    const rate = await getHistoricalExchangeRate(sourceCurrency, targetCurrency, timestamp);
    
    if (rate) {
      rateInput.value = rate.toFixed(4);
      updateFormSummary();
      showToast('Tipo de cambio actualizado');
    } else {
      showToast('No se encontró cambio para esa fecha', 'error');
    }
  } catch (e) {
    showToast('Error al obtener cambio', 'error');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Auto';
  }
}

function openAddModal() {
  document.getElementById('modal-add').style.display = 'flex';
  document.getElementById('input-symbol').value = '';
  document.getElementById('input-shares').value = '';
  document.getElementById('input-price').value = '';
  document.getElementById('input-exchange-rate').value = '';
  document.getElementById('exchange-section').style.display = 'none';
  const toggleBtn = document.getElementById('btn-toggle-exchange');
  toggleBtn.classList.remove('active');
  toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><path d="M7 16V4M7 4L3 8M7 4L11 8M17 8v12M17 20l4-4M17 20l-4-4"/></svg> Añadir cambio de divisa (Opcional)';
  
  document.getElementById('input-date').valueAsDate = new Date();
  const now = new Date();
  document.getElementById('input-time').value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  document.getElementById('selected-stock').style.display = 'none';
  document.getElementById('form-summary').style.display = 'none';
  document.getElementById('search-results').style.display = 'none';
  document.getElementById('btn-confirm-add').disabled = true;
  document.getElementById('label-price').textContent = 'Precio de compra';
  document.getElementById('exchange-rate-help').textContent = '';
  selectedStock = null;

  setTimeout(() => document.getElementById('input-symbol')?.focus(), 100);
}

function closeAddModal() {
  document.getElementById('modal-add').style.display = 'none';
  selectedStock = null;
}

function renderSearchResults(results) {
  const el = document.getElementById('search-results');
  if (results.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
    el.innerHTML = results.map((r) => {
      const isWatched = getWatchlist().includes(r.symbol);
      return `
        <div class="search-result-item" data-symbol="${r.symbol}" data-name="${r.name}" data-type="${r.type}" style="display: flex; align-items: center; gap: 8px;">
          <img src="${getLogoUrl(r.symbol, r)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: contain; background: transparent; filter: drop-shadow(0 0 3px rgba(255,255,255,0.4));" onerror="window.handleLogoError(this, '${r.symbol}')">
          <div style="flex: 1;">
            <span class="search-result-symbol">${r.symbol}</span>
            <span class="search-result-name">${r.name}</span>
          </div>
          <button onclick="event.stopPropagation(); window.toggleWatchlist('${r.symbol}', this)" 
                  style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); width:32px; height:32px; border-radius:50%; cursor:pointer; color:${isWatched ? '#6366f1' : 'var(--text-muted)'}; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
            <svg viewBox="0 0 24 24" fill="${isWatched ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" style="width:16px; height:16px;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <span class="search-result-type">${r.type}</span>
        </div>
      `;
    }).join('');

  el.querySelectorAll('.search-result-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const sym = item.dataset.symbol;
      const name = item.dataset.name;
      el.style.display = 'none';
      document.getElementById('input-symbol').value = sym;

      try {
        const quote = await getQuote(sym);
        selectedStock = { symbol: sym, name, quote };
        document.getElementById('selected-stock').style.display = 'flex';
        document.getElementById('selected-symbol').textContent = sym;
        document.getElementById('selected-name').textContent = name;
        document.getElementById('selected-current-price').textContent = `Actual: ${fmt(quote.price)}`;
        
        // Update label with stock currency
        const tradeCurrency = quote.currency || 'USD';
        document.getElementById('label-price').textContent = `Precio de compra (${tradeCurrency})`;
        
        updateFormSummary();
        
        const logoEl = document.getElementById('selected-logo');
        if (logoEl) {
          logoEl.src = getLogoUrl(sym, quote);
          logoEl.style.display = 'block';
        }
      } catch (e) {
        selectedStock = { symbol: sym, name, quote: null };
        document.getElementById('selected-stock').style.display = 'flex';
        document.getElementById('selected-symbol').textContent = sym;
        document.getElementById('selected-name').textContent = name;
        document.getElementById('selected-current-price').textContent = 'Precio no disponible';
        document.getElementById('label-price').textContent = 'Precio de compra (USD)';
        
        const logoEl = document.getElementById('selected-logo');
        if (logoEl) {
          logoEl.src = getLogoUrl(sym, { shortName: name });
          logoEl.style.display = 'block';
        }
      }
    });
  });
}

function updateFormSummary() {
  const sharesInput = document.getElementById('input-shares');
  const priceInput = document.getElementById('input-price');
  const rateInput = document.getElementById('input-exchange-rate');
  const sourceSelect = document.getElementById('select-source-currency');
  const exchangeSection = document.getElementById('exchange-section');
  const confirmBtn = document.getElementById('btn-confirm-add');
  const rateHelp = document.getElementById('exchange-rate-help');

  const shares = parseFloat(sharesInput.value);
  const tradePrice = parseFloat(priceInput.value);

  if (!selectedStock || isNaN(shares) || isNaN(tradePrice) || shares <= 0 || tradePrice <= 0) {
    document.getElementById('form-summary').style.display = 'none';
    confirmBtn.disabled = true;
    return;
  }

  const tradeCurrency = selectedStock.quote?.currency || 'USD';
  const hasExchange = exchangeSection.style.display !== 'none';
  const sourceCurrency = sourceSelect.value;
  
  if (hasExchange) {
    rateHelp.textContent = `Indica cuántos ${tradeCurrency} recibiste por cada 1 ${sourceCurrency} al cambiar.`;
  } else {
    rateHelp.textContent = '';
  }

  const invested = shares * tradePrice;
  const currentPrice = selectedStock.quote?.price || tradePrice;
  const currentValue = shares * currentPrice;
  const gainLoss = currentValue - invested;

  document.getElementById('form-summary').style.display = 'block';
  document.getElementById('form-total-investment').textContent = `${invested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${tradeCurrency}`;
  document.getElementById('form-current-value').textContent = `${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${tradeCurrency}`;
  
  const glEl = document.getElementById('form-gain-loss');
  const glVal = gainLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  glEl.textContent = `${gainLoss >= 0 ? '+' : ''}${glVal} ${tradeCurrency}`;
  glEl.style.color = gainLoss >= 0 ? 'var(--green)' : 'var(--red)';
  confirmBtn.disabled = false;
}

async function confirmAdd() {
  if (!selectedStock) return;
  const shares = parseFloat(document.getElementById('input-shares').value);
  const tradePrice = parseFloat(document.getElementById('input-price').value);
  const date = document.getElementById('input-date').value;
  const exchangeSection = document.getElementById('exchange-section');
  
  let exchangeRate = null;
  if (exchangeSection.style.display !== 'none') {
    exchangeRate = parseFloat(document.getElementById('input-exchange-rate').value);
  }

  if (isNaN(shares) || isNaN(tradePrice) || shares <= 0 || tradePrice <= 0) return;

  const tradeCurrency = selectedStock.quote?.currency || 'USD';
  addPosition(selectedStock.symbol, selectedStock.name, shares, tradePrice, date, tradeCurrency, exchangeRate);
  
  // Clear modal and show success
  closeAddModal();
  showToast(`${selectedStock.symbol} añadido al portfolio`);
  
  // Reset caches
  chartDataCache = {};
  dividendsCache = {};
  
  // Immediate refresh without waiting for quotes if we want it to be instant
  currentStats = getPortfolioStats(currentQuotes || {});
  renderDashboard(currentStats);
  if (currentView === 'holdings') renderHoldings();

  // Then do the full refresh with live quotes
  await refreshPortfolio();
}

// ===== Detail Modal =====
function setupDetailModal() {
  document.getElementById('modal-close-detail')?.addEventListener('click', closeDetailModal);
  document.getElementById('modal-detail')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-detail') closeDetailModal();
  });
  document.getElementById('btn-delete-position')?.addEventListener('click', deleteCurrentPosition);
  document.getElementById('btn-sell-position')?.addEventListener('click', openSellModal);

  // Watchlist toggle
  document.getElementById('btn-watchlist')?.addEventListener('click', () => {
    if (!detailSymbol) return;
    const wl = getWatchlist();
    const isWatched = wl.includes(detailSymbol);
    const btn = document.getElementById('btn-watchlist');
    if (isWatched) {
      removeFromWatchlist(detailSymbol);
      updateWlBtnState(btn, false);
      showToast('Eliminado de seguimiento', 'info');
    } else {
      addToWatchlist(detailSymbol);
      updateWlBtnState(btn, true);
      showToast('Añadido a seguimiento', 'success');
    }
    // Refresh Discover watchlist section if we are on that view
    if (currentView === 'discover') {
      loadWatchlistSection();
    }
  });

  // Tab switching in detail modal
  document.querySelectorAll('.detail-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.detail-tab').forEach((t) => {
        t.classList.remove('active');
        t.style.borderColor = 'transparent';
        t.style.background = 'transparent';
        t.style.color = 'var(--text-muted)';
      });
      const activeTab = e.target;
      activeTab.classList.add('active');
      activeTab.style.borderColor = 'var(--border-card)';
      activeTab.style.background = 'var(--bg-card)';
      activeTab.style.color = 'var(--text-primary)';

      document.querySelectorAll('.detail-tab-content').forEach((content) => {
        content.style.display = 'none';
      });
      document.getElementById(`detail-tab-${activeTab.dataset.tab}`).style.display = 'block';
    });
  });

  document.getElementById('detail-timeframe')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.tf-btn');
    if (!btn || !detailSymbol) return;
    document.querySelectorAll('#detail-timeframe .tf-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    try {
      const cd = await getChart(detailSymbol, btn.dataset.range);
      const pos = getPositions().find((p) => p.symbol === detailSymbol);
      createPerformanceChart('chart-detail', cd, pos?.purchasePrice);
      updateDetailChartStats(cd);
    } catch (e) {
      console.warn('Detail chart error:', e);
    }
  });
}

function updateDetailChartStats(chartData) {
  const statsEl = document.getElementById('detail-chart-stats');
  if (!statsEl) return;
  if (!chartData || !chartData.points || chartData.points.length === 0) {
    statsEl.innerHTML = '';
    return;
  }
  const pts = chartData.points;
  const first = pts[0].close;
  const last = pts[pts.length - 1].close;
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;
  
  const cur = chartData.currency || 'USD';
  const cvtChange = convertToDisplay(change, cur);
  
  statsEl.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
  statsEl.innerHTML = `${change >= 0 ? '+' : ''}${fmt(cvtChange)} (${fmtPct(changePct)})`;
}

window.openDetailModal = async function(symbol, isDiscovery = false) {
  detailSymbol = symbol;
  const modal = document.getElementById('modal-detail');
  modal.style.display = 'flex';

  // Watchlist button state
  const wlBtn = document.getElementById('btn-watchlist');
  if (wlBtn) {
    const isWatched = getWatchlist().includes(symbol);
    updateWlBtnState(wlBtn, isWatched);
  }

  // If in discovery mode, we do NOT want to show portfolio details for this stock
  const holding = isDiscovery ? null : currentStats?.holdings.find((h) => h.symbol === symbol);
  detailMaxShares = holding ? holding.shares : 0;
  
  let quote = currentQuotes[symbol];
  if (!quote) {
    try {
      const res = await getMultipleQuotes([symbol]);
      quote = res[symbol];
    } catch(e) {
      console.warn('Could not fetch quote for modal:', e);
    }
  }

  const cur = quote?.currency || 'USD';
  const isForex = cur !== displayCurrency;

  document.getElementById('detail-symbol').textContent = symbol + (isForex ? ` (${cur})` : '');
  document.getElementById('detail-name').textContent = quote?.name || holding?.name || symbol;

  const logoEl = document.getElementById('detail-logo');
  if (logoEl) {
    logoEl.src = getLogoUrl(symbol, quote || holding?.quote || { shortName: holding?.name });
    logoEl.style.display = 'block';
  }

  const priceEl = document.getElementById('detail-price');
  priceEl.textContent = fmt(quote?.price, cur);

  const changeEl = document.getElementById('detail-change');
  if (quote) {
    changeEl.innerHTML = `
      <span class="change-amount">${fmtSign(quote.change, cur)}</span>
      <span class="change-percent">(${fmtPct(quote.changePercent)})</span>
    `;
    changeEl.className = 'detail-change ' + (quote.change >= 0 ? 'positive' : 'negative');
  }

  // Handle Discovery vs Portfolio view
  const personalTab = document.querySelector('.detail-tab[data-tab="personal"]');
  const dataTab = document.querySelector('.detail-tab[data-tab="data"]');
  const historyTab = document.querySelector('.detail-tab[data-tab="history"]');
  const chartSection = document.querySelector('.detail-chart-section');
  const dataSection = document.getElementById('detail-tab-data');
  const personalSection = document.getElementById('detail-tab-personal');
  const modalFooter = document.querySelector('.modal-detail .modal-footer');

  const isMarketOrCurrency = symbol.startsWith('^') || symbol.includes('=X');
  const isCrypto = symbol.endsWith('-USD') || quote?.type === 'CRYPTOCURRENCY';
  const isSimplified = isMarketOrCurrency || isCrypto;

  if (isDiscovery) {
    personalTab.style.display = 'none';
    historyTab.style.display = 'none';
    // Move chart to the top of the Data tab
    dataSection.insertBefore(chartSection, dataSection.firstChild);
    // Switch to data tab
    dataTab.click();
    
    // Update footer
    if (isMarketOrCurrency) {
      modalFooter.style.display = 'none';
      document.querySelector('.detail-tab[data-tab="events"]').style.display = 'none';
    } else {
      modalFooter.style.display = 'flex';
      // Hide events tab for cryptos too
      document.querySelector('.detail-tab[data-tab="events"]').style.display = isCrypto ? 'none' : 'flex';
      modalFooter.innerHTML = `
        <button class="btn-primary" style="width: 100%; padding: 14px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 8px;" onclick="window.openAddModalFromDiscover('${symbol}'); closeDetailModal();">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Añadir Posición
        </button>
      `;
    }
  } else {
    personalTab.style.display = '';
    historyTab.style.display = '';
    modalFooter.style.display = 'flex';
    document.querySelector('.detail-tab[data-tab="events"]').style.display = isCrypto ? 'none' : 'flex';
    // Move chart back to Personal tab
    personalSection.appendChild(chartSection);
    // Switch to personal tab
    personalTab.click();
    // Restore footer
    modalFooter.innerHTML = `
      <button class="btn-danger" id="btn-delete-position">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        Eliminar todo
      </button>
      <button class="btn-primary" id="btn-sell-position">Vender acciones</button>
    `;
    // Re-attach listeners to restored buttons
    document.getElementById('btn-delete-position')?.addEventListener('click', deleteCurrentPosition);
    document.getElementById('btn-sell-position')?.addEventListener('click', openSellModal);
  }

  // Hide footer if admin (read-only mode)
  if (window.isAdmin) {
    modalFooter.style.display = 'none';
  }

  // Extended Stats grid
  const statsGrid = document.getElementById('detail-stats-grid');
  const financialsSection = document.querySelector('.financial-charts');
  const overviewSection = document.getElementById('detail-overview');
  const formatCompact = (num) => num ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(num) : '-';

  if (isMarketOrCurrency) {
    statsGrid.style.display = 'none';
    if (financialsSection) financialsSection.style.display = 'none';
    if (overviewSection) overviewSection.style.display = 'none';
  } else if (isCrypto) {
    statsGrid.style.display = 'grid';
    if (financialsSection) financialsSection.style.display = 'none';
    if (overviewSection) overviewSection.style.display = 'block';
    
    statsGrid.innerHTML = `
      <div class="detail-stat"><div class="detail-stat-label">Market Cap</div><div class="detail-stat-value">$${formatCompact(quote?.marketCap)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Volumen (24h)</div><div class="detail-stat-value">${formatCompact(quote?.regularMarketVolume)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Máximo 52W</div><div class="detail-stat-value">${fmt(quote?.fiftyTwoWeekHigh, cur)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Mínimo 52W</div><div class="detail-stat-value">${fmt(quote?.fiftyTwoWeekLow, cur)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Símbolo</div><div class="detail-stat-value">${symbol}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Divisa</div><div class="detail-stat-value">${cur}</div></div>
    `;
  } else {
    statsGrid.style.display = 'grid';
    if (financialsSection) financialsSection.style.display = 'block';
    if (overviewSection) overviewSection.style.display = 'block';
    
    statsGrid.innerHTML = `
      <div class="detail-stat"><div class="detail-stat-label">Market Cap</div><div class="detail-stat-value">$${formatCompact(quote?.marketCap)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Ratio PER</div><div class="detail-stat-value">${quote?.trailingPE ? quote.trailingPE.toFixed(2) : '-'}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">BPA (EPS)</div><div class="detail-stat-value">${quote?.eps ? quote.eps.toFixed(2) : '-'}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Dividendo</div><div class="detail-stat-value">${quote?.dividendYield ? (quote.dividendYield * 100).toFixed(2) + '%' : '-'}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Beta</div><div class="detail-stat-value">${quote?.beta ? quote.beta.toFixed(2) : '-'}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Volumen</div><div class="detail-stat-value">${formatCompact(quote?.regularMarketVolume)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">52W Max</div><div class="detail-stat-value">${fmt(quote?.fiftyTwoWeekHigh, cur)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">52W Min</div><div class="detail-stat-value">${fmt(quote?.fiftyTwoWeekLow, cur)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Divisa</div><div class="detail-stat-value" style="font-size:0.85rem">${cur}</div></div>
    `;
  }

  // Position details (consolidated)
  if (holding) {
    const posGrid = document.getElementById('detail-position-grid');
    const entriesLabel = holding.entryCount > 1 ? ` (${holding.entryCount} compras)` : '';
    const gain = holding.currentValue - holding.invested;
    const gainPct = holding.invested > 0 ? (gain / holding.invested) * 100 : 0;
    posGrid.innerHTML = `
      <div class="detail-stat"><div class="detail-stat-label">Acciones${entriesLabel}</div><div class="detail-stat-value">${holding.shares}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Precio medio</div><div class="detail-stat-value">${fmt(holding.purchasePrice, cur)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Invertido</div><div class="detail-stat-value">${fmt(holding.invested, cur)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Valor actual</div><div class="detail-stat-value">${fmt(holding.currentValue, cur)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Ganancia</div><div class="detail-stat-value" style="color:${gain >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtSign(gain, cur)}</div></div>
      <div class="detail-stat"><div class="detail-stat-label">Retorno</div><div class="detail-stat-value" style="color:${gainPct >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(gainPct)}</div></div>
    `;
    document.getElementById('detail-position-section').style.display = 'block';
  } else {
    document.getElementById('detail-position-section').style.display = 'none';
  }

  // Fetch chart and financials
  try {
    const cd = await getChart(symbol, '1mo');
    createPerformanceChart('chart-detail', cd, holding?.purchasePrice);
    updateDetailChartStats(cd);
    
    // Fetch financials for the data tab
    const financials = await getFinancials(symbol);
    
    // Render Overview
    const overviewEl = document.getElementById('detail-overview');
    if (overviewEl) {
      if (financials && financials.overview) {
        overviewEl.innerHTML = `<p style="margin:0">${financials.overview}</p>`;
      } else {
        overviewEl.innerHTML = `<p style="margin:0; color:var(--text-muted);">No hay resumen disponible para este activo.</p>`;
      }
    }

    createFinancialCharts('chart-income', 'chart-cashflow', 'chart-eps', financials);
    
    // Fetch Events for Events tab
    const events = await getEvents(symbol);
    const timelineEl = document.getElementById('events-timeline');
    const statsEl = document.getElementById('dividend-stats');
    
    if (events) {
      const items = [];
      if (events.earnings?.earningsDate?.[0]?.fmt) {
        items.push({ date: new Date(events.earnings.earningsDate[0].raw * 1000), title: 'Presentación de Resultados', icon: '📈' });
      }
      if (events.exDividendDate?.fmt) {
        items.push({ date: new Date(events.exDividendDate.raw * 1000), title: 'Día Ex-Dividendo', icon: '✂️' });
      }
      if (events.dividendDate?.fmt) {
        items.push({ date: new Date(events.dividendDate.raw * 1000), title: 'Pago de Dividendo', icon: '💸' });
      }
      
      const today = new Date().getTime();
      let html = '';
      if (items.length > 0) {
        items.sort((a, b) => a.date - b.date);
        html += `<h3>Próximos Eventos</h3><div style="padding-left:16px; border-left: 2px solid var(--border-card); display:flex; flex-direction:column; gap:16px;">`;
        items.forEach(item => {
          const isPast = item.date.getTime() < today;
          html += `
            <div style="position:relative;">
              <div style="position:absolute; left:-25px; top:2px; background:var(--bg-card); border-radius:50%; width:18px; height:18px; border:2px solid ${isPast ? 'var(--border-card)' : 'var(--accent)'}; font-size:10px; display:flex; align-items:center; justify-content:center;">${item.icon}</div>
              <div style="color:${isPast ? 'var(--text-muted)' : 'var(--text-primary)'}; font-weight:600;">${item.date.toLocaleDateString()}</div>
              <div style="color:var(--text-secondary); font-size:0.9rem;">${item.title}</div>
            </div>`;
        });
        html += `</div>`;
      } else {
        html += `<p style="color:var(--text-muted); text-align:center; padding: 20px;">No hay eventos futuros programados.</p>`;
      }
      timelineEl.innerHTML = html;
      
      // Load dividend history
      const divs = dividendsCache[symbol] || await getDividends(symbol);
      const divList = Object.values(divs).sort((a,b) => b.date - a.date).slice(0,4);
      if (divList.length > 0) {
        let divHtml = `<h3>Últimos Dividendos</h3><div class="detail-stats-grid" style="grid-template-columns: repeat(2, 1fr);">`;
        divList.forEach(d => {
          divHtml += `<div class="detail-stat">
            <div class="detail-stat-label">${new Date(d.date * 1000).toLocaleDateString()}</div>
            <div class="detail-stat-value" style="color:var(--green);">${fmt(d.amount)}</div>
          </div>`;
        });
        divHtml += `</div>`;
        statsEl.innerHTML = divHtml;
      } else {
        statsEl.innerHTML = '';
      }
    } else {
      timelineEl.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding: 20px;">Información de eventos no disponible.</p>`;
      statsEl.innerHTML = '';
    }
    // Render History Tab
    const historyEl = document.getElementById('history-timeline');
    renderHistoryTab(historyEl, symbol, holding);

  } catch (e) {
    console.warn('Detail data error:', e);
  }
}

window.closeDetailModal = function() {
  document.getElementById('modal-detail').style.display = 'none';
  detailSymbol = null;
}

function deleteCurrentPosition() {
  if (!detailSymbol) return;
  removeAllPositionsForSymbol(detailSymbol);
  closeDetailModal();
  showToast(`${detailSymbol} eliminado del portfolio`, 'error');
  chartDataCache = {};
  refreshPortfolio();
}

// ===== Sell Modal =====
function setupSellModal() {
  document.getElementById('modal-close-sell')?.addEventListener('click', closeSellModal);
  document.getElementById('btn-cancel-sell')?.addEventListener('click', closeSellModal);
  document.getElementById('modal-sell')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-sell') closeSellModal();
  });
  document.getElementById('btn-confirm-sell')?.addEventListener('click', confirmSell);
}

function openSellModal() {
  if (!detailSymbol || detailMaxShares <= 0) return;
  const modal = document.getElementById('modal-sell');
  modal.style.display = 'flex';
  document.getElementById('sell-symbol').textContent = detailSymbol;
  document.getElementById('sell-max-shares').textContent = detailMaxShares;
  document.getElementById('input-sell-shares').value = detailMaxShares;
  document.getElementById('input-sell-shares').max = detailMaxShares;

  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('input-sell-date').value = today;

  const currentPrice = currentQuotes[detailSymbol]?.price || 0;
  document.getElementById('input-sell-price').value = currentPrice.toFixed(2);
}

function closeSellModal() {
  document.getElementById('modal-sell').style.display = 'none';
}

function confirmSell() {
  if (!detailSymbol) return;
  const sharesToSell = parseFloat(document.getElementById('input-sell-shares').value);
  const sellPrice = parseFloat(document.getElementById('input-sell-price').value);
  const sellDate = document.getElementById('input-sell-date').value;
  
  if (isNaN(sharesToSell) || sharesToSell <= 0 || sharesToSell > detailMaxShares || isNaN(sellPrice) || sellPrice <= 0 || !sellDate) {
    showToast('Datos inválidos o falta fecha', 'error');
    return;
  }

  const gain = sellPosition(detailSymbol, sharesToSell, sellPrice, sellDate);
  closeSellModal();
  closeDetailModal();
  showToast(`Vendidas ${sharesToSell} acciones de ${detailSymbol}. Beneficio: ${fmtSign(gain)}`);
  chartDataCache = {};
  refreshPortfolio();
}

async function renderHistoryTab(containerEl, symbol, holding) {
  if (!containerEl) return;
  
  containerEl.innerHTML = '<div class="history-empty"><div class="loading-spinner"></div><p>Cargando historial...</p></div>';

  try {
    const history = [];
    const transactions = getTransactionHistory().filter(t => t.symbol === symbol);
    
    transactions.forEach(t => {
      const type = (t.type || '').toLowerCase();
      if (type === 'buy' || type === 'compra') {
        history.push({
          id: t.id,
          date: new Date(t.date),
          type: 'buy',
          icon: 'svg-buy',
          title: 'Compra de acciones',
          subtitle: `${t.shares} acciones a ${fmt(t.price, t.currency || 'USD')}`,
          amount: -(t.shares * t.price),
          currency: t.currency || 'USD',
          exchangeRate: t.exchangeRate
        });
      } else if (type === 'sell' || type === 'venta') {
        history.push({
          id: t.id,
          date: new Date(t.date),
          type: 'sell',
          icon: 'svg-sell',
          title: 'Venta de acciones',
          subtitle: `${t.shares} acciones a ${fmt(t.price, t.currency || 'USD')}`,
          amount: (t.shares * t.price),
          currency: t.currency || 'USD',
          gain: t.gain
        });
      }
    });

    // Add API dividends if holding exists
    if (holding && holding.entries) {
      const divs = dividendsCache[symbol] || await getDividends(symbol);
      const cur = holding.quote?.currency || 'USD';
      
      holding.entries.forEach(entry => {
        const purchaseMs = new Date(entry.purchaseDate).getTime();
        for (const key in divs) {
          const div = divs[key];
          const divMs = div.date * 1000;
          if (divMs >= purchaseMs) {
            const divAmount = div.amount * entry.shares;
            const existingDiv = history.find(h => h.type === 'dividend' && h.date.getTime() === divMs);
            if (existingDiv) {
              existingDiv.amount += divAmount;
              existingDiv.subtitle = `Dividendo acumulado (${fmt(div.amount, cur)}/acc)`;
            } else {
              history.push({
                date: new Date(divMs),
                type: 'dividend',
                icon: 'svg-div',
                title: 'Pago de Dividendo',
                subtitle: `Dividendo (${fmt(div.amount, cur)}/acc)`,
                amount: divAmount,
                currency: cur
              });
            }
          }
        }
      });
    }

    if (history.length === 0) {
      containerEl.innerHTML = '<div class="history-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg><p>No hay historial de transacciones para esta posición.</p></div>';
      return;
    }

    history.sort((a, b) => b.date - a.date);

    containerEl.innerHTML = history.map(h => {
      const isPositive = h.amount > 0;
      let iconHtml = '';
      if (h.type === 'buy') iconHtml = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      else if (h.type === 'sell') iconHtml = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';
      else iconHtml = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>';

      let fxHtml = '';
      if (h.type === 'buy' && h.exchangeRate) {
        fxHtml = `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">Cambio EUR/USD: ${h.exchangeRate}</div>`;
      }
      
      let gainHtml = '';
      if (h.type === 'sell' && h.gain !== undefined) {
        gainHtml = `<div style="font-size: 0.7rem; color: ${h.gain >= 0 ? 'var(--green)' : 'var(--red)'}; margin-top: 2px;">Beneficio: ${fmtSign(h.gain)}</div>`;
      }

      // Delete button only for buy/sell (manual transactions)
      const deleteBtn = h.id ? `<button class="btn-delete-tx" data-id="${h.id}" title="Eliminar registro" style="background:none; border:none; color:var(--red); opacity:0.3; cursor:pointer; padding:4px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : '';

      return `
        <div class="history-item">
          <div class="history-icon ${h.type}">
            ${iconHtml}
          </div>
          <div class="history-details">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div class="history-title">${h.title}</div>
              ${deleteBtn}
            </div>
            <div class="history-subtitle">${h.subtitle}</div>
            ${fxHtml}
            ${gainHtml}
          </div>
          <div class="history-meta">
            <div class="history-amount ${h.type === 'buy' ? 'negative' : (h.type === 'sell' ? 'neutral' : 'positive')}">
              ${h.type === 'buy' ? '-' : '+'}${fmt(Math.abs(h.amount), h.currency)}
            </div>
            <div class="history-date">${h.date.toLocaleDateString()}</div>
          </div>
        </div>
      `;
    }).join('');

    // Add listeners to delete buttons
    containerEl.querySelectorAll('.btn-delete-tx').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (confirm('¿Estás seguro de eliminar esta transacción del historial? Esto afectará al benchmark.')) {
          deleteTransaction(id);
          renderHistoryTab(containerEl, symbol, holding);
          showToast('Transacción eliminada');
        }
      });
    });

  } catch (e) {
    console.warn('Error rendering history:', e);
    containerEl.innerHTML = '<div class="history-empty"><p>Error al cargar el historial.</p></div>';
  }
}


// ===== Portfolios =====
function setupPortfolios() {
  const container = document.getElementById('portfolio-selector-container');
  const select = document.getElementById('portfolio-selector');
  const btnManage = document.getElementById('btn-manage-portfolios');
  
  function updateUI() {
    const ports = getPortfolios();
    container.style.display = 'flex';
    if (ports.length <= 1) {
      select.style.display = 'none';
    } else {
      select.style.display = 'block';
      select.innerHTML = '<option value="all">Todos los portfolios</option>';
      ports.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      select.value = getActivePortfolioId();
    }
    
    // Update manage modal list
    const list = document.getElementById('portfolios-list');
    if (list) {
      list.innerHTML = ports.map(p => `
        <div class="portfolio-item-row" id="portfolio-row-${p.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--bg-card); border-radius: var(--radius-sm); border: 1px solid var(--border-card); transition: all 0.2s;">
          <div style="flex: 1;">
            <div id="portfolio-name-container-${p.id}" style="font-weight: 600; font-size: 1rem; color: var(--text-primary); margin-bottom: 2px;">${p.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${p.positionCount} posiciones</div>
          </div>
          <div style="display: flex; gap: 8px;" id="portfolio-actions-${p.id}">
            <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="window.startRenamePortfolioHandler('${p.id}', '${p.name.replace(/'/g, "\\'")}')">Editar</button>
            <button class="btn-danger" style="padding: 6px 12px; font-size: 0.8rem;" onclick="window.deletePortfolioHandler('${p.id}')" ${ports.length <= 1 ? 'disabled' : ''}>Eliminar</button>
          </div>
        </div>
      `).join('');
    }
  }

  updateUI();

  select?.addEventListener('change', (e) => {
    setActivePortfolioId(e.target.value);
    refreshPortfolio();
  });

  const openManage = () => {
    updateUI();
    document.getElementById('modal-portfolios').style.display = 'flex';
    document.getElementById('user-dropdown').style.display = 'none';
  };

  btnManage?.addEventListener('click', openManage);
  document.getElementById('btn-user-manage-portfolios')?.addEventListener('click', openManage);

  document.getElementById('modal-close-portfolios')?.addEventListener('click', () => {
    document.getElementById('modal-portfolios').style.display = 'none';
  });
  
  document.getElementById('modal-portfolios')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-portfolios') document.getElementById('modal-portfolios').style.display = 'none';
  });

  document.getElementById('btn-create-portfolio')?.addEventListener('click', () => {
    const input = document.getElementById('input-new-portfolio-name');
    const name = input.value.trim();
    if (name) {
      const id = addPortfolio(name);
      input.value = '';
      updateUI();
      setActivePortfolioId(id);
      refreshPortfolio();
    }
  });

  window.deletePortfolioHandler = (id) => {
    if (confirm('¿Estás seguro de que quieres eliminar este portfolio y todas sus posiciones?')) {
      deletePortfolio(id);
      updateUI();
      refreshPortfolio();
    }
  };

  window.startRenamePortfolioHandler = (id, currentName) => {
    const container = document.getElementById(`portfolio-name-container-${id}`);
    const actions = document.getElementById(`portfolio-actions-${id}`);
    if (!container || !actions) return;

    // Save original state
    const originalHTML = container.innerHTML;
    const originalActionsHTML = actions.innerHTML;

    // Transform to input and hide position count
    const parent = container.parentElement;
    const posCount = parent.querySelector('div:last-child');
    if (posCount) posCount.style.display = 'none';

    container.innerHTML = `<input type="text" id="rename-input-${id}" value="${currentName}" style="width: 100%; background: var(--bg-body); border: 2px solid var(--accent); color: var(--text-primary); padding: 5px 10px; border-radius: 6px; outline: none; font-weight: 600; font-size: 0.9rem; box-sizing: border-box; display: block;">`;
    
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.innerHTML = `
      <button class="btn-primary" style="padding: 0 12px; font-size: 0.75rem; height: 30px; border-radius: 6px;" id="save-rename-${id}">Guardar</button>
      <button class="btn-secondary" style="padding: 0 8px; font-size: 0.75rem; height: 30px; border-radius: 6px; display: flex; align-items: center; justify-content: center;" id="cancel-rename-${id}">✕</button>
    `;

    const input = document.getElementById(`rename-input-${id}`);
    input.focus();
    input.select();

    const save = () => {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        renamePortfolio(id, newName);
        updateUI();
        refreshPortfolio();
      } else {
        cancel();
      }
    };

    const cancel = () => {
      container.innerHTML = originalHTML;
      actions.innerHTML = originalActionsHTML;
      if (posCount) posCount.style.display = 'block';
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') cancel();
    });

    document.getElementById(`save-rename-${id}`).addEventListener('click', save);
    document.getElementById(`cancel-rename-${id}`).addEventListener('click', cancel);
  };
}

// ===== Discover =====
let discoverLoaded = false;
function setupDiscover() {
  const searchInput = document.getElementById('discover-search-input');
  const clearBtn = document.getElementById('btn-clear-discover');
  let searchTimeout = null;
  
  searchInput?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (clearBtn) clearBtn.style.display = query.length > 0 ? 'flex' : 'none';

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (query.length > 0) {
        performDiscoverSearch(query);
      } else {
        document.getElementById('discover-search-results').style.display = 'none';
        document.getElementById('discover-market-overview').style.display = 'flex';
      }
    }, 500);
  });

  clearBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    document.getElementById('discover-search-results').style.display = 'none';
    document.getElementById('discover-market-overview').style.display = 'flex';
  });
}

const GLOBAL_INDICES = [
  { symbol: '^GSPC', name: 'S&P 500', flag: '🇺🇸' },
  { symbol: '^IXIC', name: 'Nasdaq 100', flag: '🇺🇸' },
  { symbol: '^DJI', name: 'Dow Jones', flag: '🇺🇸' },
  { symbol: '^IBEX', name: 'IBEX 35', flag: '🇪🇸' },
  { symbol: '^GDAXI', name: 'DAX', flag: '🇩🇪' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50', flag: '🇪🇺' },
  { symbol: '^FTSE', name: 'FTSE 100', flag: '🇬🇧' },
  { symbol: '^N225', name: 'Nikkei 225', flag: '🇯🇵' },
  { symbol: '^HSI', name: 'Hang Seng', flag: '🇭🇰' }
];

const GLOBAL_CURRENCIES = [
  { symbol: 'EURUSD=X', name: 'EUR / USD', flag: '💶' },
  { symbol: 'GBPUSD=X', name: 'GBP / USD', flag: '💷' },
  { symbol: 'USDJPY=X', name: 'USD / JPY', flag: '💴' },
  { symbol: 'BTC-USD', name: 'Bitcoin', flag: '₿' },
  { symbol: 'ETH-USD', name: 'Ethereum', flag: '💎' },
  { symbol: 'GC=F', name: 'Oro', flag: '🥇' },
  { symbol: 'SI=F', name: 'Plata', flag: '🥈' },
  { symbol: 'CL=F', name: 'Petróleo Crudo', flag: '🛢️' }
];

function initDiscoverData() {
  if (discoverLoaded) return;
  discoverLoaded = true;
  loadWatchlistSection();
  loadIndicesSection();
  loadCurrenciesSection();
  loadDiscoverSection('discover-trending-grid', getTrendingSymbols);
  loadDiscoverSection('discover-gainers-grid', () => getScreenerSymbols('day_gainers', 6));
  loadDiscoverSection('discover-losers-grid', () => getScreenerSymbols('day_losers', 6));
}

async function loadWatchlistSection() {
  const grid = document.getElementById('discover-watchlist-grid');
  const section = document.getElementById('watchlist-section');
  if (!grid || !section) return;
  
  section.style.display = 'block';
  const wl = getWatchlist();
  if (!wl || wl.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 32px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; color: var(--text-muted);">
        <p style="margin: 0; font-size: 0.95rem;">Tu lista está vacía. Añade empresas usando el marcador en el buscador.</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = '<div class="loading-spinner"></div>';
  const quotes = await getMultipleQuotes(wl);
  
  grid.innerHTML = wl.map(symbol => {
    const q = quotes[symbol];
    if (!q) return '';
    const chg = q.changePercent || 0;
    const sign = chg >= 0 ? '+' : '';
    const color = chg >= 0 ? 'var(--green)' : 'var(--red)';
    return `
      <div class="holding-card glass-card" style="cursor: pointer;" onclick="window.openDetailModal('${symbol}', true)">
        <div class="holding-card-header">
          <div style="display:flex; align-items:center; gap:12px;">
            <img src="${getLogoUrl(symbol, q)}" style="width:32px; height:32px; border-radius:50%; object-fit:contain; filter: drop-shadow(0 0 3px rgba(255,255,255,0.4));" onerror="window.handleLogoError(this, '${symbol}')">
            <div>
              <div class="holding-card-symbol">${q.name || symbol}</div>
              <div class="holding-card-name">${symbol}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div class="holding-card-price">${fmt(q.price, q.currency)}</div>
            <div class="holding-card-change" style="color:${color}">${sign}${q.changePercent?.toFixed(2)}%</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadIndicesSection() {
  const grid = document.getElementById('discover-indices-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-spinner"></div>';
  const symbols = GLOBAL_INDICES.map(m => m.symbol);
  const quotes = await getMultipleQuotes(symbols);
  
  grid.innerHTML = GLOBAL_INDICES.map(m => {
    const q = quotes[m.symbol];
    if (!q) return '';
    const chg = q.changePercent || 0;
    const sign = chg >= 0 ? '+' : '';
    const color = chg >= 0 ? 'var(--green)' : 'var(--red)';
    return `
      <div class="holding-card glass-card" style="cursor: pointer;" onclick="window.openDetailModal('${m.symbol}', true)">
        <div class="holding-card-header">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
              ${m.flag}
            </div>
            <div>
              <div class="holding-card-symbol">${m.name}</div>
              <div class="holding-card-name">${m.symbol}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div class="holding-card-price">${fmt(q.price, q.currency)}</div>
            <div class="holding-card-change" style="color:${color}">${sign}${q.changePercent?.toFixed(2)}%</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadCurrenciesSection() {
  const grid = document.getElementById('discover-currencies-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-spinner"></div>';
  const symbols = GLOBAL_CURRENCIES.map(m => m.symbol);
  const quotes = await getMultipleQuotes(symbols);
  
  grid.innerHTML = GLOBAL_CURRENCIES.map(m => {
    const q = quotes[m.symbol];
    if (!q) return '';
    const chg = q.changePercent || 0;
    const sign = chg >= 0 ? '+' : '';
    const color = chg >= 0 ? 'var(--green)' : 'var(--red)';
    return `
      <div class="holding-card glass-card" style="cursor: pointer;" onclick="window.openDetailModal('${m.symbol}', true)">
        <div class="holding-card-header">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
              ${m.flag}
            </div>
            <div>
              <div class="holding-card-symbol">${m.name}</div>
              <div class="holding-card-name">${m.symbol}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div class="holding-card-price">${fmt(q.price, q.currency)}</div>
            <div class="holding-card-change" style="color:${color}">${sign}${q.changePercent?.toFixed(2)}%</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadDiscoverSection(sectionId, fetchFn) {
  const grid = document.getElementById(sectionId);
  if (!grid) return;
  grid.innerHTML = '<div class="loading-spinner"></div>';
  const symbols = await fetchFn();
  if (!symbols || symbols.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted);">No se encontraron datos en este momento.</div>';
    return;
  }
  const quotes = await getMultipleQuotes(symbols);
  const cards = symbols.map(sym => {
    const q = quotes[sym];
    if (!q) return '';
    const chg = q.changePercent || 0;
    const sign = chg >= 0 ? '+' : '';
    const color = chg >= 0 ? 'var(--green)' : 'var(--red)';
    return `
      <div class="holding-card glass-card" style="cursor: pointer;" onclick="window.openDetailModal('${q.symbol}', true)">
        <div class="holding-card-header">
          <div style="display:flex; align-items:center; gap:12px;">
            <img src="${getLogoUrl(q.symbol, q)}" style="width:32px; height:32px; border-radius:50%; object-fit:contain; background:transparent;" onerror="window.handleLogoError(this, '${q.symbol}')">
            <div>
              <div class="holding-card-symbol">${q.symbol}</div>
              <div class="holding-card-name" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${q.name}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div class="holding-card-symbol">${fmt(q.price)}</div>
            <div style="color: ${color}; font-size: 0.85rem; font-weight: 600;">${sign}${fmtPct(chg)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  grid.innerHTML = cards;
}

async function performDiscoverSearch(query) {
  document.getElementById('discover-market-overview').style.display = 'none';
  const resContainer = document.getElementById('discover-search-results');
  resContainer.style.display = 'flex';
  resContainer.innerHTML = '<div class="loading-spinner"></div>';
  
  const searchResults = await searchSymbol(query);
  if (!searchResults || searchResults.length === 0) {
    resContainer.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-muted); font-size: 1.1rem;">No se encontraron resultados para "'+query+'"</div>';
    return;
  }
  
  let html = `
    <div style="width: 100%; max-width: 800px; margin: 0 auto; animation: slideUp 0.3s ease-out;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <h2 style="font-size: 1.5rem; margin: 0;">Resultados para "${query}"</h2>
        <button onclick="document.getElementById('discover-search-results').style.display='none'; document.getElementById('discover-market-overview').style.display='flex'; document.getElementById('discover-search-input').value='';" 
                style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
          ✕
        </button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 16px;">
  `;
  
  for (const sr of searchResults) {
    html += `
      <div class="glass-card" style="padding: 16px 20px; border: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;"
           onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'"
           onclick="window.openDetailModal('${sr.symbol}', true)">
        <div style="display: flex; gap: 16px; align-items: center;">
          <div style="width: 44px; height: 44px; background: rgba(255,255,255,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; padding: 4px;">
            <img src="${getLogoUrl(sr.symbol, { shortName: sr.shortName || sr.longName })}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:50%;" onerror="window.handleLogoError(this, '${sr.symbol}')">
          </div>
          <div>
            <h3 style="margin: 0; font-size: 1.1rem; font-weight: 700;">${sr.shortName || sr.longName || sr.symbol}</h3>
            <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 2px;">
              <span style="color: var(--accent); font-weight: 600;">${sr.symbol}</span> • ${sr.exchDisp || ''}
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 12px; align-items: center;">
          <button onclick="event.stopPropagation(); window.toggleWatchlist('${sr.symbol}', this)" 
                  style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); width:36px; height:36px; border-radius:50%; cursor:pointer; color:${getWatchlist().includes(sr.symbol) ? '#6366f1' : 'var(--text-muted)'}; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
            <svg viewBox="0 0 24 24" fill="${getWatchlist().includes(sr.symbol) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" style="width:18px; height:18px;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button class="btn-primary" style="padding: 8px 16px; font-size: 0.85rem; border-radius: 8px;" 
                  onclick="event.stopPropagation(); window.openAddModalFromDiscover('${sr.symbol}')">
            Añadir
          </button>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; color: var(--text-muted);"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
      </div>
    `;
  }
  
  html += `</div></div>`;
  resContainer.innerHTML = html;
}

window.toggleWatchlist = (symbol, btn) => {
  const wl = getWatchlist();
  const isWatched = wl.includes(symbol);
  if (isWatched) {
    removeFromWatchlist(symbol);
    if (btn) updateWlBtnState(btn, false);
    showToast('Eliminado de seguimiento', 'info');
  } else {
    addToWatchlist(symbol);
    if (btn) updateWlBtnState(btn, true);
    showToast('Añadido a seguimiento', 'success');
  }
  // Refresh Watchlist section
  loadWatchlistSection();
  
  // Sync detail modal button if it happens to be open for this symbol
  const detailSymbol = document.getElementById('detail-symbol')?.textContent?.split(' ')[0];
  if (detailSymbol === symbol) {
    const detailWlBtn = document.getElementById('btn-watchlist');
    if (detailWlBtn) {
      updateWlBtnState(detailWlBtn, !isWatched);
    }
  }
};

window.openAddModalFromDiscover = async (symbol) => {
  try {
    const results = await searchSymbol(symbol);
    if (results && results.length > 0) {
      const match = results.find(r => r.symbol === symbol) || results[0];
      const quote = await getQuote(symbol);
      selectedStock = { symbol: match.symbol, name: match.name || match.shortName || match.longName, quote };
      
      document.getElementById('modal-add').style.display = 'flex';
      document.getElementById('input-symbol').value = symbol;
      document.getElementById('search-results').style.display = 'none';
      
      document.getElementById('selected-stock').style.display = 'flex';
      document.getElementById('selected-symbol').textContent = symbol;
      document.getElementById('selected-name').textContent = selectedStock.name;
      document.getElementById('selected-current-price').textContent = `Actual: ${fmt(quote.price)}`;
      
      document.getElementById('input-price').value = quote.price.toFixed(2);
      document.getElementById('input-shares').value = '1';
      document.getElementById('select-source-currency').value = quote.currency || 'USD';
      
      // Update form summary
      if (typeof updateFormSummary === 'function') updateFormSummary();
    }
  } catch (e) {
    console.error('Error opening add modal from discover:', e);
    showToast('Error al preparar el formulario de añadir', 'error');
  }
};
// ===== Calculator Logic =====
function setupCalculator() {
  const modal = document.getElementById('modal-calc');
  const btnOpen = document.getElementById('btn-open-calc');
  const btnClose = document.getElementById('modal-close-calc');
  
  if (!modal || !btnOpen || !btnClose) return;

  btnOpen.addEventListener('click', () => {
    modal.style.display = 'flex';
    updateCalculator();
  });

  btnClose.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  const inputs = ['calc-initial', 'calc-contribution', 'calc-frequency', 'calc-rate', 'calc-years'];
  inputs.forEach(id => {
    document.getElementById(id).addEventListener('input', updateCalculator);
  });
}

function updateCalculator() {
  const initial = parseFloat(document.getElementById('calc-initial').value) || 0;
  const contribution = parseFloat(document.getElementById('calc-contribution').value) || 0;
  const frequency = parseInt(document.getElementById('calc-frequency').value) || 12;
  const rate = parseFloat(document.getElementById('calc-rate').value) / 100 || 0;
  const years = parseInt(document.getElementById('calc-years').value) || 0;

  if (years > 50) return; 

  const dataPrincipal = [initial];
  const dataTotal = [initial];
  
  let currentTotal = initial;
  let currentInvested = initial;

  for (let year = 1; year <= years; year++) {
    if (frequency === 1) {
      // Annual contribution at start of year
      currentTotal = (currentTotal + contribution) * (1 + rate);
      currentInvested += contribution;
    } else if (frequency === 52) {
      // Weekly contribution
      for (let w = 1; w <= 52; w++) {
        currentTotal = (currentTotal + contribution) * (1 + rate / 52);
        currentInvested += contribution;
      }
    } else {
      // Monthly contribution
      for (let m = 1; m <= 12; m++) {
        currentTotal = (currentTotal + contribution) * (1 + rate / 12);
        currentInvested += contribution;
      }
    }
    dataPrincipal.push(currentInvested);
    dataTotal.push(currentTotal);
  }

  // Update UI
  document.getElementById('res-total').textContent = `$${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('res-invested').textContent = `$${currentInvested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const interest = currentTotal - currentInvested;
  document.getElementById('res-interest').textContent = `$${interest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Update Chart
  createCompoundChart('chart-calc', years, dataPrincipal, dataTotal);
}

// ===== Diversification Logic =====
function setupDiversification() {
  const modal = document.getElementById('modal-divers');
  const btnOpen = document.getElementById('btn-open-divers');
  const btnClose = document.getElementById('modal-close-divers');
  
  if (!modal || !btnOpen || !btnClose) return;

  btnOpen.addEventListener('click', () => {
    modal.style.display = 'flex';
    updateDiversification();
  });

  btnClose.addEventListener('click', () => {
    modal.style.display = 'none';
  });
}

async function updateDiversification() {
  const rawHoldings = currentStats.holdings || [];
  const holdings = rawHoldings.filter(h => !h.isPortfolio);
  
  let totalValue = 0;
  holdings.forEach(h => {
    totalValue += parseFloat(h.currentValue) || parseFloat(h.value) || 0;
  });

  if (totalValue === 0) return;

  const scoreEl = document.getElementById('divers-score');
  const sectors = {};
  const regions = {};
  const riskContributions = [];

  // --- INSTITUTIONAL GEOPOLITICAL ENGINE (TRIPLE LAYER) ---
  const geopolMatrix = {
    domicileRisk: {},
    revenueRisk: { 'EE.UU.': 0, 'Europa': 0, 'China': 0, 'Taiwán/Asia': 0, 'Otros': 0 },
    currencyRisk: { listing: {}, operational: {} },
    blindSpots: []
  };

  // Institutional Revenue & Supply Chain Database (10-K proxy)
  const institutionalDB = {
    'ASML': { 'Europa': 15, 'China': 25, 'Taiwán/Asia': 45, 'EE.UU.': 10, 'Otros': 5 },
    'NVDA': { 'EE.UU.': 35, 'China': 22, 'Taiwán/Asia': 25, 'Otros': 18 },
    'AAPL': { 'EE.UU.': 42, 'Europa': 24, 'China': 19, 'Otros': 15 },
    'TSLA': { 'EE.UU.': 45, 'China': 22, 'Europa': 20, 'Otros': 13 },
    'MSFT': { 'EE.UU.': 50, 'Europa': 25, 'China': 10, 'Otros': 15 },
    'TSM':  { 'EE.UU.': 65, 'China': 12, 'Taiwán/Asia': 20, 'Otros': 3 },
    'BABA': { 'China': 90, 'Otros': 10 },
    'JD':   { 'China': 95, 'Otros': 5 }
  };

  let criticalTaiwanConcentration = 0;

  await Promise.all(holdings.map(async (h) => {
    if (!stockDetailsCache[h.symbol]) {
      try {
        const details = await getStockDeepDetails(h.symbol);
        if (details) stockDetailsCache[h.symbol] = details;
      } catch (e) {}
    }

    const details = stockDetailsCache[h.symbol];
    const hValue = parseFloat(h.currentValue) || parseFloat(h.value) || 0;
    const weight = (hValue / totalValue);
    const sym = h.symbol.split('.')[0].toUpperCase();
    const nameLow = (h.name || '').toLowerCase();
    
    const isETF = h.symbol.length > 5 || nameLow.includes('etf') || nameLow.includes('fund') || nameLow.includes('vuaa');

    // 1. Domicile Analysis (Resilient Fallback)
    let domicile = details?.assetProfile?.country;
    if (!domicile) {
      const s = h.symbol.toUpperCase();
      const exch = (h.quote?.exchange || '').toUpperCase();
      const cur = (h.quote?.currency || '').toUpperCase();

      // Priority: Specific global giants regardless of listing
      if (s.includes('ASML')) domicile = 'Netherlands';
      else if (s.includes('NVO')) domicile = 'Denmark';
      else if (s.includes('SAP')) domicile = 'Germany';
      else if (s.includes('BABA') || s.includes('JD') || s.includes('BIDU') || s.includes('TCEHY')) domicile = 'China';
      else if (s.includes('TSM')) domicile = 'Taiwan';
      else if (s.includes('AZN') || s.includes('SHEL') || s.includes('HSBC') || s.includes('RIO') || s.includes('BP')) domicile = 'United Kingdom';
      else if (s.includes('TTE') || s.includes('MC.PA') || s.includes('OR.PA')) domicile = 'France';
      
      // Secondary: Ticker Suffixes
      else if (s.endsWith('.MC') || s.endsWith('.MI')) domicile = 'Spain'; 
      else if (s.endsWith('.DE')) domicile = 'Germany';
      else if (s.endsWith('.AS')) domicile = 'Netherlands';
      else if (s.endsWith('.PA')) domicile = 'France';
      else if (s.endsWith('.L')) domicile = 'United Kingdom';
      else if (s.endsWith('.SW')) domicile = 'Switzerland';
      else if (s.endsWith('.HK')) domicile = 'China';
      
      // Tertiary: Currency & Exchange (General US stocks)
      else if (['AAPL','MSFT','GOOG','AMZN','META','NVDA','TSLA','BRK-B','JPM','V','MA','UNH','HD'].includes(sym)) domicile = 'United States';
      else if (cur === 'EUR') domicile = 'Europa (Global)';
      else if (cur === 'USD' || exch.includes('NYS') || exch.includes('NAS')) domicile = 'United States';
      else domicile = 'Otros / Global';
    }
    geopolMatrix.domicileRisk[domicile] = (geopolMatrix.domicileRisk[domicile] || 0) + (weight * 100);

    // --- Standard Metrics fallback (Sectors & Regions) ---
    const weightPct = weight * 100;
    
    // SECTORS
    let sector = details?.assetProfile?.sector;
    if (isETF) sector = 'ETFs / Fondos';
    else if (!sector || sector === 'Communication Services' || sector === 'Consumer Cyclical') {
      if (['AAPL', 'MSFT', 'GOOG', 'GOOGL', 'NVDA', 'AMD', 'ASML', 'NFLX', 'META', 'TSLA', 'AMZN', 'BABA', 'JD'].includes(sym) || nameLow.includes('tech')) sector = 'Tecnología';
      else if (!sector) sector = 'Otros / Desconocido';
    }
    sectors[sector] = (sectors[sector] || 0) + weightPct;

    // REGIONS (Granular breakdown)
    let region = domicile;
    if (isETF && (nameLow.includes('s&p 500') || nameLow.includes('sp500') || nameLow.includes('nasdaq') || nameLow.includes('usa') || sym.includes('VUAA'))) {
        region = 'EE.UU.';
    } else if (region === 'United States') {
        region = 'EE.UU.';
    } else if (region === 'China' || region === 'Hong Kong' || sym.includes('BABA') || sym.includes('JD') || sym.includes('BIDU')) {
        region = 'China';
    } else {
        const europeList = ['Spain', 'Germany', 'France', 'Italy', 'Switzerland', 'United Kingdom', 'Netherlands', 'Belgium', 'Ireland', 'Austria', 'Denmark', 'Finland', 'Norway', 'Sweden'];
        if (region && europeList.some(c => region.includes(c))) {
            region = 'Europa';
        } else if (!region || region === 'Global' || region === 'Internacional' || region === 'Otros / Global') {
            region = 'Internacional (Diversos)';
        }
    }
    regions[region] = (regions[region] || 0) + weightPct;

    // 2. Revenue & Supply Chain Layer (Smart Inference)
    let rev = institutionalDB[sym];
    if (!rev) {
        if (isETF && region === 'EE.UU.') rev = { 'EE.UU.': 100 };
        else if (isETF && region === 'Europa') rev = { 'Europa': 100 };
        else if (sector === 'Tecnología') rev = { 'EE.UU.': 45, 'Europa': 20, 'Taiwán/Asia': 25, 'Otros': 10 };
        else if (region === 'Europa') rev = { 'Europa': 75, 'EE.UU.': 15, 'Otros': 10 };
        else if (region === 'EE.UU.') rev = { 'EE.UU.': 60, 'Europa': 20, 'Taiwán/Asia': 10, 'Otros': 10 };
        else rev = { [region === 'Internacional' ? 'Otros' : region]: 80, 'Otros': 20 };
    }
    
    Object.entries(rev).forEach(([r, pct]) => {
      // Normalize pct from 100-based mapping to decimal
      const normPct = pct > 1 ? pct / 100 : pct;
      geopolMatrix.revenueRisk[r] = (geopolMatrix.revenueRisk[r] || 0) + (weight * normPct * 100);
      if (r === 'Taiwán/Asia') criticalTaiwanConcentration += (weight * normPct * 100);
    });

    // 3. Currency Layer
    const listCur = (h.quote?.currency || 'USD').toUpperCase();
    geopolMatrix.currencyRisk.listing[listCur] = (geopolMatrix.currencyRisk.listing[listCur] || 0) + (weight * 100);
    const opCur = ['Spain', 'Germany', 'France', 'Italy', 'Netherlands'].includes(domicile) ? 'EUR' : (domicile === 'United Kingdom' ? 'GBP' : 'USD');
    geopolMatrix.currencyRisk.operational[opCur] = (geopolMatrix.currencyRisk.operational[opCur] || 0) + (weight * 100);

    // 4. Risk Contribution (ETF adjusted)
    const vol = sym.includes('-USD') ? 0.8 : (isETF ? 0.12 : (sector === 'Tecnología' ? 0.35 : 0.20));
    riskContributions.push({ symbol: h.symbol, weight: weightPct, contrib: weightPct * vol });
  }));

  // Blind Spot Detection
  if (criticalTaiwanConcentration > 15) {
    geopolMatrix.blindSpots.push({
      type: 'ALERTA CRÍTICA',
      msg: `Tu cartera tiene un <b>${criticalTaiwanConcentration.toFixed(1)}%</b> de dependencia real del Estrecho de Taiwán. Un conflicto en la zona afectaría masivamente a tus activos tecnológicos (ASML/NVDA/TSM).`,
      color: 'var(--red)'
    });
  }
  if (geopolMatrix.revenueRisk['China'] > 25) {
    geopolMatrix.blindSpots.push({
      type: 'RIESGO REGULATORIO',
      msg: `Alta exposición a ingresos en China (<b>${geopolMatrix.revenueRisk['China'].toFixed(1)}%</b>). Vulnerable a sanciones cruzadas y cambios de política en Pekín.`,
      color: 'var(--yellow)'
    });
  }

  // Update Score & HHI
  const totalRiskProxy = riskContributions.reduce((sum, r) => sum + r.contrib, 0);
  riskContributions.forEach(r => r.percent = (r.contrib / (totalRiskProxy || 1)) * 100);
  const hhi = holdings.reduce((sum, h) => sum + Math.pow((parseFloat(h.currentValue) || 0) / totalValue, 2), 0);
  const sectorConc = Object.values(sectors).reduce((sum, w) => sum + Math.pow(w/100, 2), 0);
  const enb = Math.min(holdings.length, 1 / (hhi * 0.6 + sectorConc * 0.4));
  let score = Math.round((enb / Math.min(8, holdings.length)) * 50 + (1 - hhi) * 50);
  score = Math.max(10, Math.min(100, score));

  // RENDER UI
  if (scoreEl) {
    scoreEl.textContent = score;
    scoreEl.style.color = score > 75 ? 'var(--green)' : (score > 45 ? 'var(--yellow)' : 'var(--red)');
    document.getElementById('divers-score-label').textContent = score > 75 ? 'Óptimo' : (score > 45 ? 'Mejorable' : 'Crítico');
  }
  document.getElementById('divers-enb').textContent = enb.toFixed(1);
  document.getElementById('divers-hhi').textContent = hhi.toFixed(2);

  // Blind Spots UI
  const alertBadge = document.getElementById('geopol-alert-badge');
  const blindSpotsEl = document.getElementById('geopol-blind-spots');
  alertBadge.textContent = geopolMatrix.blindSpots.length > 0 ? 'Riesgo Detectado' : 'Sin Alertas Críticas';
  alertBadge.style.background = geopolMatrix.blindSpots.length > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
  alertBadge.style.color = geopolMatrix.blindSpots.length > 0 ? 'var(--red)' : 'var(--green)';
  
  blindSpotsEl.innerHTML = geopolMatrix.blindSpots.map(s => `
    <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: 12px; border-left: 4px solid ${s.color};">
      <div style="font-size: 0.7rem; font-weight: 800; color: ${s.color}; margin-bottom: 6px;">${s.type}</div>
      <div style="font-size: 0.85rem; line-height: 1.5;">${s.msg}</div>
    </div>
  `).join('') || '<div style="grid-column: span 2; color: var(--text-muted); text-align:center;">No se han detectado dependencias geopolíticas críticas en el análisis de triple capa.</div>';

  // Currency Impact UI
  const currImpactEl = document.getElementById('divers-currency-impact');
  const usdExposure = geopolMatrix.currencyRisk.listing['USD'] || 0;
  const eurExposure = geopolMatrix.currencyRisk.operational['EUR'] || 0;
  currImpactEl.innerHTML = `
    <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px;">
      <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">Sensibilidad USD (-10%)</div>
      <div style="font-size: 1.1rem; font-weight: 700; color: var(--red);">${-(usdExposure * 0.1).toFixed(2)}% <span style="font-size: 0.8rem; font-weight: 400; color: var(--text-muted);">en tu divisa base</span></div>
    </div>
    <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.4;">
      El <b>${usdExposure.toFixed(1)}%</b> de tus activos cotizan en USD, pero solo el <b>${(100 - eurExposure).toFixed(1)}%</b> operan fuera de la Eurozona. Riesgo de conversión detectado.
    </div>
  `;

  // Standard Charts
  createDoughnutChart('chart-divers-sector', Object.keys(sectors), Object.values(sectors), 'divers-sector-legend');
  createDoughnutChart('chart-divers-region', Object.keys(regions), Object.values(regions), 'divers-region-legend');
  createDoughnutChart('chart-divers-revenue', Object.keys(geopolMatrix.revenueRisk), Object.values(geopolMatrix.revenueRisk), null);
  
  const riskData = riskContributions.sort((a,b) => b.percent - a.percent).slice(0, 6);
  createHorizontalBarChart('chart-divers-risk-contrib', riskData.map(r => r.symbol), riskData.map(r => r.percent));

  // Stress Test & Rebalance
  const stressEl = document.getElementById('divers-stress-test');
  const rebalanceEl = document.getElementById('divers-rebalance');
  const techExposure = sectors['Tecnología'] || 0;
  
  stressEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;"><span>Crisis 2008</span><span style="color: var(--red); font-weight:700;">-32.4%</span></div>
    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;"><span>Shock Tipos</span><span style="color: var(--red); font-weight:700;">-${(techExposure * 0.3).toFixed(1)}%</span></div>
    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;"><span>Escalación Taiwán</span><span style="color: var(--red); font-weight:700;">-${(criticalTaiwanConcentration * 1.5).toFixed(1)}%</span></div>
  `;

  // Rebalance Pro Algorithm
  const suggestions = [];
  const topAssets = [...riskContributions].sort((a,b) => b.weight - a.weight);
  
  if (topAssets[0] && topAssets[0].weight > 20) {
    suggestions.push(`Recortar <b>${topAssets[0].symbol}</b> (Concentración del ${topAssets[0].weight.toFixed(1)}%)`);
  }
  
  if (techExposure > 40) {
    suggestions.push(`Reducir exposición a <b>Tecnología</b> (${techExposure.toFixed(1)}%)`);
  }

  const criticalGeopol = geopolMatrix.revenueRisk['China'] + criticalTaiwanConcentration;
  if (criticalGeopol > 30) {
    suggestions.push(`Añadir activos <b>defensivos/locales</b> (Riesgo Asia elevado)`);
  }

  if (hhi > 0.15) {
    suggestions.push(`Añadir 2-3 activos <b>no correlacionados</b> (Baja diversidad)`);
  }

  if (suggestions.length === 0) {
    suggestions.push(`Cartera equilibrada. Mantener <b>revisión mensual</b>.`);
  }

  if (rebalanceEl) {
    rebalanceEl.innerHTML = suggestions.map(s => `
      <div style="display: flex; align-items: flex-start; gap: 10px; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" style="width: 14px; margin-top: 2px;"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
        <div style="font-size: 0.85rem;">${s}</div>
      </div>
    `).join('');
  }
}

// ===== Tax Simulator Logic =====
function setupTaxSimulator() {
  const modal = document.getElementById('modal-tax');
  const btnOpen = document.getElementById('btn-open-tax');
  const btnClose = document.getElementById('modal-close-tax');
  const btnRunExit = document.getElementById('btn-run-tax-exit');
  const residenceSelect = document.getElementById('tax-residence');

  if (!modal || !btnOpen || !btnClose) return;

  btnOpen.addEventListener('click', () => {
    modal.style.display = 'flex';
    updateTaxSimulation();
  });

  btnClose.addEventListener('click', () => modal.style.display = 'none');
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  residenceSelect.addEventListener('change', updateTaxSimulation);
  btnRunExit.addEventListener('click', () => {
    let amount = parseFloat(document.getElementById('tax-exit-amount').value);
    if (!isNaN(amount) && amount > 0) {
      // Cap at total portfolio value
      const eurPerUsd = fxRates['eur'] || 0.92;
      const totalPortfolioValueEUR = currentStats.holdings.reduce((sum, h) => sum + (h.currentValue * (h.currency === 'USD' ? eurPerUsd : 1)), 0);
      
      if (amount > totalPortfolioValueEUR) {
        amount = totalPortfolioValueEUR;
        document.getElementById('tax-exit-amount').value = amount.toFixed(2);
      }
      
      runTaxExitStrategy(amount);
    }
  });

  const btnMax = document.getElementById('btn-tax-exit-max');
  if (btnMax) {
    btnMax.addEventListener('click', () => {
      const eurPerUsd = fxRates['eur'] || 0.92;
      const totalPortfolioValueEUR = currentStats.holdings.reduce((sum, h) => sum + (h.currentValue * (h.currency === 'USD' ? eurPerUsd : 1)), 0);
      document.getElementById('tax-exit-amount').value = totalPortfolioValueEUR.toFixed(2);
    });
  }
  const btnSingleMax = document.getElementById('btn-tax-single-max');
  const btnRunSingle = document.getElementById('btn-run-single-tax');

  if (btnRunSingle) {
    btnRunSingle.addEventListener('click', () => {
      const sym = document.getElementById('tax-single-symbol').value;
      const amount = parseFloat(document.getElementById('tax-single-amount').value);
      if (sym && !isNaN(amount) && amount > 0) {
        runSingleAssetTaxSimulation(sym, amount);
      }
    });
  }

  if (btnSingleMax) {
    btnSingleMax.addEventListener('click', () => {
      const sym = document.getElementById('tax-single-symbol').value;
      if (!sym) return;
      const eurPerUsd = fxRates['eur'] || 0.92;
      const hold = currentStats.holdings.find(h => h.symbol === sym);
      if (hold) {
        const valEUR = hold.currentValue * (hold.currency === 'USD' ? eurPerUsd : 1);
        document.getElementById('tax-single-amount').value = valEUR.toFixed(2);
      }
    });
  }
}

function updateTaxSimulation() {
  if (!currentStats || !currentStats.holdings) {
    showToast('Calculando datos del dashboard...', 'info');
    return;
  }

  const residence = document.getElementById('tax-residence').value;
  const tableBody = document.getElementById('tax-positions-table');
  const harvestingList = document.getElementById('tax-harvesting-list');
  const alertsList = document.getElementById('tax-alerts-list');
  
  tableBody.innerHTML = '';
  harvestingList.innerHTML = '';
  alertsList.innerHTML = '';

  // Always use individual stocks for tax simulation, even in 'All Portfolios' mode
  const taxAssets = (getActivePortfolioId() === 'all' && currentStats.combinedHoldings) 
    ? currentStats.combinedHoldings 
    : currentStats.holdings;

  const singleSelect = document.getElementById('tax-single-symbol');
  if (singleSelect) {
    const currentVal = singleSelect.value;
    singleSelect.innerHTML = taxAssets.map(h => `<option value="${h.symbol}" ${h.symbol === currentVal ? 'selected' : ''}>${h.symbol}</option>`).join('');
  }

  let totalNetGainEUR = 0;
  let totalPotentialLosses = 0;
  
  const eurPerUsdNow = fxRates['eur'] || 0.92; 

  const positionResults = taxAssets.map(h => {
    const boughtInUSD = h.currency === 'USD';
    const fxNow = boughtInUSD ? eurPerUsdNow : 1;
    
    // Valor actual en EUR
    const valEUR = h.currentValue * fxNow;
    
    // FISCALIDAD: La ganancia patrimonial es Valor_Venta_EUR - Valor_Compra_EUR
    // h.investedEUR es el coste histórico ya convertido a EUR en el momento de la compra
    const gainEUR = valEUR - h.investedEUR;
    
    // Aislamiento informativo del Efecto Divisa:
    // (Invertido_USD) * (Tipo_Cambio_Actual - Tipo_Cambio_Compra)
    let fxEffectEUR = 0;
    if (boughtInUSD) {
      const fxBuy = h.invested > 0 ? (h.investedEUR / h.invested) : fxNow;
      fxEffectEUR = h.invested * (fxNow - fxBuy);
    }

    return {
      sym: h.symbol,
      gain: gainEUR,
      fx: fxEffectEUR,
      value: valEUR,
      isLoss: gainEUR < 0
    };
  });

  // El neto fiscal real (lo que Hacienda grava) es la suma de los gainEUR
  totalNetGainEUR = positionResults.reduce((sum, r) => sum + r.gain, 0);
  totalPotentialLosses = positionResults.reduce((sum, r) => sum + (r.isLoss ? Math.abs(r.gain) : 0), 0);

  const totalTax = calculateProgressiveTax(totalNetGainEUR, residence);

  positionResults.forEach(r => {
    const propTax = (r.gain > 0 && totalNetGainEUR > 0) ? (r.gain / totalNetGainEUR) * totalTax : 0;
    const netoReal = r.value - propTax;
    const assetProfit = r.gain - r.fx;

    tableBody.innerHTML += `
      <tr style="border-bottom: 1px solid var(--border-card);">
        <td style="padding: 12px 8px; font-weight: 600;">${r.sym}</td>
        <td style="padding: 12px 8px; color: ${assetProfit >= 0 ? '#10b981' : '#ef4444'}">${assetProfit >= 0 ? '+' : ''}${assetProfit.toFixed(2)}€</td>
        <td style="padding: 12px 8px; color: ${r.fx >= 0 ? '#10b981' : '#ef4444'}">${r.fx >= 0 ? '+' : ''}${r.fx.toFixed(2)}€</td>
        <td style="padding: 12px 8px; font-weight: 700; color: ${r.gain >= 0 ? '#10b981' : '#ef4444'}">${r.gain >= 0 ? '+' : ''}${r.gain.toFixed(2)}€</td>
        <td style="padding: 12px 8px; color: ${propTax > 0 ? '#ef4444' : 'var(--text-muted)'}">${propTax.toFixed(2)}€</td>
        <td style="padding: 12px 8px; font-weight: 800; color: var(--text-primary);">${netoReal.toFixed(2)}€</td>
      </tr>
    `;

    if (r.isLoss) {
      harvestingList.innerHTML += `
        <div style="background: rgba(16, 185, 129, 0.05); padding: 12px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 10px;">
          <div style="font-size: 0.85rem; line-height: 1.4;">
            Vender <b>${r.sym}</b> compensaría tus beneficios actuales y ahorrarías <b>${(Math.abs(r.gain) * 0.19).toFixed(2)}€</b> en tu liquidación fiscal.
          </div>
        </div>
      `;
    }
  });

  document.getElementById('tax-total-liability').textContent = `${totalTax.toFixed(2)}€`;
  document.getElementById('tax-realized-gains').textContent = `${totalNetGainEUR.toFixed(2)}€`;
  document.getElementById('tax-potential-harvest').textContent = `${totalPotentialLosses.toFixed(2)}€`;
  document.getElementById('tax-effective-rate').textContent = `Tipo efectivo: ${(totalNetGainEUR > 0 ? (totalTax / totalNetGainEUR) * 100 : 0).toFixed(2)}%`;

  renderTaxBrackets(residence);
}

function calculateProgressiveTax(amount, residence) {
  if (amount <= 0) return 0;
  let tax = 0;
  let remaining = amount;

  const t1 = Math.min(remaining, 6000);
  tax += t1 * 0.19;
  remaining -= t1;

  if (remaining > 0) {
    const t2 = Math.min(remaining, 44000);
    tax += t2 * 0.21;
    remaining -= t2;
  }

  if (remaining > 0) {
    const t3 = Math.min(remaining, 150000);
    tax += t3 * 0.23;
    remaining -= t3;
  }

  if (remaining > 0) {
    const t4 = Math.min(remaining, 100000);
    tax += t4 * 0.27;
    remaining -= t4;
  }

  if (remaining > 0) tax += remaining * 0.28;

  return tax;
}

function renderTaxBrackets(residence) {
  const list = document.getElementById('tax-brackets-list');
  const brackets = [
    { limit: '0 - 6.000€', rate: '19%' },
    { limit: '6.000 - 50.000€', rate: '21%' },
    { limit: '50.000 - 200.000€', rate: '23%' },
    { limit: '200.000 - 300.000€', rate: '27%' },
    { limit: '> 300.000€', rate: '28%' }
  ];
  list.innerHTML = brackets.map(b => `
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
      <span style="color: var(--text-secondary);">${b.limit}</span>
      <span style="font-weight: 600; color: var(--yellow);">${b.rate}</span>
    </div>
  `).join('');
}

function runTaxExitStrategy(targetAmount) {
  const strategyEl = document.getElementById('tax-exit-strategy');
  const detailsEl = document.getElementById('tax-exit-details');
  strategyEl.style.display = 'block';

  const eurPerUsdNow = fxRates['eur'] || 0.92;

  const analysis = currentStats.holdings.map(h => {
    const boughtInUSD = h.currency === 'USD';
    const fxNow = boughtInUSD ? eurPerUsdNow : 1;
    const valEUR = h.currentValue * fxNow;
    
    // Ganancia fiscal real (incluye efecto divisa)
    const gainEUR = valEUR - h.investedEUR;

    return { 
      ...h, 
      valEUR, 
      gainEUR, 
      efficiency: gainEUR / valEUR 
    };
  }).sort((a, b) => a.efficiency - b.efficiency);

  let remaining = targetAmount;
  const sales = {};

  analysis.forEach(pos => {
    if (remaining <= 0) return;
    const takeValue = Math.min(pos.valEUR, remaining);
    const sharesToSell = takeValue / ((pos.quote?.price || pos.purchasePrice) * (pos.currency === 'USD' ? eurPerUsdNow : 1));
    
    if (sharesToSell > 0) {
      if (!sales[pos.symbol]) sales[pos.symbol] = { shares: 0, valueTotal: 0, tax: 0, gainEURTotal: 0 };
      sales[pos.symbol].shares += sharesToSell;
      sales[pos.symbol].valueTotal += takeValue;
      const gainPortion = (pos.gainEUR / pos.valEUR) * takeValue;
      sales[pos.symbol].gainEURTotal += gainPortion;
      remaining -= takeValue;
    }
  });

  const totalSimulatedGain = Object.values(sales).reduce((s, d) => s + d.gainEURTotal, 0);
  const totalSimulatedTax = calculateProgressiveTax(totalSimulatedGain, 'ES');
  const sumPositiveGains = Object.values(sales).reduce((s, d) => s + (d.gainEURTotal > 0 ? d.gainEURTotal : 0), 0);

  Object.values(sales).forEach(s => {
    if (s.gainEURTotal > 0 && sumPositiveGains > 0) {
      s.tax = (s.gainEURTotal / sumPositiveGains) * totalSimulatedTax;
    } else {
      s.tax = 0;
    }
  });

  detailsEl.innerHTML = Object.entries(sales).map(([sym, data]) => `
    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 16px; border-radius: 8px;">
      <div>
        <div style="font-weight: 700; color: var(--accent-primary);">${sym}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">Vender ${data.shares.toFixed(4)} acciones</div>
      </div>
      <div style="text-align: right;">
        <div style="font-weight: 700;">${data.valueTotal.toFixed(2)}€</div>
        <div style="font-size: 0.75rem;">
          ${data.tax > 0 
            ? `<span style="color: #ef4444;">Impuesto: ${data.tax.toFixed(2)}€</span>` 
            : `<span style="color: #10b981;">Compensado con pérdidas</span>`}
        </div>
      </div>
    </div>
  `).join('') + `
    <div style="margin-top: 20px; padding: 20px; border-radius: 12px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600;">NETO REAL ESTIMADO:</span>
        <span style="font-size: 1.6rem; font-weight: 900; color: #10b981;">${(targetAmount - totalSimulatedTax).toFixed(2)}€</span>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); text-align: center; margin-top: 8px;">
        Venta Bruta (${targetAmount.toFixed(2)}€) - Impuesto Est. (${totalSimulatedTax.toFixed(2)}€)
      </div>
    </div>
  `;
}

function runSingleAssetTaxSimulation(sym, targetAmount) {
  const strategyEl = document.getElementById('tax-exit-strategy');
  const detailsEl = document.getElementById('tax-exit-details');
  strategyEl.style.display = 'block';

  const eurPerUsdNow = fxRates['eur'] || 0.92;
  const hold = currentStats.holdings.find(h => h.symbol === sym);
  if (!hold) return;

  const boughtInUSD = hold.currency === 'USD';
  const fxNow = boughtInUSD ? eurPerUsdNow : 1;
  const totalValEUR = hold.currentValue * fxNow;
  
  const finalAmount = Math.min(targetAmount, totalValEUR);
  const sharesToSell = finalAmount / ((hold.quote?.price || hold.purchasePrice) * fxNow);
  
  // Ganancia fiscal de la parte proporcional vendida
  const totalGainEUR = totalValEUR - hold.investedEUR;
  const gainPortion = (totalGainEUR / totalValEUR) * finalAmount;
  
  const tax = calculateProgressiveTax(gainPortion, 'ES');

  detailsEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 16px; border-radius: 8px;">
      <div>
        <div style="font-weight: 700; color: #10b981;">SIMULACIÓN: ${sym}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">Vender ${sharesToSell.toFixed(4)} acciones</div>
      </div>
      <div style="text-align: right;">
        <div style="font-weight: 700;">${finalAmount.toFixed(2)}€</div>
        <div style="font-size: 0.75rem;">
          <span style="color: ${tax > 0 ? '#ef4444' : '#10b981'};">Impuesto Est: ${tax.toFixed(2)}€</span>
        </div>
      </div>
    </div>
    <div style="margin-top: 20px; padding: 20px; border-radius: 12px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600;">NETO DISPONIBLE:</span>
        <span style="font-size: 1.6rem; font-weight: 900; color: #10b981;">${(finalAmount - tax).toFixed(2)}€</span>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); text-align: center; margin-top: 8px;">
        Venta Bruta (${finalAmount.toFixed(2)}€) - Impuesto Est. (${tax.toFixed(2)}€)
      </div>
    </div>
  `;
}

// ===== Admin Panel Logic =====
async function setupAdminPanel() {
  const listContainer = document.getElementById('admin-users-list');
  const refreshBtn = document.getElementById('btn-refresh-users');
  if (!listContainer || !refreshBtn) return;

  const loadUsers = async () => {
    listContainer.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px;">Cargando usuarios...</td></tr>';
    const result = await getAllUsers();
    
    if (result.success) {
      if (result.users.length === 0) {
        listContainer.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px;">No hay usuarios registrados.</td></tr>';
        return;
      }

      listContainer.innerHTML = result.users.map(user => `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 32px; height: 32px; background: rgba(255,255,255,0.05); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.8rem;">
                ${user.name ? user.name.charAt(0).toUpperCase() : '?'}
              </div>
              <span>${user.name || 'Sin nombre'}</span>
            </div>
          </td>
          <td>${user.email}</td>
          <td>
            <span class="status-badge" style="background: ${getStatusColor(user.status)}20; color: ${getStatusColor(user.status)}; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
              ${user.status.toUpperCase()}
            </span>
          </td>
          <td><code style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--accent-secondary);">${user.license_code || '---'}</code></td>
          <td>${new Date(user.created_at).toLocaleDateString()}</td>
          <td style="text-align: right;">
            ${user.status === 'pending_approval' ? 
              `<button class="btn-approve-user" data-email="${user.email}" style="background: var(--green); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; cursor: pointer; margin-right: 8px;">Aprobar</button>` : ''
            }
            <button class="btn-delete-user" data-email="${user.email}" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; cursor: pointer;">Eliminar</button>
          </td>
        </tr>
      `).join('');

      // Add listeners to new buttons
      listContainer.querySelectorAll('.btn-approve-user').forEach(btn => {
        btn.onclick = () => handleAdminApproval(btn.dataset.email).then(() => loadUsers());
      });
      listContainer.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.onclick = () => handleAdminUserDeletion(btn.dataset.email).then(() => loadUsers());
      });
    } else {
      showToast('Error al cargar usuarios', 'error');
    }
  };

  refreshBtn.onclick = loadUsers;
  loadUsers();
}

function getStatusColor(status) {
  switch (status) {
    case 'active': return '#10b981';
    case 'pending_email': return '#6366f1';
    case 'pending_approval': return '#f59e0b';
    case 'pending_license': return '#06b6d4';
    default: return 'var(--text-muted)';
  }
}

async function handleAdminUserDeletion(email) {
  if (confirm(`¿Estás seguro de que quieres eliminar permanentemente a ${email}?`)) {
    const result = await adminDeleteUser(email);
    if (result.success) {
      showToast('Usuario eliminado', 'success');
      return true;
    } else {
      showToast('Error al eliminar', 'error');
      return false;
    }
  }
  return false;
}
