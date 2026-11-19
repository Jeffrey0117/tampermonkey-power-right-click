'use strict';

// Characters that can break markup or a string literal when they show up in
// the replacement but were not in the original text.
const RISKY = /[<>{}`"'\\\r\n]/g;
const CONTEXT_MAX = 160;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pieces = (text) => String(text).trim().split(/\s+/).filter(Boolean);

// The page shows collapsed whitespace; the source may break the same words
// across lines. Any run of whitespace matches any run of whitespace.
const buildPattern = (text) => new RegExp(pieces(text).map(escapeRegExp).join('\\s+'), 'g');

// A whitespace-free piece is safe to hand to a fixed-string search.
const longestPiece = (text) => pieces(text).reduce((best, p) => (p.length > best.length ? p : best), '');

function findInContent(content, text) {
  if (!pieces(text).length) return [];
  const pattern = buildPattern(text);
  const found = [];
  let m = pattern.exec(content);
  while (m) {
    const lineStart = content.lastIndexOf('\n', m.index - 1) + 1;
    const nextBreak = content.indexOf('\n', m.index);
    const lineEnd = nextBreak < 0 ? content.length : nextBreak;
    found.push({
      index: m.index,
      length: m[0].length,
      line: content.slice(0, m.index).split('\n').length,
      context: content.slice(lineStart, lineEnd).trim().slice(0, CONTEXT_MAX),
    });
    m = pattern.exec(content);
  }
  return found;
}

function newRiskyChars(from, to) {
  const had = new Set(String(from).match(RISKY) || []);
  return [...new Set(String(to).match(RISKY) || [])].filter((c) => !had.has(c));
}

const replaceAt = (content, index, length, to) => content.slice(0, index) + to + content.slice(index + length);

module.exports = { findInContent, longestPiece, newRiskyChars, replaceAt };
