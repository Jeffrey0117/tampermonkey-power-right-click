'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENV_FILE = path.join(__dirname, '..', '.env');

// Tiny .env reader (KEY=value per line). Real environment variables win.
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

function loadConfig(env = process.env) {
  const merged = { ...readEnvFile(ENV_FILE), ...env };
  const token = merged.DROP_TOKEN;
  if (!token || token.length < 20) {
    throw new Error('DROP_TOKEN is missing or shorter than 20 characters. Run "npm run init" to create .env.');
  }
  const port = Number(merged.PORT || 4470);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT is not a valid port: ${merged.PORT}`);
  return {
    token,
    port,
    host: merged.HOST || '127.0.0.1',
    dropDir: merged.DROP_DIR || path.join(os.homedir(), 'Documents', 'power-right-click'),
  };
}

module.exports = { loadConfig, ENV_FILE };
