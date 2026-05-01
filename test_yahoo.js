const fetch = globalThis.fetch;

async function getDetailedQuote(symbol) {
  // 1. Get cookie
  const cookieRes = await fetch('https://fc.yahoo.com', { redirect: 'manual' });
  const cookies = cookieRes.headers.get('set-cookie');
  const cookie = cookies ? cookies.split(';')[0] : '';

  // 2. Get crumb
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });
  const crumb = await crumbRes.text();
  console.log('Crumb:', crumb);

  // 3. Get quote
  const quoteRes = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}&crumb=${crumb}`, {
    headers: {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });
  const data = await quoteRes.json();
  console.log(JSON.stringify(data).slice(0, 500));
}

getDetailedQuote('AAPL').catch(console.error);
