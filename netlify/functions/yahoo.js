const fetch = require('node-fetch');

let cachedCookie = '';
let cachedCrumb = '';

exports.handler = async (event, context) => {
  const path = event.path.replace('/.netlify/functions/yahoo', '');
  
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
      body: JSON.stringify({ error: error.message })
    };
  }
};
