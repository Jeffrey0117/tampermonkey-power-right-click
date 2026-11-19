// ==UserScript==
// @name         強力右鍵
// @namespace    power-right-click
// @version      0.2.0
// @description  選一段字、右鍵：存起來，或直接改掉自己網站上的字。Shift + 右鍵 = 原本的選單。
// @homepageURL  https://github.com/Jeffrey0117/tampermonkey-power-right-click
// @updateURL    https://raw.githubusercontent.com/Jeffrey0117/tampermonkey-power-right-click/main/power-right-click.user.js
// @downloadURL  https://raw.githubusercontent.com/Jeffrey0117/tampermonkey-power-right-click/main/power-right-click.user.js
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_ENDPOINT = 'http://127.0.0.1:4470';
  const DEFAULT_ITEMS = [
    { id: 'save', label: '存起來', accepts: ['text'] },
    { id: 'retext', label: '改這段字', accepts: ['text'], ui: 'retext' },
  ];
  const TOAST_MS = 2200;
  const REQUEST_TIMEOUT_MS = 8000;
  const RETEXT_TIMEOUT_MS = 100000;      // first search on a site looks through every repo; a push can be slow
  const LONG_TOAST_MS = 9000;

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
  function call(method, path, body, timeout) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: endpoint() + path,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout: timeout || REQUEST_TIMEOUT_MS,
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
    .dialog { position: fixed; z-index: 2147483647; left: 50%; top: 22%; transform: translateX(-50%); width: min(460px, calc(100vw - 32px));
              padding: 16px; background: #FFFDF9; border: 1px solid #EBE4DA; border-radius: 16px; color: #1F1B16;
              font: 14px/1.5 'Noto Sans TC', system-ui, sans-serif; box-shadow: 0 18px 50px rgba(31,27,22,.28); }
    .dialog .label { font-size: 12px; color: #A49A8E; margin: 0 0 4px; }
    .dialog .old { margin: 0 0 12px; max-height: 90px; overflow: auto; white-space: pre-wrap; word-break: break-all; color: #6B6259; }
    .dialog textarea { box-sizing: border-box; width: 100%; min-height: 64px; padding: 9px 11px; border: 1px solid #E0D7CA; border-radius: 10px;
                       background: #fff; color: inherit; font: inherit; resize: vertical; }
    .dialog textarea:focus { outline: 2px solid #E09A2E; outline-offset: -1px; }
    .dialog .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .dialog button { padding: 8px 16px; border: 0; border-radius: 10px; font: inherit; font-weight: 700; cursor: pointer; background: #F1EBE2; color: inherit; }
    .dialog button.go { background: #E09A2E; color: #fff; }
    .dialog button:disabled { opacity: .55; cursor: default; }
    .dialog .note { margin-top: 10px; font-size: 13px; color: #B4412F; }
    .dialog .choice { display: block; width: 100%; margin-top: 6px; padding: 9px 11px; text-align: left; font-weight: 400; background: #fff; border: 1px solid #EBE4DA; }
    .dialog .choice:hover { background: #FCF1DD; }
    .dialog .choice b { display: block; font-size: 12px; color: #A49A8E; font-weight: 700; }
    .chip { position: fixed; z-index: 2147483646; left: 18px; bottom: 18px; display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px;
            background: #1F1B16; color: #fff; border-radius: 999px; font: 13px/1.4 'Noto Sans TC', system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
    .chip button { padding: 6px 14px; border: 0; border-radius: 999px; background: #E09A2E; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    .chip button:disabled { opacity: .55; cursor: default; }
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

  function toast(message, bad, onClick, ms) {
    const r = shadow();
    const old = r.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = bad ? 'toast bad' : 'toast';
    el.textContent = message;
    if (onClick) {
      el.classList.add('clickable');
      el.addEventListener('click', onClick);
    }
    r.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), ms || TOAST_MS);
  }

  function revealFolder() {
    if (!token()) return;
    call('POST', '/reveal').catch(() => { /* best effort */ });
  }

  function runItem(item, text, range) {
    if (!token()) {
      toast('還沒連上：先開 ' + endpoint() + '/setup', true);
      return;
    }
    if (item.ui === 'retext') { openRetext(text, range); return; }
    call('POST', '/drop', { action: item.id, kind: 'text', text, url: location.href, title: document.title })
      .then((data) => toast('已存 ' + (data.name || '') + ' ·（點我打開資料夾）', false, revealFolder))
      .catch((err) => toast('沒存成：' + err.message, true));
  }

  function openMenu(x, y, text, range) {
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
      btn.addEventListener('click', () => { closeMenu(); runItem(item, text, range); });
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

  // ---- 改這段字: edit the text in the site's own source, send all edits in one go ----
  let dialogEl = null;
  let chipEl = null;

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function closeDialog() {
    if (dialogEl) { dialogEl.remove(); dialogEl = null; }
  }

  function editedHosts() {
    try {
      const hosts = JSON.parse(GM_getValue('retextHosts', '[]'));
      return Array.isArray(hosts) ? hosts : [];
    } catch (_) { return []; }
  }

  function rememberHost() {
    const hosts = editedHosts();
    if (!hosts.includes(location.host)) GM_setValue('retextHosts', JSON.stringify([...hosts, location.host]));
  }

  function showChip(count) {
    if (chipEl) { chipEl.remove(); chipEl = null; }
    if (!count) return;
    chipEl = make('div', 'chip');
    chipEl.appendChild(make('span', '', '已改 ' + count + ' 處，還沒送出'));
    const btn = make('button', '', '送出');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = '送出中…';
      call('POST', '/retext/submit', { url: location.href }, RETEXT_TIMEOUT_MS)
        .then((data) => {
          showChip(0);
          toast('已送出 ' + data.count + ' 處到 ' + data.repoName + '，部署完就是新的', false, null, LONG_TOAST_MS);
        })
        .catch((err) => {
          btn.disabled = false;
          btn.textContent = '送出';
          toast(err.message, true, null, LONG_TOAST_MS);
        });
    });
    chipEl.appendChild(btn);
    shadow().appendChild(chipEl);
  }

  // Only asks on sites where an edit was made before, so other pages stay quiet.
  function refreshChip() {
    if (!token() || window.top !== window || !editedHosts().includes(location.host)) return;
    call('GET', '/retext/pending?host=' + encodeURIComponent(location.host))
      .then((data) => showChip(data.count || 0))
      .catch(() => { /* service not running: no chip */ });
  }

  // Show the new words right away; the real page catches up after the deploy.
  function swapOnPage(range, to) {
    try {
      const node = range && range.startContainer;
      if (!node || node !== range.endContainer || node.nodeType !== Node.TEXT_NODE) return;
      const full = node.textContent;
      const picked = full.slice(range.startOffset, range.endOffset);
      const lead = picked.length - picked.trimStart().length;
      const trail = picked.length - picked.trimEnd().length;
      node.textContent = full.slice(0, range.startOffset + lead) + to + full.slice(range.endOffset - trail);
    } catch (_) { /* the page changed under us; the deploy will show it */ }
  }

  const aiPrompt = (from, to) => '把網頁上的「' + from + '」改成「' + to + '」。頁面：' + location.href
    + '。直接搜原始碼找不到這段字，它可能是程式拼出來的，或來自資料庫、設定檔。';

  function openRetext(text, range) {
    closeDialog();
    dialogEl = make('div', 'dialog');
    const input = make('textarea');
    input.value = text;
    const note = make('div', 'note');
    note.hidden = true;
    const choices = make('div');
    const row = make('div', 'row');
    const cancel = make('button', '', '取消');
    const go = make('button', 'go', '改');
    cancel.type = 'button';
    go.type = 'button';

    const say = (message) => { note.textContent = message; note.hidden = !message; };
    const busy = (on) => { go.disabled = on; go.textContent = on ? '找…' : '改'; };

    const onReply = (data, to) => {
      if (data.status === 'done') {
        closeDialog();
        swapOnPage(range, to);
        rememberHost();
        showChip(data.pending);
        toast('已改 ' + data.repoName + ' / ' + data.file);
      } else if (data.status === 'choose') {
        say('有 ' + data.matches.length + ' 處一樣的字，要改哪一個？');
        for (const m of data.matches) {
          const btn = make('button', 'choice');
          btn.type = 'button';
          btn.appendChild(make('b', '', m.repoName + ' / ' + m.file + ' : ' + m.line));
          btn.appendChild(document.createTextNode(m.context));
          btn.addEventListener('click', () => send({ repo: m.repo, file: m.file, nth: m.nth }));
          choices.appendChild(btn);
        }
      } else if (data.status === 'toomany') {
        say('有 ' + data.count + ' 處一樣的字，選長一點再試。');
      } else {
        closeDialog();
        GM_setClipboard(aiPrompt(text, to));
        toast('原始碼裡找不到這段字，這裡改不了。已複製一句給 AI 的指令，貼給它就能改。', true, null, LONG_TOAST_MS);
      }
    };

    function send(pick) {
      const to = input.value.trim();
      if (!to || to === text) { say('還沒改任何字'); return; }
      busy(true);
      say('');
      choices.textContent = '';
      call('POST', '/retext', { text, to, url: location.href, pick }, RETEXT_TIMEOUT_MS)
        .then((data) => { busy(false); onReply(data, to); })
        .catch((err) => { busy(false); say(err.message); });
    }

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();                                     // page shortcuts stay out of the box
      if (e.key === 'Escape') closeDialog();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    cancel.addEventListener('click', closeDialog);
    go.addEventListener('click', () => send());

    row.appendChild(cancel);
    row.appendChild(go);
    dialogEl.appendChild(make('div', 'label', '原本'));
    dialogEl.appendChild(make('div', 'old', text));
    dialogEl.appendChild(make('div', 'label', '改成'));
    dialogEl.appendChild(input);
    dialogEl.appendChild(note);
    dialogEl.appendChild(choices);
    dialogEl.appendChild(row);
    shadow().appendChild(dialogEl);
    input.focus();
    input.select();
  }

  // ---- wiring ----
  document.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return;                                    // the browser's own menu
    const selection = window.getSelection();
    const text = String(selection || '').trim();
    if (!text) return;                                         // nothing selected: stay out of the way
    e.preventDefault();
    e.stopPropagation();
    // the selection is lost once the dialog takes focus, so keep where it was
    const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    openMenu(e.clientX, e.clientY, text, range);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (menuEl && e.target !== root.host) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closeDialog(); } }, true);
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('blur', closeMenu);

  GM_registerMenuCommand('強力右鍵：設定收件位置', () => {
    const next = prompt('收件服務的位置', endpoint());
    if (next && /^https?:\/\//i.test(next.trim())) GM_setValue('endpoint', next.trim());
  });
  GM_registerMenuCommand('強力右鍵：開設定頁', () => { window.open(endpoint() + '/setup', '_blank'); });

  adoptTokenFromSetupPage();
  refreshChip();
})();
