# 強力右鍵

在網頁上選一段字 → 右鍵 → **存起來**。那段字連同來源網址、標題，變成本機的一個檔。

先亂存，整理是另一回事。

```
選一段字 → 右鍵
  ┌──────────────────────────┐
  │ 存起來                    │
  │ Shift + 右鍵 = 原本的選單  │
  └──────────────────────────┘
                       右下角：已存 2026-11-15_001354_某篇文章.md
```

- 有選字才會出現；沒選字時右鍵完全不變。
- `Shift + 右鍵` 永遠是瀏覽器原本的選單。
- 檔案在 `文件\power-right-click`（可用 `DROP_DIR` 改）。

## 兩個零件

| | 是什麼 |
|---|---|
| `power-right-click.user.js` | 油猴腳本：蓋掉右鍵、畫選單、把選取的字送出去 |
| `server.js` | 收件服務：只聽本機 `127.0.0.1:4470`，收到就存檔。Node，零依賴 |

選單有哪些項目由收件服務決定（`src/actions.js` 那張清單）。加一個動作只要在那裡加一列，腳本不用動。

## 安裝

需要 Node 20 以上，瀏覽器裝好 Tampermonkey。

```bash
npm run init        # 產生 .env（隨機金鑰），已經有就不動
npm run autostart   # 放一個開機自動啟動的捷徑，並且現在就啟動
```

然後瀏覽器開 `http://127.0.0.1:4470/setup`：

1. 按「安裝腳本」，Tampermonkey 跳出來按安裝。
2. 回到設定頁按 `F5`，看到「已連上」就完成。金鑰是腳本自己從設定頁拿的，不用複製貼上。

不要自動啟動：`powershell -File scripts/autostart.ps1 -Remove`。只想手動跑：`npm start`。

## 存下來的檔長這樣

```
---
source: https://example.com/some-article
title: 某篇文章
saved: 2026-11-14T16:13:54.737Z
---

你選的那段字。
```

檔名是 `時間_標題片段.md`，同名會自動加 `-2`，不會蓋掉舊的。

## 收件服務

| | | |
|---|---|---|
| `GET /health` | 不用金鑰 | 活著嗎 |
| `GET /menu` | 要金鑰 | 選單項目 |
| `POST /drop` | 要金鑰，JSON | `{ action, kind, text, url, title }` → 執行動作 |
| `GET /setup` | 只給本機直接開 | 設定頁 |
| `GET /power-right-click.user.js` | 不用金鑰 | 腳本本體（裡面沒有金鑰） |

金鑰用 `Authorization: Bearer <DROP_TOKEN>`。

設定（`.env` 或環境變數）：`DROP_TOKEN`（必填，沒有就不啟動）、`PORT`（4470）、`HOST`（127.0.0.1）、`DROP_DIR`。

### 為什麼設定頁這麼囉嗦

設定頁會把金鑰交出去，所以只在「這台電腦上的人直接打網址開」的時候才給：連線來自本機、
網址是 127.0.0.1 / localhost、沒有代理或 Cloudflare 加的標頭、不是別的網站嵌入或載入的。
之後如果把服務掛到對外的網域，設定頁照樣只有本機開得了。

`/drop` 只收 `application/json`：網頁可以偷偷跨站送 `text/plain`，但送 JSON 加金鑰標頭會被瀏覽器擋下來。

## 測試

```bash
npm test
```

涵蓋存檔內容、檔名安全（惡意標題跑不出資料夾）、金鑰、壞輸入、設定頁的各種拒絕情況。
腳本本體是用無頭瀏覽器手動驗的（選字 → 右鍵 → 點 → 檔案出現），還沒有放進 `npm test`。

## 還沒做

- 圖片、截圖、整頁。
- 轉送到別的地方（rawtxt、pokkit、其他專案）。
- 從手機或別台電腦用。
- 整理、搜尋存下來的檔。

設計與取捨：`docs/superpowers/specs/2026-11-15-power-right-click-design.md`
