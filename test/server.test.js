'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('../src/server');

const TOKEN = 'test-token-0123456789';

async function boot() {
  const dropDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-'));
  const revealed = [];
  const server = createServer({ token: TOKEN, dropDir, reveal: (dir) => revealed.push(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { dropDir, port, revealed, close: () => new Promise((r) => server.close(r)) };
}

// Raw request so tests can set Host and other headers freely.
function request(port, { method = 'GET', pathname = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function drop(port, payload, headers = {}) {
  return request(port, {
    method: 'POST',
    pathname: '/drop',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

test('save: writes the text with its source and title', async () => {
  const s = await boot();
  try {
    const r = await drop(s.port, { action: 'save', kind: 'text', text: '第一行\n第二行', url: 'https://example.com/a?b=1', title: '某篇文章' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.match(r.json.name, /^\d{4}-\d{2}-\d{2}_\d{6}_某篇文章\.md$/);
    const files = fs.readdirSync(s.dropDir);
    assert.deepEqual(files, [r.json.name]);
    const body = fs.readFileSync(path.join(s.dropDir, r.json.name), 'utf8');
    assert.match(body, /^---\nsource: https:\/\/example\.com\/a\?b=1\ntitle: 某篇文章\nsaved: .+\n---\n\n第一行\n第二行\n$/);
  } finally { await s.close(); }
});

test('save: no title falls back to the first line of the text', async () => {
  const s = await boot();
  try {
    const r = await drop(s.port, { action: 'save', kind: 'text', text: 'hello world, this is a line\nmore' });
    assert.equal(r.status, 200);
    assert.match(r.json.name, /_hello-world-this-is-a-line\.md$/);
    const body = fs.readFileSync(path.join(s.dropDir, r.json.name), 'utf8');
    assert.ok(!body.includes('source:'), 'no source line when no url was sent');
  } finally { await s.close(); }
});

test('save: a hostile title cannot escape the drop folder or break the header', async () => {
  const s = await boot();
  try {
    const r = await drop(s.port, { action: 'save', kind: 'text', text: 'x', title: '..\\..\\..\\evil/../con:\nsource: forged', url: 'javascript:alert(1)' });
    assert.equal(r.status, 200);
    assert.ok(!/[\\/:]/.test(r.json.name), r.json.name);
    assert.equal(path.dirname(path.resolve(s.dropDir, r.json.name)), path.resolve(s.dropDir));
    assert.deepEqual(fs.readdirSync(s.dropDir), [r.json.name]);
    const body = fs.readFileSync(path.join(s.dropDir, r.json.name), 'utf8');
    const header = body.split('\n---\n')[0];
    assert.equal(header.split('\n').filter((l) => l.startsWith('source:')).length, 0, 'non-http url dropped, forged line not a header line');
    assert.equal(header.split('\n').filter((l) => l.startsWith('title:')).length, 1);
  } finally { await s.close(); }
});

test('save: two drops in the same second get different files', async () => {
  const s = await boot();
  try {
    const a = await drop(s.port, { action: 'save', kind: 'text', text: 'one', title: 'same' });
    const b = await drop(s.port, { action: 'save', kind: 'text', text: 'two', title: 'same' });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(fs.readdirSync(s.dropDir).length, 2);
    assert.notEqual(a.json.name, b.json.name);
  } finally { await s.close(); }
});

test('auth: missing or wrong token is refused and nothing is written', async () => {
  const s = await boot();
  try {
    const none = await request(s.port, { method: 'POST', pathname: '/drop', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', kind: 'text', text: 'x' }) });
    assert.equal(none.status, 401);
    const wrong = await drop(s.port, { action: 'save', kind: 'text', text: 'x' }, { authorization: 'Bearer nope' });
    assert.equal(wrong.status, 401);
    const menu = await request(s.port, { pathname: '/menu' });
    assert.equal(menu.status, 401);
    assert.deepEqual(fs.readdirSync(s.dropDir), []);
  } finally { await s.close(); }
});

test('input: bad requests are refused', async () => {
  const s = await boot();
  try {
    assert.equal((await drop(s.port, '{not json')).status, 400);
    assert.equal((await drop(s.port, { action: 'save', kind: 'text', text: '   ' })).status, 400);
    assert.equal((await drop(s.port, { action: 'save', kind: 'text' })).status, 400);
    assert.equal((await drop(s.port, { action: 'nope', kind: 'text', text: 'x' })).status, 400);
    assert.equal((await drop(s.port, { action: 'save', kind: 'image', text: 'x' })).status, 400);
    // a web page can POST text/plain cross-site without a preflight; only JSON is accepted
    assert.equal((await drop(s.port, { action: 'save', kind: 'text', text: 'x' }, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await drop(s.port, { action: 'save', kind: 'text', text: 'x'.repeat(3 * 1024 * 1024) })).status, 413);
    assert.deepEqual(fs.readdirSync(s.dropDir), []);
  } finally { await s.close(); }
});

test('menu: lists the save action', async () => {
  const s = await boot();
  try {
    const r = await request(s.port, { pathname: '/menu', headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items, [
      { id: 'save', label: '存起來', accepts: ['text'] },
      { id: 'retext', label: '改這段字', accepts: ['text'], ui: 'retext' },
    ]);
  } finally { await s.close(); }
});

test('reveal: with the token, opens the drop folder; without it, refuses', async () => {
  const s = await boot();
  try {
    const no = await request(s.port, { method: 'POST', pathname: '/reveal' });
    assert.equal(no.status, 401);
    assert.deepEqual(s.revealed, []);
    const ok = await request(s.port, { method: 'POST', pathname: '/reveal', headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
    assert.deepEqual(s.revealed, [s.dropDir]);
  } finally { await s.close(); }
});

test('setup: served to a direct local visit, carries the token, cannot be framed', async () => {
  const s = await boot();
  try {
    const r = await request(s.port, { pathname: '/setup', headers: { host: `127.0.0.1:${s.port}`, 'sec-fetch-site': 'none' } });
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(TOKEN));
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['cache-control'], /no-store/);
  } finally { await s.close(); }
});

test('setup: refused when it came through a proxy, a foreign host name, or another site', async () => {
  const s = await boot();
  try {
    const local = { host: `127.0.0.1:${s.port}` };
    const cases = [
      { ...local, 'x-forwarded-for': '203.0.113.9' },
      { ...local, 'cf-connecting-ip': '203.0.113.9' },
      { ...local, 'cf-ray': 'abc' },
      { ...local, forwarded: 'for=203.0.113.9' },
      { host: 'drop.example.com' },
      { ...local, 'sec-fetch-site': 'cross-site' },
      { ...local, 'sec-fetch-site': 'same-site' },
    ];
    for (const headers of cases) {
      const r = await request(s.port, { pathname: '/setup', headers });
      assert.equal(r.status, 403, JSON.stringify(headers));
      assert.ok(!r.text.includes(TOKEN), JSON.stringify(headers));
    }
  } finally { await s.close(); }
});

test('userscript: served without any secret in it', async () => {
  const s = await boot();
  try {
    const r = await request(s.port, { pathname: '/power-right-click.user.js' });
    assert.equal(r.status, 200);
    assert.match(r.text, /==UserScript==/);
    assert.ok(!r.text.includes(TOKEN));
  } finally { await s.close(); }
});

test('health and unknown paths', async () => {
  const s = await boot();
  try {
    assert.equal((await request(s.port, { pathname: '/health' })).json.ok, true);
    assert.equal((await request(s.port, { pathname: '/nope' })).status, 404);
  } finally { await s.close(); }
});
