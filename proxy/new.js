const http = require('http');
const https = require('https');
const { URL } = require('url');
const { createBrotliDecompress, createGunzip } = require('zlib');
const { JSDOM } = require('jsdom');
const { v4: uuidv4 } = require('uuid');
const { parse: parseIp, isMatch: isIpInCIDR } = require('ip6addr');
const path = require('path');
const PORT = process.env.PORT || 3100;
const SESSION_COOKIE = 'proxy_session';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const SESSION_TTL = 15 * 60 * 1000;
const sessions = new Map();
const fs = require('fs');
const mime = require('mime-types');

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
function getSession(clientReq) {
    const cookieHeader = clientReq.headers.cookie || '';
    const cookies = parseCookie(cookieHeader);
    const sessionId = cookies[SESSION_COOKIE];
    return sessions.get(sessionId);
  }
  
  function filterHeaders(originalHeaders) {
    const forbiddenHeaders = [
      'host', 'connection', 'referer',
      'cookie', 'authorization', 'content-length'
    ];
    return Object.entries(originalHeaders).reduce((acc, [key, value]) => {
      if (!forbiddenHeaders.includes(key.toLowerCase())) {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  

const server = http.createServer(async (clientReq, clientRes) => {
  const contextId = uuidv4().slice(0, 8);
  const log = (...args) => debug.log(contextId, ...args);
  const error = (...args) => debug.error(contextId, ...args);
  let clientClosed = false;

  // Handle client connection termination
  clientReq.on('close', () => {
    clientClosed = true;
  });

  try {
    // Handle root path
    if (clientReq.url === '/') {
      fs.readFile('proxy.html', (err, data) => {
        if (err) {
          clientRes.writeHead(500);
          clientRes.end('Internal Server Error');
          return;
        }
        clientRes.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Length': data.length
        });
        clientRes.end(data);
      });
      return;
    }

    // Fixed static file handling
    if (clientReq.url.match(/^\/(?:[^?]+\/)?[^?]+\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|webp)(\?.*)?$/i)) {
      const parsedUrl = new URL(clientReq.url, 'http://dummy');
      const filePath = path.join(__dirname, parsedUrl.pathname);
      const resolvedPath = path.resolve(filePath);

      if (!resolvedPath.startsWith(__dirname)) {
        clientRes.writeHead(403).end();
        return;
      }

      fs.readFile(resolvedPath, (err, data) => {
        if (err) {
          clientRes.writeHead(404).end();
          return;
        }
        
        const contentType = mime.contentType(path.extname(filePath)) || 'text/plain';
        clientRes.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400'
        }).end(data);
      });
      return;
    }

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

    let session = getSession(clientReq);
    if (!session) {
      session = createSession();
      clientRes.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Lax`);
    }

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

    // Handle client abort
    clientReq.on('aborted', () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    });

    // Handle proxy errors
    proxyReq.on('error', (err) => {
      if (!clientClosed && !clientRes.headersSent) {
        clientRes.statusCode = 502;
        clientRes.end('Bad Gateway');
      }
    });

    if (clientReq.method === 'POST') {
      clientReq.pipe(proxyReq);
    } else {
      proxyReq.end();
    }

    const proxyRes = await new Promise(resolve => {
      proxyReq.on('response', resolve).on('error', () => resolve(null));
    });

    if (!proxyRes || clientClosed) {
      if (!clientRes.headersSent) clientRes.end();
      return;
    }

    handleCookies(proxyRes, session, targetUrl);
    if ([301, 302, 307, 308].includes(proxyRes.statusCode)) {
      return handleRedirect(clientRes, proxyRes, targetUrl);
    }

    const { headers, body } = await processResponse(proxyRes, targetUrl);
    if (!clientClosed && !clientRes.headersSent) {
      clientRes.writeHead(proxyRes.statusCode, headers);
      clientRes.end(body);
    }
  } catch (err) {
    error('Critical error:', err);
    if (!clientClosed && !clientRes.headersSent) {
      clientRes.statusCode = 500;
      clientRes.end('Internal Server Error');
    }
  }
});

// ======================
// Response Processing
// ======================

async function processResponse(proxyRes, targetUrl) {
  const headers = { ...proxyRes.headers };
  let body;

  try {
    const isText = ['text/html', 'text/css', 'application/javascript']
      .some(t => headers['content-type']?.includes(t));

    if (isText) {
      body = await processTextContent(proxyRes, targetUrl);
      headers['content-length'] = Buffer.byteLength(body);
      delete headers['content-encoding'];
    } else {
      body = await readStream(proxyRes);
      headers['content-encoding'] = 'identity';
    }

    return { headers, body };
  } catch (err) {
    return { headers: {}, body: Buffer.alloc(0) };
  }
}

async function processTextContent(proxyRes, targetUrl) {
  let body = await readStream(proxyRes);
  const encoding = proxyRes.headers['content-encoding']?.toLowerCase() || '';

  if (encoding === 'gzip') {
    body = await decompress(body, createGunzip());
  } else if (encoding === 'br') {
    body = await decompress(body, createBrotliDecompress());
  }

  const contentType = proxyRes.headers['content-type']?.split(';')[0] || 'text/plain';
  let modifiedBody = body.toString('utf8');

  if (contentType.includes('text/html')) {
    const dom = new JSDOM(modifiedBody);
    const document = dom.window.document;

    const attributes = ['href', 'src', 'action', 'srcset', 'data-src', 'data-href', 'poster', 'content', 'cite'];
    
    attributes.forEach(attr => {
      document.querySelectorAll(`[${attr}]`).forEach(el => {
        const value = el.getAttribute(attr);
        if (!value) return;

        try {
          if (attr === 'srcset') {
            const newSrcset = value.split(',')
              .map(src => src.trim().split(/\s+/))
              .map(([url, ...rest]) => [proxyUrl(url, targetUrl), ...rest].join(' '))
              .join(', ');
            el.setAttribute(attr, newSrcset);
          } else if (!value.startsWith('javascript:') && !value.startsWith('data:')) {
            el.setAttribute(attr, proxyUrl(value, targetUrl));
          }
        } catch (err) {
          debug.error('URL Rewrite', `Error processing ${attr}: ${err.message}`);
        }
      });
    });

    if (!document.querySelector('base')) {
      const base = document.createElement('base');
      base.href = targetUrl.origin;
      document.head.prepend(base);
    }

    modifiedBody = dom.serialize();
  }

  return Buffer.from(modifiedBody);
}

function proxyUrl(originalUrl, baseUrl) {
  try {
    const url = new URL(originalUrl, baseUrl);
    const proxy = new URL('/?url=' + encodeURIComponent(url.href), `http://${clientReq.headers.host}`);
    
    // Preserve original query parameters
    const searchParams = new URLSearchParams(url.search);
    if (searchParams.toString()) {
      proxy.search += (proxy.search ? '&' : '') + searchParams.toString();
    }
    
    // Preserve hash fragment
    proxy.hash = url.hash;
    
    return proxy.toString();
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