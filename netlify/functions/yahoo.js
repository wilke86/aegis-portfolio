import fetch from 'node-fetch';

let cachedCookie = '';
let cachedCrumb = '';

export const handler = async (event) => {
  const fullPath = event.path;
  let targetPath = '';
  let domain = 'query1.finance.yahoo.com';

  // Mapeo inteligente de rutas
  if (fullPath.includes('/api/yahoo')) {
    targetPath = fullPath.split('/api/yahoo')[1];
  } else if (fullPath.includes('/api/custom-yahoo')) {
    targetPath = fullPath.split('/api/custom-yahoo')[1];
    // Ajustes para alias comunes
    if (targetPath.startsWith('/quote')) targetPath = targetPath.replace('/quote', '/v7/finance/quote');
    if (targetPath.startsWith('/financials')) targetPath = targetPath.replace('/financials', '/v10/finance/quoteSummary');
    if (targetPath.startsWith('/quoteSummary')) targetPath = targetPath.replace('/quoteSummary', '/v10/finance/quoteSummary');
  } else if (fullPath.includes('/api/search')) {
    targetPath = fullPath.split('/api/search')[1];
    domain = 'query2.finance.yahoo.com'; // La búsqueda suele ir a query2
  } else {
    targetPath = fullPath.replace('/.netlify/functions/yahoo', '');
  }

  if (!targetPath || targetPath === '/') {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid path" }) };
  }

  const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  try {
    if (!cachedCookie) {
      const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': USER_AGENT } });
      const setCookie = cookieRes.headers.get('set-cookie');
      if (setCookie) cachedCookie = setCookie.split(';')[0];
    }

    if (!cachedCrumb && cachedCookie) {
      const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'Cookie': cachedCookie, 'User-Agent': USER_AGENT }
      });
      if (crumbRes.ok) cachedCrumb = await crumbRes.text();
    }

    // Construir URL final con parámetros de búsqueda si existen
    const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
    let targetUrl = `https://${domain}${targetPath}${queryString}`;
    
    // Añadir crumb si es necesario
    if (targetPath.includes('/chart/') || targetPath.includes('/quoteSummary/')) {
      if (cachedCrumb) {
        targetUrl += (targetUrl.includes('?') ? '&' : '?') + `crumb=${cachedCrumb}`;
      }
    }

    const response = await fetch(targetUrl, {
      headers: {
        'Cookie': cachedCookie,
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Origin': 'https://finance.yahoo.com',
        'Referer': 'https://finance.yahoo.com/'
      }
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message, path: targetPath })
    };
  }
};
