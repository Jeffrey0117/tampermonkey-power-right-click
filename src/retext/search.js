'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { grepFiles } = require('./git');
const { findInContent, longestPiece } = require('./match');

const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte', '.astro',
  '.md', '.mdx', '.json', '.yml', '.yaml', '.txt', '.ejs', '.hbs', '.njk', '.pug', '.php', '.py', '.liquid',
]);
const MAX_FILE_BYTES = 1024 * 1024;
const GREP_CONCURRENCY = 8;

// Every folder directly under a root that is a real git repository.
// A worktree (".git" is a file) is skipped: it is a second copy of a repo.
function listRepos(roots) {
  return roots.flatMap((root) => {
    let names = [];
    try { names = fs.readdirSync(root); } catch (_) { return []; }
    return names
      .map((name) => path.join(root, name))
      .filter((dir) => {
        try { return fs.statSync(path.join(dir, '.git')).isDirectory(); } catch (_) { return false; }
      });
  });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const isEditable = (file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) && !/\.min\.\w+$/i.test(file);

async function matchesInRepo(repo, text) {
  let files = [];
  try { files = await grepFiles(repo, longestPiece(text)); } catch (_) { return []; }
  return files.filter(isEditable).flatMap((file) => {
    const full = path.join(repo, file);
    try {
      if (fs.statSync(full).size > MAX_FILE_BYTES) return [];
      return findInContent(fs.readFileSync(full, 'utf8'), text)
        .map((hit, nth) => ({ repo, file, nth, ...hit }));
    } catch (_) {
      return [];
    }
  });
}

// Where the text lives: in the repo this site is already known to be, or
// (first time on a site) in any repo under the roots.
async function findMatches({ roots, knownRepo, text }) {
  const repos = knownRepo ? [knownRepo] : listRepos(roots);
  const perRepo = await mapLimit(repos, GREP_CONCURRENCY, (repo) => matchesInRepo(repo, text));
  return perRepo.flat();
}

module.exports = { findMatches, listRepos };
