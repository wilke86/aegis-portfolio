import fetch from 'node-fetch';

export const handler = async (event) => {
  const fullPath = event.path;
  let targetPath = '';
  
  // Extraer la ruta limpia
  if (fullPath.includes('/yahoo/y/')) targetPath = fullPath.split('/yahoo/y/')[1];
  else if (fullPath.includes('/yahoo/c/')) {
    targetPath = fullPath.split('/yahoo/c/')[1];
    if (targetPath.startsWith('quote')) targetPath = targetPath.replace('quote', 'v7/finance/quote');
    if (targetPath.startsWith('financials')) targetPath = targetPath.replace('financials', 'v10/finance/quoteSummary');
    if (targetPath.startsWith('quoteSummary')) targetPath = targetPath.replace('quoteSummary', 'v10/finance/quoteSummary');
  } else if (fullPath.includes('/yahoo/s/')) targetPath = fullPath.split('/yahoo/s/')[1];
  else targetPath = fullPath.replace('/.netlify/functions/yahoo', '');

  if (!targetPath) return { statusCode: 400, body: "No path" };

  // Forzamos query2, que suele estar menos bloqueado
  const domain = 'query2.finance.yahoo.com';
  const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
  const targetUrl = `https://${domain}${targetPath.startsWith('/') ? '' : '/'}${targetPath}${queryString}`;

  // User-Agent de iPhone (estos suelen saltarse los bloqueos de "datacenter")
  const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/'
      }
    });

    if (!response.ok) {
      return { 
        statusCode: response.status, 
        body: JSON.stringify({ error: "Yahoo Blocked", status: response.status }) 
      };
    }

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
