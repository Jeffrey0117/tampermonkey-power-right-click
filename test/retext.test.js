'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createServer } = require('../src/server');

const TOKEN = 'test-token-0123456789';
const PAGE = 'https://shop.example.com/pricing';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A folder of site repos: "shop" (pushes to a bare remote) and "blog".
function makeRepo(root, name, files, remotes) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'core.autocrlf', 'false');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content, 'utf8');
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  if (remotes) {
    const bare = path.join(remotes, `${name}.git`);
    git(remotes, 'init', '-q', '--bare', '-b', 'main', bare);
    git(dir, 'remote', 'add', 'origin', bare);
    git(dir, 'push', '-q', '-u', 'origin', 'main');
  }
  return dir;
}

async function boot() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-retext-'));
  const roots = path.join(base, 'code');
  const remotes = path.join(base, 'remotes');
  fs.mkdirSync(remotes, { recursive: true });
  const shop = makeRepo(roots, 'shop', {
    'pages/pricing.html': '<h1>立即免費開始</h1>\n<p>每月只要\n   299 元</p>\n<a>了解更多</a>\n<a>了解更多</a>\n',
    'src/app.js': "const cta = '馬上試試';\n",
    'dist/app.min.js': 'var a="壓縮過的字"',
  }, remotes);
  const blog = makeRepo(roots, 'blog', { 'index.html': '<h1>部落格標題</h1>\n' });
  const server = createServer({
    token: TOKEN,
    dropDir: path.join(base, 'drops'),
    reveal: () => {},
    retext: { stateDir: path.join(base, 'state'), roots: [roots] },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, pathname, body, headers = {}) => {
    const res = await fetch(url + pathname, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  const read = (repo, file) => fs.readFileSync(path.join(repo, file), 'utf8');
  return { shop, blog, remotes, call, read, close: () => new Promise((r) => server.close(r)) };
}

test('retext: one match is replaced in place and counted as pending', async () => {
  const s = await boot();
  try {
    const r = await s.call('POST', '/retext', { text: '立即免費開始', to: '先用再說', url: PAGE });
    assert.equal(r.status, 200);
    assert.deepEqual({ status: r.json.status, repoName: r.json.repoName, file: r.json.file, pending: r.json.pending },
      { status: 'done', repoName: 'shop', file: 'pages/pricing.html', pending: 1 });
    assert.match(s.read(s.shop, 'pages/pricing.html'), /^<h1>先用再說<\/h1>\n/);
    const p = await s.call('GET', '/retext/pending?host=shop.example.com');
    assert.deepEqual(p.json, { ok: true, count: 1, repoName: 'shop' });
  } finally { await s.close(); }
});

test('retext: text the page shows on one line matches source broken across lines', async () => {
  const s = await boot();
  try {
    const r = await s.call('POST', '/retext', { text: '每月只要 299 元', to: '每月 199 元', url: PAGE });
    assert.equal(r.json.status, 'done');
    assert.match(s.read(s.shop, 'pages/pricing.html'), /<p>每月 199 元<\/p>/);
  } finally { await s.close(); }
});

test('retext: several matches are listed, and the picked one is the only one changed', async () => {
  const s = await boot();
  try {
    const list = await s.call('POST', '/retext', { text: '了解更多', to: '看方案', url: PAGE });
    assert.equal(list.json.status, 'choose');
    assert.deepEqual(list.json.matches.map((m) => [m.repoName, m.file, m.line]), [['shop', 'pages/pricing.html', 4], ['shop', 'pages/pricing.html', 5]]);
    const { repo, file, nth } = list.json.matches[1];
    const r = await s.call('POST', '/retext', { text: '了解更多', to: '看方案', url: PAGE, pick: { repo, file, nth } });
    assert.equal(r.json.status, 'done');
    assert.match(s.read(s.shop, 'pages/pricing.html'), /<a>了解更多<\/a>\n<a>看方案<\/a>\n$/);
  } finally { await s.close(); }
});

test('retext: text that is in no repo, or only in a minified file, is reported as not found', async () => {
  const s = await boot();
  try {
    assert.equal((await s.call('POST', '/retext', { text: '別人網站上的字', to: 'x', url: 'https://other.example.org/' })).json.status, 'notfound');
    assert.equal((await s.call('POST', '/retext', { text: '壓縮過的字', to: 'x', url: PAGE })).json.status, 'notfound');
    assert.equal(s.read(s.shop, 'dist/app.min.js'), 'var a="壓縮過的字"');
  } finally { await s.close(); }
});

test('retext: a replacement that brings in code-breaking characters is refused', async () => {
  const s = await boot();
  try {
    const r = await s.call('POST', '/retext', { text: '馬上試試', to: "it's free", url: PAGE });
    assert.equal(r.status, 422);
    assert.equal(s.read(s.shop, 'src/app.js'), "const cta = '馬上試試';\n");
  } finally { await s.close(); }
});

test('retext: a file with someone else\'s uncommitted changes is left alone', async () => {
  const s = await boot();
  try {
    fs.appendFileSync(path.join(s.shop, 'src/app.js'), '// work in progress\n');
    const r = await s.call('POST', '/retext', { text: '馬上試試', to: '現在就用', url: PAGE });
    assert.equal(r.status, 409);
    assert.match(s.read(s.shop, 'src/app.js'), /馬上試試/);
  } finally { await s.close(); }
});

test('retext: submit makes one commit for all edits and pushes it', async () => {
  const s = await boot();
  try {
    await s.call('POST', '/retext', { text: '立即免費開始', to: '先用再說', url: PAGE });
    await s.call('POST', '/retext', { text: '馬上試試', to: '現在就用', url: PAGE });
    const r = await s.call('POST', '/retext/submit', { url: PAGE });
    assert.equal(r.status, 200);
    assert.equal(r.json.count, 2);
    const remoteLog = git(path.join(s.remotes, 'shop.git'), 'log', '--format=%s', 'main').trim().split('\n');
    assert.deepEqual(remoteLog, ['chore: 網頁改字 2 處', 'init']);
    assert.equal(git(s.shop, 'status', '--porcelain').trim(), '');
    assert.equal((await s.call('GET', '/retext/pending?host=shop.example.com')).json.count, 0);
    assert.equal((await s.call('POST', '/retext/submit', { url: PAGE })).status, 400);
  } finally { await s.close(); }
});

test('retext: a failed push keeps the edits pending so submit can be retried', async () => {
  const s = await boot();
  try {
    await s.call('POST', '/retext', { text: '部落格標題', to: '新標題', url: 'https://blog.example.com/' });
    const r = await s.call('POST', '/retext/submit', { url: 'https://blog.example.com/' });   // blog has no remote
    assert.equal(r.status, 502);
    assert.equal((await s.call('GET', '/retext/pending?host=blog.example.com')).json.count, 1);
  } finally { await s.close(); }
});

test('retext: needs the token and JSON', async () => {
  const s = await boot();
  try {
    const body = { text: '立即免費開始', to: '先用再說', url: PAGE };
    assert.equal((await s.call('POST', '/retext', body, { authorization: 'Bearer nope' })).status, 401);
    assert.equal((await s.call('POST', '/retext', body, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await s.call('POST', '/drop', { action: 'retext', kind: 'text', text: 'x' })).status, 400);
    assert.match(s.read(s.shop, 'pages/pricing.html'), /立即免費開始/);
  } finally { await s.close(); }
});
