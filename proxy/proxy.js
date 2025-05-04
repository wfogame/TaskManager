const http = require('http');
const https = require('https');
const { URL } = require('url');
const { createBrotliDecompress, createGunzip } = require('zlib');
const { JSDOM } = require('jsdom');
const { v4: uuidv4 } = require('uuid');

const PORT = 3100;
const SESSION_COOKIE = 'proxy_session';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const sessions = new Map();

// Debugging setup
const debug = {
  log: (...args) => console.log('[DEBUG]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
};

// ======================
// Core Cookie Functions
// ======================

function formatCookiesForDomain(cookieStore, targetDomain) {
  return Object.entries(cookieStore)
    .filter(([name, cookie]) => {
      const domainMatch = targetDomain.endsWith(cookie.domain) || 
                          `.${targetDomain}`.endsWith(cookie.domain);
      const pathMatch = cookie.path === '/' || 
                       targetDomain.startsWith(cookie.path);
      const notExpired = !cookie.expires || new Date(cookie.expires) > new Date();
      return domainMatch && pathMatch && notExpired;
    })
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join('; ');
}

function handleCookies(proxyRes, session, targetUrl) {
  const setCookieHeaders = proxyRes.headers['set-cookie'] || [];
  setCookieHeaders.forEach(header => {
    const cookie = parseSetCookie(header, targetUrl);
    if (cookie) {
      session.cookies[cookie.name] = cookie;
      debug.log(`Stored cookie: ${cookie.name} (Domain: ${cookie.domain})`);
    }
  });
}

function parseSetCookie(cookieString, targetUrl) {
  try {
    const parts = cookieString.split(';').map(p => p.trim());
    const [nameValue, ...attributes] = parts;
    const [name, value] = nameValue.split('=', 2);

    const cookie = {
      name: name.trim(),
      value: decodeURIComponent(value.trim()),
      domain: targetUrl.hostname,
      path: '/',
      expires: null
    };

    attributes.forEach(attr => {
      const [key, val] = attr.split('=');
      const lowerKey = key.toLowerCase().trim();
      if (lowerKey === 'domain') cookie.domain = val.replace(/^\./, '').trim();
      if (lowerKey === 'path') cookie.path = val.trim();
      if (lowerKey === 'expires') cookie.expires = new Date(val);
      if (lowerKey === 'max-age') cookie.expires = new Date(Date.now() + parseInt(val) * 1000);
    });

    return cookie;
  } catch (err) {
    debug.error('Cookie parse error:', err);
    return null;
  }
}

// ======================
// Core Proxy Functionality
// ======================

async function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function decompress(buffer, transform) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    transform.on('data', chunk => chunks.push(chunk));
    transform.on('end', () => resolve(Buffer.concat(chunks)));
    transform.on('error', reject);
    transform.end(buffer);
  });
}

const server = http.createServer(async (clientReq, clientRes) => {
  try {
    debug.log(`Incoming request: ${clientReq.method} ${clientReq.url}`);

    // Validate request method
    if (!['GET', 'POST'].includes(clientReq.method)) {
      clientRes.statusCode = 405;
      return clientRes.end('Method Not Allowed');
    }

    // Parse URL parameter
    const urlParam = new URL(clientReq.url, `http://${clientReq.headers.host}`).searchParams.get('url');
    if (!urlParam) {
      clientRes.statusCode = 400;
      return clientRes.end('Missing URL parameter');
    }

    // Validate target URL
    let targetUrl;
    try {
      targetUrl = new URL(urlParam);
      if (!ALLOWED_PROTOCOLS.has(targetUrl.protocol)) throw new Error('Invalid protocol');
      if (targetUrl.hostname.match(/(^127\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.)/)) {
        throw new Error('Private IP range');
      }
    } catch (err) {
      debug.error('Invalid URL:', err.message);
      clientRes.statusCode = 400;
      return clientRes.end('Invalid URL');
    }

    // Session management
    let sessionId = parseCookie(clientReq.headers.cookie || '')[SESSION_COOKIE];
    if (!sessionId || !sessions.has(sessionId)) {
      sessionId = uuidv4();
      sessions.set(sessionId, {
        cookies: {},
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      clientRes.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
    }
    const session = sessions.get(sessionId);

    // Create upstream request
    const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        host: targetUrl.host,
        cookie: formatCookiesForDomain(session.cookies, targetUrl.hostname),
        referer: targetUrl.origin,
        'user-agent': session.headers['User-Agent'],
        'accept-encoding': 'gzip, deflate, br'
      }
    });

    // Pipe request body
    if (clientReq.method === 'POST') {
      clientReq.pipe(proxyReq);
    } else {
      proxyReq.end();
    }

    // Handle upstream response
    const proxyRes = await new Promise(resolve => {
      proxyReq.on('response', resolve).on('error', err => {
        debug.error('Upstream error:', err);
        resolve(null);
      });
    });

    if (!proxyRes) {
      clientRes.statusCode = 502;
      return clientRes.end('Bad Gateway');
    }

    // Handle cookies and redirects
    handleCookies(proxyRes, session, targetUrl);
    if ([301, 302, 307, 308].includes(proxyRes.statusCode)) {
      const location = proxyRes.headers.location;
      clientRes.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        location: `/?url=${encodeURIComponent(new URL(location, targetUrl).href)}`
      });
      return clientRes.end();
    }

    // Process content
    const content = await processContent(proxyRes, targetUrl);
    clientRes.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'content-length': content.body.length,
      'content-security-policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' * data: blob:;"
    });
    clientRes.end(content.body);

  } catch (err) {
    debug.error('Critical error:', err);
    clientRes.statusCode = 500;
    clientRes.end('Internal Server Error');
  }
});

// ======================
// Content Processing
// ======================

async function processContent(proxyRes, targetUrl) {
  try {
    let body = await readStream(proxyRes);
    
    // Handle compression
    const encoding = proxyRes.headers['content-encoding'] || '';
    if (encoding.toLowerCase() === 'gzip') {
      body = await decompress(body, createGunzip());
    } else if (encoding.toLowerCase() === 'br') {
      body = await decompress(body, createBrotliDecompress());
    }

    // Determine content type
    const contentType = proxyRes.headers['content-type']?.split(';')[0] || 'text/plain';

    // Handle binary content
    if (!['text/html', 'text/css', 'application/javascript'].some(t => contentType.includes(t))) {
      return { body };
    }

    const textBody = body.toString('utf8');
    let modifiedBody = textBody;

    // HTML rewriting
    if (contentType.includes('text/html')) {
      const dom = new JSDOM(textBody);
      const document = dom.window.document;
      
      ['href', 'src', 'action'].forEach(attr => {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
          const value = el.getAttribute(attr);
          if (value) el.setAttribute(attr, proxyUrl(value, targetUrl));
        });
      });
      
      modifiedBody = dom.serialize();
    }

    // CSS rewriting
    if (contentType.includes('text/css')) {
      modifiedBody = textBody.replace(/url\(['"]?(.*?)['"]?\)/gi, (_, url) => {
        return `url("${proxyUrl(url, targetUrl)}")`;
      });
    }

    // JavaScript rewriting
    if (contentType.includes('javascript')) {
      modifiedBody = textBody.replace(/(['"])(https?:\/\/.*?)\1/g, (_, quote, url) => {
        return `${quote}${proxyUrl(url, targetUrl)}${quote}`;
      });
    }

    return { body: Buffer.from(modifiedBody) };

  } catch (err) {
    debug.error('Content processing failed:', err);
    return { body: Buffer.from('Error loading resource') };
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

// ======================
// Helper Functions
// ======================

function parseCookie(cookieHeader) {
  return cookieHeader.split(';').reduce((cookies, part) => {
    const [name, value] = part.split('=').map(s => s.trim());
    if (name) cookies[name] = value;
    return cookies;
  }, {});
}

server.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});