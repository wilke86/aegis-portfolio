import fetch from 'node-fetch';

let cachedCookie = '';
let cachedCrumb = '';

export const handler = async (event) => {
  // En Netlify, cuando usamos redirects, la ruta viene en event.path
  // Queremos extraer todo lo que va después de /api/yahoo o /.netlify/functions/yahoo
  let path = event.path.replace('/.netlify/functions/yahoo', '').replace('/api/yahoo', '');
  
  // Si la ruta está vacía, no podemos hacer nada
  if (!path || path === '/') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "No path provided" })
    };
  }

  try {
    if (!cachedCrumb || !cachedCookie) {
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
    if (path.startsWith('/v8/finance/chart')) {
      targetUrl = `https://query1.finance.yahoo.com${path}${path.includes('?') ? '&' : '?'}crumb=${cachedCrumb}`;
    } else {
      targetUrl = `https://query1.finance.yahoo.com${path}`;
    }

    const response = await fetch(targetUrl, {
      headers: {
        'Cookie': cachedCookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: "Yahoo API error", details: errorText })
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
