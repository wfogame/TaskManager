const http = require('http');
const https = require('https');
const { URL } = require('url');
const { createBrotliDecompress, createGunzip } = require('zlib');
const { JSDOM } = require('jsdom');
const { v4: uuidv4 } = require('uuid');
const { parse: parseIp, isMatch: isIpInCIDR } = require('ip6addr');

const PORT = process.env.PORT || 3100;
const SESSION_COOKIE = 'proxy_session';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const SESSION_TTL = 15 * 60 * 1000;
const sessions = new Map();

// Debugging with context
const debug = {
  log: (context, ...args) => console.log(`[${new Date().toISOString()}] [${context}]`, ...args),
  error: (context, ...args) => console.error(`[${new Date().toISOString()}] [${context}]`, ...args)
};

// ======================
// Security Functions
// ======================

async function isAllowedTarget(hostname) {
  try {
    const ip = await dnsLookup(hostname);
    return !isPrivateIP(ip);
  } catch (err) {
    return false;
  }
}

function isPrivateIP(ip) {
  try {
    const addr = parseIp(ip);
    return addr.match('10.0.0.0/8') ||
      addr.match('172.16.0.0/12') ||
      addr.match('192.168.0.0/16') ||
      addr.match('fd00::/8') ||
      addr.match('127.0.0.0/8') ||
      addr.match('::1/128');
  } catch {
    return false;
  }
}

function dnsLookup(hostname) {
  return new Promise((resolve, reject) => {
    require('dns').lookup(hostname, { family: 0 }, (err, address) => {
      err ? reject(err) : resolve(address);
    });
  });
}

// ======================
// Session Management
// ======================

function createSession() {
  const sessionId = uuidv4();
  const session = {
    id: sessionId,
    cookies: {},
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    createdAt: Date.now()
  };
  sessions.set(sessionId, session);
  return session;
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}

setInterval(cleanExpiredSessions, 5 * 60 * 1000);

// ======================
// Cookie Functions
// ======================

function parseCookie(cookieHeader) {
  return cookieHeader.split(';').reduce((cookies, part) => {
    const [name, value] = part.split('=').map(s => s.trim());
    if (name && value) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
    return cookies;
  }, {});
}

function formatCookiesForDomain(cookieStore, targetDomain) {
  return Object.entries(cookieStore)
    .filter(([_, cookie]) => cookieMatchesDomain(cookie, targetDomain))
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join('; ');
}

function cookieMatchesDomain(cookie, targetDomain) {
  const cookieDomain = cookie.domain?.toLowerCase() || '';
  const target = targetDomain.toLowerCase();

  if (cookieDomain === target) return true;
  if (cookieDomain.startsWith('.') && target.endsWith(cookieDomain.slice(1))) return true;
  if (!cookieDomain.startsWith('.') && target.endsWith(`.${cookieDomain}`)) return true;
  return false;
}

function handleCookies(proxyRes, session, targetUrl) {
  const setCookieHeaders = proxyRes.headers['set-cookie'] || [];
  setCookieHeaders.forEach(header => {
    const cookie = parseSetCookie(header, targetUrl);
    if (cookie) {
      session.cookies[cookie.name] = cookie;
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
    return null;
  }
}

// ======================
// Core Proxy Functionality
// ======================

const server = http.createServer(async (clientReq, clientRes) => {
  const contextId = uuidv4().slice(0, 8);
  const log = (...args) => debug.log(contextId, ...args);
  const error = (...args) => debug.error(contextId, ...args);

  try {
    log(`Request: ${clientReq.method} ${clientReq.url}`);

    if (!['GET', 'POST', 'HEAD'].includes(clientReq.method)) {
      clientRes.statusCode = 405;
      return clientRes.end('Method Not Allowed');
    }

    const urlParam = new URL(clientReq.url, `http://${clientReq.headers.host}`).searchParams.get('url');
    if (!urlParam) {
      clientRes.statusCode = 400;
      return clientRes.end('Missing URL parameter');
    }

    let targetUrl;
    try {
      targetUrl = new URL(urlParam);
      if (!ALLOWED_PROTOCOLS.has(targetUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch (err) {
      error('Invalid URL:', err.message);
      clientRes.statusCode = 400;
      return clientRes.end('Invalid URL');
    }

    if (!await isAllowedTarget(targetUrl.hostname)) {
      error('Blocked private IP access:', targetUrl.hostname);
      clientRes.statusCode = 403;
      return clientRes.end('Forbidden');
    }

    // Session handling
    let session = getSession(clientReq);
    if (!session) {
      session = createSession();
      clientRes.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Lax`);
    }

    // Proxy request setup
    const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: clientReq.method,
      headers: {
        ...filterHeaders(clientReq.headers),
        host: targetUrl.host,
        cookie: formatCookiesForDomain(session.cookies, targetUrl.hostname),
        'user-agent': session.headers['User-Agent'],
        'accept-encoding': 'gzip, deflate, br'
      }
    });

    // Request body handling
    if (clientReq.method === 'POST') {
      clientReq.pipe(proxyReq);
    } else {
      proxyReq.end();
    }

    // Handle response
    const proxyRes = await new Promise(resolve => {
      proxyReq.on('response', resolve).on('error', err => {
        error('Upstream error:', err);
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
      return handleRedirect(clientRes, proxyRes, targetUrl);
    }

    // Content processing
    const { headers, body } = await processResponse(proxyRes, targetUrl);
    clientRes.writeHead(proxyRes.statusCode, headers);
    clientRes.end(body);

  } catch (err) {
    error('Critical error:', err);
    clientRes.statusCode = 500;
    clientRes.end('Internal Server Error');
  }
});

// ======================
// Response Processing
// ======================

async function processResponse(proxyRes, targetUrl) {
  const headers = { ...proxyRes.headers };
  let body;

  try {
    const isTextContent = ['text/html', 'text/css', 'application/javascript']
      .some(t => headers['content-type']?.includes(t));

    if (isTextContent) {
      body = await processTextContent(proxyRes, targetUrl);
      headers['content-length'] = body.length;
    } else {
      body = await readStream(proxyRes);
    }

    delete headers['content-encoding'];
    return { headers, body };
  } catch (err) {
    return {
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('Error processing content')
    };
  }
}

async function processTextContent(proxyRes, targetUrl) {
  let body = await readStream(proxyRes);
  const encoding = proxyRes.headers['content-encoding'] || '';

  if (encoding.toLowerCase() === 'gzip') {
    body = await decompress(body, createGunzip());
  } else if (encoding.toLowerCase() === 'br') {
    body = await decompress(body, createBrotliDecompress());
  }

  const contentType = proxyRes.headers['content-type']?.split(';')[0] || 'text/plain';
  const textBody = body.toString('utf8');
  let modifiedBody = textBody;

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

  return Buffer.from(modifiedBody);
}

// ======================
// Helper Functions
// ======================

function getSession(req) {
  const cookies = parseCookie(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  return sessionId ? sessions.get(sessionId) : null;
}

function filterHeaders(headers) {
  const forbidden = ['host', 'cookie', 'connection', 'accept-encoding'];
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !forbidden.includes(k.toLowerCase()))
  );
}

function proxyUrl(originalUrl, baseUrl) {
  try {
    const url = new URL(originalUrl, baseUrl);
    return `/?url=${encodeURIComponent(url.href)}`;
  } catch {
    return originalUrl;
  }
}

function handleRedirect(clientRes, proxyRes, targetUrl) {
  const location = new URL(proxyRes.headers.location, targetUrl);
  clientRes.writeHead(proxyRes.statusCode, {
    ...proxyRes.headers,
    location: `/?url=${encodeURIComponent(location.href)}`
  });
  clientRes.end();
}

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

server.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});