'use strict';
const { spawn } = require('node:child_process');

// Opens a folder in the OS file manager. Fire-and-forget: we never wait on it
// and never surface its exit code (explorer.exe returns 1 even on success).
function revealInFileManager(dir) {
  let cmd;
  let args;
  if (process.platform === 'win32') { cmd = 'explorer.exe'; args = [dir]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [dir]; }
  else { cmd = 'xdg-open'; args = [dir]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* no file manager available; ignore */ });
    child.unref();
  } catch (_) { /* ignore */ }
}

module.exports = { revealInFileManager };
