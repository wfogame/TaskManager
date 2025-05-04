const http = require('http');
const https = require('https');
const { URL } = require('url');
const net = require('net');
const { parse: parseCookie } = require('cookie');
const { createBrotliDecompress, createGunzip } = require('zlib');
const { JSDOM } = require('jsdom');
const { v4: uuidv4 } = require('uuid');

const PORT = 3100;
const SESSION_COOKIE = 'proxy_session';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const sessions = new Map();

const server = http.createServer(async (clientReq, clientRes) => {
  try {
    // Validate request method
    if (clientReq.method !== 'GET' && clientReq.method !== 'POST') {
      clientRes.statusCode = 405;
      return clientRes.end('Method Not Allowed');
    }

    // Parse and validate URL parameter
    const urlParam = getUrlParam(clientReq.url);
    if (!urlParam) {
      clientRes.statusCode = 400;
      return clientRes.end('Missing URL parameter');
    }

    const targetUrl = safeParseUrl(urlParam);
    if (!targetUrl || !ALLOWED_PROTOCOLS.has(targetUrl.protocol)) {
      clientRes.statusCode = 400;
      return clientRes.end('Invalid URL');
    }

    // Session management
    const session = getOrCreateSession(clientReq, clientRes);
    
    // Prepare proxy request
    const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: clientReq.method,
      headers: createProxyHeaders(clientReq, targetUrl, session)
    });

    // Handle request body for POST
    if (clientReq.method === 'POST') {
      clientReq.pipe(proxyReq);
    } else {
      proxyReq.end();
    }

    // Handle proxy response
    const proxyRes = await new Promise(resolve => 
      proxyReq.on('response', resolve).on('error', () => resolve(null))
    );

    if (!proxyRes) {
      clientRes.statusCode = 502;
      return clientRes.end('Bad Gateway');
    }

    // Process cookies and redirects
    handleCookies(proxyRes, session, targetUrl);
    if (handleRedirects(proxyRes, clientRes, targetUrl)) return;

    // Process and rewrite content
    const contentInfo = await processContent(proxyRes, targetUrl);
    sendProxyResponse(clientRes, proxyRes, contentInfo);

  } catch (err) {
    console.error('Error:', err);
    clientRes.statusCode = 500;
    clientRes.end('Internal Server Error');
  }
});

// ======================
// Helper Functions
// ======================

function getUrlParam(url) {
  const queryString = url.split('?')[1] || '';
  const params = new URLSearchParams(queryString);
  return params.get('url');
}

function safeParseUrl(input) {
  try {
    const url = new URL(input);
    // Prevent SSRF attacks
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    if (url.hostname.match(/(^127\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2[0-9]\.)|(^172\.3[0-1]\.)|(^192\.168\.)/)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function getOrCreateSession(req, res) {
  let sessionId = parseCookie(req.headers.cookie || '')[SESSION_COOKIE];
  if (!sessionId || !sessions.has(sessionId)) {
    sessionId = uuidv4();
    sessions.set(sessionId, {
      cookies: {},
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    res.setHeader('Set-Cookie', [
      `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Secure`
    ]);
  }
  return sessions.get(sessionId);
}

function createProxyHeaders(clientReq, targetUrl, session) {
  const headers = { ...clientReq.headers };
  
  // Filter and set important headers
  return {
    host: targetUrl.host,
    cookie: formatCookiesForDomain(session.cookies, targetUrl.hostname),
    referer: targetUrl.origin,
    'user-agent': session.headers['User-Agent'],
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': session.headers['Accept-Language'],
    connection: 'close'
  };
}

async function processContent(proxyRes, targetUrl) {
  let body = await readStream(proxyRes);
  
  // Decompress if needed
  const encoding = proxyRes.headers['content-encoding'];
  if (encoding === 'gzip') body = await decompress(body, createGunzip());
  if (encoding === 'br') body = await decompress(body, createBrotliDecompress());

  // Rewrite based on content type
  const contentType = proxyRes.headers['content-type'] || '';
  
  if (contentType.includes('text/html')) {
    return { 
      body: await rewriteHtml(body.toString(), targetUrl),
      headers: { 'Content-Type': 'text/html' }
    };
  }
  
  if (contentType.includes('text/css')) {
    return {
      body: rewriteCss(body.toString(), targetUrl),
      headers: { 'Content-Type': 'text/css' }
    };
  }
  
  if (contentType.includes('javascript')) {
    return {
      body: rewriteJs(body.toString(), targetUrl),
      headers: { 'Content-Type': 'application/javascript' }
    };
  }

  return { body, headers: {} };
}

// ======================
// Content Rewriting
// ======================

async function rewriteHtml(html, targetUrl) {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Rewrite all links
    const attributes = ['href', 'src', 'action', 'data-src', 'poster'];
    attributes.forEach(attr => {
      document.querySelectorAll(`[${attr}]`).forEach(el => {
        const value = el.getAttribute(attr);
        if (value) el.setAttribute(attr, proxyUrl(value, targetUrl));
      });
    });

    // Rewrite meta tags
    document.querySelectorAll('meta[http-equiv="refresh"]').forEach(meta => {
      const content = meta.getAttribute('content');
      if (content) {
        const newContent = content.replace(/url=(.*)/i, (m, url) => 
          `url=${proxyUrl(url, targetUrl)}`
        );
        meta.setAttribute('content', newContent);
      }
    });

    return dom.serialize();
  } catch (err) {
    console.error('HTML rewrite error:', err);
    return html;
  }
}

function proxyUrl(originalUrl, baseUrl) {
  try {
    const url = new URL(originalUrl, baseUrl);
    return `/?url=${encodeURIComponent(url.href)}`;
  } catch {
    return originalUrl;
  }
}

server.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));