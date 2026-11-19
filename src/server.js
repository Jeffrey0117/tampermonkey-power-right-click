'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { menuItems, findAction } = require('./actions');
const { isDirectLocalVisit, renderSetupPage, SETUP_HEADERS } = require('./setup-page');
const retext = require('./retext');

const RETEXT_ROUTES = ['POST /retext', 'POST /retext/submit', 'GET /retext/pending'];

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const USERSCRIPT_PATH = path.join(__dirname, '..', 'power-right-click.user.js');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function tokenMatches(req, token) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!match) return false;
  const given = crypto.createHash('sha256').update(match[1]).digest();
  const wanted = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(given, wanted);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooBig = true;      // keep draining so the reply can be sent
      else chunks.push(chunk);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, '內容太大')) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

// A web page can POST text/plain cross-site without a preflight; JSON it cannot.
async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    req.resume();
    throw new HttpError(415, '只收 application/json');
  }
  let data;
  try { data = JSON.parse(await readBody(req)); } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, '不是 JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, '格式不對');
  return data;
}

function parseDrop(data) {
  const action = findAction(data.action);
  if (!action || !action.run) throw new HttpError(400, '沒有這個動作');
  if (!action.accepts.includes(data.kind)) throw new HttpError(400, '這個動作不收這種內容');
  if (typeof data.text !== 'string' || !data.text.trim()) throw new HttpError(400, '沒有內容');
  const payload = {
    text: data.text,
    url: typeof data.url === 'string' ? data.url.slice(0, 2000) : '',
    title: typeof data.title === 'string' ? data.title.slice(0, 300) : '',
  };
  return { action, payload };
}

async function handleDrop(req, res, config) {
  const { action, payload } = parseDrop(await readJson(req));
  const result = await action.run({ config, payload });
  sendJson(res, 200, { ok: true, ...result });
}

async function handleRetext(key, req, res, config, searchParams) {
  let input = { host: searchParams.get('host') || '' };
  if (req.method === 'POST') input = await readJson(req);
  else req.resume();
  const out = await retext.handle(key, input, config.retext);
  sendJson(res, out.status, out.body);
}

async function route(req, res, config) {
  const { pathname, searchParams } = new URL(req.url, 'http://local');
  const key = `${req.method} ${pathname}`;

  if (key === 'GET /health') return sendJson(res, 200, { ok: true });

  if (key === 'GET /setup') {
    if (!isDirectLocalVisit(req)) throw new HttpError(403, '設定頁只能在這台電腦上直接開');
    res.writeHead(200, SETUP_HEADERS);
    return res.end(renderSetupPage({ token: config.token, dropDir: config.dropDir }));
  }

  if (key === 'GET /power-right-click.user.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(fs.readFileSync(USERSCRIPT_PATH));
  }

  if (key === 'GET /menu' || key === 'POST /drop' || key === 'POST /reveal' || RETEXT_ROUTES.includes(key)) {
    if (!tokenMatches(req, config.token)) {
      req.resume();
      throw new HttpError(401, '金鑰不對');
    }
    if (RETEXT_ROUTES.includes(key)) return handleRetext(key, req, res, config, searchParams);
    if (key === 'GET /menu') return sendJson(res, 200, { items: menuItems() });
    if (key === 'POST /reveal') {
      req.resume();
      config.reveal(config.dropDir);
      return sendJson(res, 200, { ok: true });
    }
    return handleDrop(req, res, config);
  }

  req.resume();
  throw new HttpError(404, '沒有這個位置');
}

function createServer(config) {
  if (!config || !config.token) throw new Error('createServer: token is required');
  if (!config.dropDir) throw new Error('createServer: dropDir is required');
  if (!config.reveal) config = { ...config, reveal: require('./reveal').revealInFileManager };
  return http.createServer((req, res) => {
    route(req, res, config).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) process.stderr.write(`[power-right-click] ${req.method} ${req.url}: ${err.stack || err}\n`);
      if (!res.headersSent) sendJson(res, status, { ok: false, error: status === 500 ? '存檔失敗' : err.message });
      else res.end();
    });
  });
}

module.exports = { createServer };
