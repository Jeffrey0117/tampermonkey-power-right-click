// ==UserScript==
// @name         強力右鍵
// @namespace    power-right-click
// @version      0.1.2
// @description  選一段字、右鍵、存起來。Shift + 右鍵 = 原本的選單。
// @homepageURL  https://github.com/Jeffrey0117/tampermonkey-power-right-click
// @updateURL    https://raw.githubusercontent.com/Jeffrey0117/tampermonkey-power-right-click/main/power-right-click.user.js
// @downloadURL  https://raw.githubusercontent.com/Jeffrey0117/tampermonkey-power-right-click/main/power-right-click.user.js
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_ENDPOINT = 'http://127.0.0.1:4470';
  const DEFAULT_ITEMS = [{ id: 'save', label: '存起來', accepts: ['text'] }];
  const TOAST_MS = 2200;
  const REQUEST_TIMEOUT_MS = 8000;

  const endpoint = () => String(GM_getValue('endpoint', DEFAULT_ENDPOINT)).replace(/\/+$/, '');
  const token = () => String(GM_getValue('token', ''));

  // ---- setup page: pick the token up, no copy-paste ----
  function adoptTokenFromSetupPage() {
    if (location.origin !== new URL(endpoint()).origin || location.pathname !== '/setup') return;
    const meta = document.querySelector('meta[name="prc-token"]');
    const status = document.getElementById('prc-status');
    if (!meta || !meta.content) return;
    GM_setValue('token', meta.content);
    if (status) {
      status.dataset.state = 'ok';
      status.textContent = '已連上 ✓ 到任何網頁選一段字、按右鍵試試。';
    }
  }

  // ---- talking to the drop service ----
  function call(method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: endpoint() + path,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout: REQUEST_TIMEOUT_MS,
        onload: (res) => {
          let data = null;
          try { data = JSON.parse(res.responseText); } catch (_) { /* not json */ }
          if (res.status >= 200 && res.status < 300 && data) resolve(data);
          else reject(new Error((data && data.error) || '收件服務回了 ' + res.status));
        },
        onerror: () => reject(new Error('連不上收件服務')),
        ontimeout: () => reject(new Error('收件服務沒有回應')),
      });
    });
  }

  function cachedItems() {
    try {
      const items = JSON.parse(GM_getValue('menu', 'null'));
      if (Array.isArray(items) && items.length) return items;
    } catch (_) { /* fall through */ }
    return DEFAULT_ITEMS;
  }

  function refreshItems() {
    if (!token()) return;
    call('GET', '/menu')
      .then((data) => { if (Array.isArray(data.items)) GM_setValue('menu', JSON.stringify(data.items)); })
      .catch(() => { /* keep the cached list */ });
  }

  // ---- the menu and the toast live in one shadow root, away from page styles ----
  const STYLE = `
    :host { all: initial; }
    .menu, .toast { position: fixed; z-index: 2147483647; font: 14px/1.4 'Noto Sans TC', system-ui, sans-serif; color: #1F1B16; }
    .menu { min-width: 168px; padding: 6px; background: #FFFDF9; border: 1px solid #EBE4DA; border-radius: 14px;
            box-shadow: 0 10px 30px rgba(31,27,22,.18), 0 2px 6px rgba(31,27,22,.08); }
    .item { display: block; width: 100%; padding: 9px 12px; border: 0; border-radius: 10px; background: none;
            font: inherit; font-weight: 700; color: inherit; text-align: left; cursor: pointer; }
    .item:hover, .item:focus { background: #FCF1DD; outline: none; }
    .hint { padding: 6px 12px 4px; font-size: 11px; color: #A49A8E; border-top: 1px solid #F1EBE2; margin-top: 4px; }
    .toast { right: 18px; bottom: 18px; max-width: 320px; padding: 10px 14px; background: #1F1B16; color: #fff;
             border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.25); word-break: break-all; }
    .toast.bad { background: #B4412F; }
    .toast.clickable { cursor: pointer; }
    .toast.clickable:hover { background: #332c24; }
  `;

  let root = null;
  let menuEl = null;
  let toastTimer = 0;

  function shadow() {
    if (root && root.host.isConnected) return root;
    const host = document.createElement('div');
    host.id = 'power-right-click-host';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);
    document.documentElement.appendChild(host);
    return root;
  }

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }

  function toast(message, bad, onClick) {
    const r = shadow();
    const old = r.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = bad ? 'toast bad' : 'toast';
    el.textContent = message;
    if (onClick) {
      el.classList.add('clickable');
      el.title = '打開資料夾';
      el.addEventListener('click', onClick);
    }
    r.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), TOAST_MS);
  }

  function revealFolder() {
    if (!token()) return;
    call('POST', '/reveal').catch(() => { /* best effort */ });
  }

  function runItem(item, text) {
    if (!token()) {
      toast('還沒連上：先開 ' + endpoint() + '/setup', true);
      return;
    }
    call('POST', '/drop', { action: item.id, kind: 'text', text, url: location.href, title: document.title })
      .then((data) => toast('已存 ' + (data.name || '') + ' ·（點我打開資料夾）', false, revealFolder))
      .catch((err) => toast('沒存成：' + err.message, true));
  }

  function openMenu(x, y, text) {
    closeMenu();
    const r = shadow();
    menuEl = document.createElement('div');
    menuEl.className = 'menu';
    const items = cachedItems().filter((it) => !it.accepts || it.accepts.includes('text'));
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      btn.textContent = String(item.label || item.id);
      btn.addEventListener('click', () => { closeMenu(); runItem(item, text); });
      menuEl.appendChild(btn);
    }
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Shift + 右鍵 = 原本的選單';
    menuEl.appendChild(hint);
    r.appendChild(menuEl);
    // keep it inside the window
    const box = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4)) + 'px';
    refreshItems();
  }

  // ---- wiring ----
  document.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return;                                    // the browser's own menu
    const text = String(window.getSelection() || '').trim();
    if (!text) return;                                         // nothing selected: stay out of the way
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, text);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (menuEl && e.target !== root.host) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('blur', closeMenu);

  GM_registerMenuCommand('強力右鍵：設定收件位置', () => {
    const next = prompt('收件服務的位置', endpoint());
    if (next && /^https?:\/\//i.test(next.trim())) GM_setValue('endpoint', next.trim());
  });
  GM_registerMenuCommand('強力右鍵：開設定頁', () => { window.open(endpoint() + '/setup', '_blank'); });

  adoptTokenFromSetupPage();
})();
