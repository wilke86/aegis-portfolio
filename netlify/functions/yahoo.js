import fetch from 'node-fetch';

export const handler = async (event) => {
  const fullPath = event.path;
  let targetPath = '';
  
  if (fullPath.includes('/yahoo/y/')) targetPath = fullPath.split('/yahoo/y/')[1];
  else if (fullPath.includes('/yahoo/c/')) {
    targetPath = fullPath.split('/yahoo/c/')[1];
    if (targetPath.startsWith('quote')) targetPath = targetPath.replace('quote', 'v7/finance/quote');
    if (targetPath.startsWith('financials')) targetPath = targetPath.replace('financials', 'v10/finance/quoteSummary');
    if (targetPath.startsWith('quoteSummary')) targetPath = targetPath.replace('quoteSummary', 'v10/finance/quoteSummary');
  } else if (fullPath.includes('/yahoo/s/')) targetPath = fullPath.split('/yahoo/s/')[1];
  else targetPath = fullPath.replace('/.netlify/functions/yahoo', '');

  if (!targetPath) return { statusCode: 400, body: "No path" };

  const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
  const yahooUrl = `https://query2.finance.yahoo.com${targetPath.startsWith('/') ? '' : '/'}${targetPath}${queryString}`;

  // Usamos AllOrigins como puente para saltar el bloqueo de IP de Netlify
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`;

  try {
    const response = await fetch(proxyUrl);
    const json = await response.json();
    
    if (!json.contents) {
      return { statusCode: 500, body: JSON.stringify({ error: "Proxy failed", details: json }) };
    }

    const data = JSON.parse(json.contents);

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
