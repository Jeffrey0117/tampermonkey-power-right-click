'use strict';
const { execFile } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 20000;
const PUSH_TIMEOUT_MS = 90000;

// Runs git without a shell. Rejects with the last lines of stderr.
function git(cwd, args, { timeout = DEFAULT_TIMEOUT_MS, okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    };
    execFile('git', args, options, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      if (okCodes.includes(code)) return resolve({ code, stdout });
      const tail = String(stderr || err.message).trim().split(/\r?\n/).slice(-3).join(' ');
      return reject(new Error(tail || `git ${args[0]} failed`));
    });
  });
}

// Tracked, non-binary files that contain the fixed string.
const grepFiles = (repo, needle) => git(repo, ['grep', '-lIFz', '-e', needle], { okCodes: [0, 1] })
  .then((r) => r.stdout.split('\0').filter(Boolean));

const isDirty = (repo, file) => git(repo, ['status', '--porcelain', '--', file]).then((r) => r.stdout.trim() !== '');

async function commitFiles(repo, files, message) {
  await git(repo, ['commit', '-m', message, '--', ...files]);
  const { stdout } = await git(repo, ['rev-parse', '--short', 'HEAD']);
  return stdout.trim();
}

const push = (repo) => git(repo, ['push'], { timeout: PUSH_TIMEOUT_MS });

module.exports = { grepFiles, isDirty, commitFiles, push };
