'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SLUG_MAX = 40;

const pad = (n) => String(n).padStart(2, '0');

function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Keep letters and digits of any script; everything else becomes a single dash.
// Nothing that survives can be a path separator, a drive colon or a dot.
function slugify(text) {
  const slug = String(text || '')
    .split(/\r?\n/)[0]
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return Array.from(slug).slice(0, SLUG_MAX).join('').replace(/-+$/g, '');
}

const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

function httpUrl(value) {
  const s = oneLine(value);
  return /^https?:\/\//i.test(s) ? s : '';
}

function buildDocument({ text, url, title, savedAt }) {
  const header = ['---'];
  const source = httpUrl(url);
  const cleanTitle = oneLine(title);
  if (source) header.push(`source: ${source}`);
  if (cleanTitle) header.push(`title: ${cleanTitle}`);
  header.push(`saved: ${savedAt.toISOString()}`, '---', '');
  return `${header.join('\n')}\n${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
}

// Writes a new file, never overwrites: a name already taken gets -2, -3, ...
function writeNew(dir, base, content) {
  for (let i = 1; i < 1000; i += 1) {
    const name = `${base}${i === 1 ? '' : `-${i}`}.md`;
    try {
      fs.writeFileSync(path.join(dir, name), content, { encoding: 'utf8', flag: 'wx' });
      return name;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('could not find a free file name');
}

function saveText({ dropDir, text, url, title, now = new Date() }) {
  fs.mkdirSync(dropDir, { recursive: true });
  const slug = slugify(title) || slugify(text) || 'drop';
  const name = writeNew(dropDir, `${stamp(now)}_${slug}`, buildDocument({ text, url, title, savedAt: now }));
  return { name };
}

module.exports = { saveText, slugify };
