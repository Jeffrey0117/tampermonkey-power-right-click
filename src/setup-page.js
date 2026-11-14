'use strict';

const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'via', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cdn-loop'];

const isLoopbackAddress = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

function isLoopbackHost(hostHeader) {
  const host = String(hostHeader || '').replace(/:\d+$/, '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

// The setup page hands out the token, so it is only for someone sitting at this
// machine who typed the address: not a proxy, not a tunnel, not another web page.
function isDirectLocalVisit(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (!isLoopbackHost(req.headers.host)) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'none' && site !== 'same-origin') return false;
  return true;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderSetupPage({ token, dropDir }) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="prc-token" content="${escapeHtml(token)}">
<title>強力右鍵 設定</title>
<style>
  body { margin: 0; background: #FAF7F2; color: #1F1B16; font: 16px/1.7 'Noto Sans TC', system-ui, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 56px 20px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  p { margin: 0 0 14px; color: #6B6259; }
  ol { padding-left: 22px; margin: 22px 0; }
  li { margin-bottom: 14px; }
  a.btn { display: inline-block; background: #E09A2E; color: #fff; font-weight: 700; text-decoration: none; padding: 10px 18px; border-radius: 12px; }
  code { background: #fff; border: 1px solid #EBE4DA; border-radius: 6px; padding: 1px 6px; font-size: 14px; }
  #prc-status { margin-top: 26px; padding: 14px 16px; border-radius: 12px; background: #fff; border: 1px solid #EBE4DA; font-weight: 700; }
  #prc-status[data-state="ok"] { border-color: #3E9B5F; color: #2C7A48; }
</style>
</head>
<body>
<main>
  <h1>強力右鍵</h1>
  <p>選一段字、右鍵、存起來。</p>
  <ol>
    <li><a class="btn" href="/power-right-click.user.js">安裝腳本</a><br>Tampermonkey 會跳出安裝畫面，按「安裝」。</li>
    <li>回到這一頁按 <code>F5</code> 重新整理。下面那一格變成「已連上」就完成了。</li>
  </ol>
  <p>存下來的檔在 <code>${escapeHtml(dropDir)}</code></p>
  <div id="prc-status" data-state="waiting">還沒連上：腳本裝好後重新整理這一頁。</div>
</main>
</body>
</html>
`;
}

const SETUP_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

module.exports = { isDirectLocalVisit, renderSetupPage, SETUP_HEADERS };
