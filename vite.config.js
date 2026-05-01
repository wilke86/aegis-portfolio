export default {
  server: {
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      },
      '/api/search': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/search/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      },
      '/api/logo-clearbit': {
        target: 'https://logo.clearbit.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/logo-clearbit/, ''),
      },
      '/api/logo-fmp': {
        target: 'https://financialmodelingprep.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/logo-fmp/, ''),
      },
    },
  },
  plugins: [
    {
      name: 'yahoo-finance-proxy',
      configureServer(server) {
        let cachedCookie = '';
        let cachedCrumb = '';

        server.middlewares.use('/api/custom-yahoo', async (req, res, next) => {
          // Normalize URL: remove /api/custom-yahoo prefix if it exists (though usually it is already stripped by vite)
          const cleanUrl = req.url.replace(/^\/api\/custom-yahoo/, '');
          
          if (!cleanUrl.startsWith('/quote') && !cleanUrl.startsWith('/quoteSummary') && !cleanUrl.startsWith('/financials')) {
            return next();
          }

          try {
            const url = new URL(cleanUrl, `http://${req.headers.host}`);
            const isQuote = cleanUrl.startsWith('/quote');
            const isSummary = cleanUrl.startsWith('/quoteSummary');
            
            // Extract symbol: from query param or from path
            let symbols = url.searchParams.get('symbols') || url.searchParams.get('symbol');
            if (!symbols && isSummary) {
              const parts = cleanUrl.split('/');
              // URL format: /quoteSummary/AAPL?modules=...
              symbols = parts[2] ? parts[2].split('?')[0] : '';
            }

            if (!symbols) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'Missing symbol(s)' }));
            }

            if (!cachedCrumb) {
              // Get Cookie
              const cookieRes = await fetch('https://fc.yahoo.com', { 
                redirect: 'manual',
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
              });
              const cookies = cookieRes.headers.get('set-cookie');
              cachedCookie = cookies ? cookies.split(';').find(c => c.trim().startsWith('A3=')) || cookies.split(';')[0] : '';

              // Get Crumb
              const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
                headers: {
                  'Cookie': cachedCookie,
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
                }
              });
              if (crumbRes.ok) {
                cachedCrumb = await crumbRes.text();
              }
            }

            let targetUrl = '';
            if (isQuote) {
              targetUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&crumb=${cachedCrumb}`;
            } else if (isSummary) {
              const modules = url.searchParams.get('modules') || 'assetProfile,financialData';
              targetUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbols}?modules=${modules}&crumb=${cachedCrumb}`;
            } else {
              // Financials/default
              targetUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbols}?modules=incomeStatementHistory,earnings,calendarEvents,assetProfile&crumb=${cachedCrumb}`;
            }

            const apiRes = await fetch(targetUrl, {
              headers: {
                'Cookie': cachedCookie,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/',
                'Origin': 'https://finance.yahoo.com'
              }
            });
            
            if (!apiRes.ok) {
              if (apiRes.status === 401 || apiRes.status === 429) {
                cachedCrumb = '';
                cachedCookie = '';
              }
              const errText = await apiRes.text();
              res.statusCode = apiRes.status;
              return res.end(errText);
            }

            const data = await apiRes.json();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e) {
            console.error('Proxy Error:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      }
    }
  ]
};
