'use strict';
// Creates .env with a fresh random token. Never overwrites an existing one.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { ENV_FILE } = require('../src/config');

if (fs.existsSync(ENV_FILE)) {
  process.stdout.write(`.env already exists, left as is: ${ENV_FILE}\n`);
} else {
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(ENV_FILE, `DROP_TOKEN=${token}\nPORT=4470\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`created ${ENV_FILE}\n`);
}
