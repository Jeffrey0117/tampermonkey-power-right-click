'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isDirty, commitFiles, push } = require('./git');
const { findMatches } = require('./search');
const { newRiskyChars, replaceAt } = require('./match');
const { readState, writeState, repoPending, withPending, withSite } = require('./store');

const MAX_CHOICES = 12;
const MAX_TEXT = 2000;
const SUMMARY_MAX = 60;

const reply = (status, body) => ({ status, body });
const refuse = (status, error) => reply(status, { ok: false, error });

function hostOf(url) {
  try { return new URL(url).host; } catch (_) { return ''; }
}

const pendingCount = (state, repo) => {
  const p = repoPending(state, repo);
  return p.edits.length + p.unpushed.length;
};

const sameMatch = (pick) => (m) => m.repo === pick.repo && m.file === pick.file && m.nth === pick.nth;

const publicMatch = ({ repo, file, nth, line, context }) => ({ repo, repoName: path.basename(repo), file, nth, line, context });

async function locate({ roots, state, host, text }) {
  const known = state.sites[host];
  if (known && fs.existsSync(known)) {
    const inKnown = await findMatches({ roots, knownRepo: known, text });
    if (inKnown.length) return inKnown;
  }
  return findMatches({ roots, text });
}

async function applyEdit({ stateDir, state, host, match, from, to }) {
  const { repo, file } = match;
  const pending = repoPending(state, repo);
  const ours = [...pending.edits, ...pending.unpushed].some((e) => e.file === file);
  if (!ours && await isDirty(repo, file)) {
    return refuse(409, `${file} 有還沒 commit 的修改，先處理完再改`);
  }
  const full = path.join(repo, file);
  const content = fs.readFileSync(full, 'utf8');
  fs.writeFileSync(full, replaceAt(content, match.index, match.length, to), 'utf8');
  const edit = { file, from, to, at: new Date().toISOString() };
  const next = withPending(withSite(state, host, repo), repo, { ...pending, edits: [...pending.edits, edit] });
  writeState(stateDir, next);
  return reply(200, { ok: true, status: 'done', repoName: path.basename(repo), file, line: match.line, pending: pendingCount(next, repo) });
}

async function edit({ stateDir, roots }, input) {
  const from = typeof input.text === 'string' ? input.text.trim() : '';
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  const host = hostOf(input.url);
  if (!from || !to) return refuse(400, '沒有內容');
  if (from.length > MAX_TEXT || to.length > MAX_TEXT) return refuse(400, '這段字太長');
  if (from === to) return refuse(400, '沒有改任何字');
  if (!host) return refuse(400, '不知道是哪個網站');
  const risky = newRiskyChars(from, to);
  if (risky.length) return refuse(422, `新的字裡有可能弄壞程式的符號：${risky.map((c) => JSON.stringify(c)).join(' ')}`);

  const state = readState(stateDir);
  const matches = await locate({ roots, state, host, text: from });
  if (!matches.length) return reply(200, { ok: true, status: 'notfound' });

  const pick = input.pick && typeof input.pick === 'object' ? input.pick : null;
  const chosen = pick ? matches.find(sameMatch(pick)) : (matches.length === 1 ? matches[0] : null);
  if (pick && !chosen) return refuse(409, '那個位置已經變了，再試一次');
  if (chosen) return applyEdit({ stateDir, state, host, match: chosen, from, to });
  if (matches.length > MAX_CHOICES) return reply(200, { ok: true, status: 'toomany', count: matches.length });
  return reply(200, { ok: true, status: 'choose', matches: matches.map(publicMatch) });
}

function pending({ stateDir }, input) {
  const state = readState(stateDir);
  const repo = state.sites[String(input.host || '')];
  if (!repo) return reply(200, { ok: true, count: 0 });
  return reply(200, { ok: true, count: pendingCount(state, repo), repoName: path.basename(repo) });
}

const clip = (s) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX)}…` : s).replace(/\s+/g, ' ');

const commitMessage = (edits) => [
  `chore: 網頁改字 ${edits.length} 處`,
  '',
  ...edits.map((e) => `- ${e.file}: 「${clip(e.from)}」→「${clip(e.to)}」`),
].join('\n');

async function submit({ stateDir }, input) {
  const host = hostOf(input.url);
  let state = readState(stateDir);
  const repo = state.sites[host];
  let entry = repo ? repoPending(state, repo) : { edits: [], unpushed: [] };
  if (!entry.edits.length && !entry.unpushed.length) return refuse(400, '沒有要送出的修改');

  let commit = '';
  try {
    if (entry.edits.length) {
      const files = [...new Set(entry.edits.map((e) => e.file))];
      commit = await commitFiles(repo, files, commitMessage(entry.edits));
      entry = { edits: [], unpushed: [...entry.unpushed, ...entry.edits] };
      state = writeState(stateDir, withPending(state, repo, entry));
    }
    await push(repo);
  } catch (err) {
    return refuse(502, `送不出去：${err.message}`);
  }
  writeState(stateDir, withPending(state, repo, { edits: [], unpushed: [] }));
  return reply(200, { ok: true, repoName: path.basename(repo), count: entry.unpushed.length, commit });
}

// One request at a time: edits and submits touch the same files and state.
let queue = Promise.resolve();
const inTurn = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

function handle(key, input, settings) {
  if (!settings || !settings.stateDir || !Array.isArray(settings.roots)) return Promise.resolve(refuse(503, '改字功能沒有設定'));
  if (key === 'GET /retext/pending') return Promise.resolve(pending(settings, input));
  if (key === 'POST /retext') return inTurn(() => edit(settings, input));
  return inTurn(() => submit(settings, input));
}

module.exports = { handle };
