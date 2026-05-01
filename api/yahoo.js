import fetch from 'node-fetch';

let cachedCookie = '';
let cachedCrumb = '';

export default async function handler(req, res) {
  const { url } = req;
  const cleanUrl = url.replace('/api/yahoo', '');
  
  // Yahoo endpoints often require a crumb and a cookie
  // This function mimics the dev proxy logic
  
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

    // Determine target Yahoo URL based on the request
    let targetUrl = '';
    if (cleanUrl.startsWith('/v8/finance/chart')) {
      targetUrl = `https://query1.finance.yahoo.com${cleanUrl}`;
    } else if (cleanUrl.startsWith('/v1/finance/search')) {
      targetUrl = `https://query2.finance.yahoo.com${cleanUrl}`;
    } else if (cleanUrl.startsWith('/v7/finance/quote')) {
      targetUrl = `https://query1.finance.yahoo.com${cleanUrl}${cleanUrl.includes('?') ? '&' : '?'}crumb=${cachedCrumb}`;
    } else {
      // Default to query1
      targetUrl = `https://query1.finance.yahoo.com${cleanUrl}`;
    }

    const apiRes = await fetch(targetUrl, {
      headers: {
        'Cookie': cachedCookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://finance.yahoo.com/',
      }
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.status(apiRes.status).send(errText);
      return;
    }

    const data = await apiRes.json();
    res.status(200).json(data);
  } catch (e) {
    console.error('Vercel Proxy Error:', e);
    res.status(500).json({ error: e.message });
  }
}
