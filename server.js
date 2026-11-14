'use strict';
const { loadConfig } = require('./src/config');
const { createServer } = require('./src/server');

const config = loadConfig();
const server = createServer(config);

server.on('error', (err) => {
  process.stderr.write(`[power-right-click] cannot listen on ${config.host}:${config.port}: ${err.message}\n`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  process.stdout.write(`[power-right-click] listening on http://${config.host}:${config.port}  →  ${config.dropDir}\n`);
});
