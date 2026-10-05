## 一、在 Windows PC 上開啟

需要 Node.js（`node -v` 有輸出即可）。在專案資料夾按兩下 **`start-windows.cmd`**，或手動執行：

```bash
npx --yes serve -l 5173 .
```

然後開啟 <http://localhost:5173>。

> 不要直接用 `file://` 開 index.html —— ES modules 與 Service Worker 都需要 http(s)。

---

## 二、在 Android 上開啟

Android 需要一個**公開的 https 網址**（Service Worker、「加到主畫面」、Google 登入都要求 secure context，同一個 Wi-Fi 的 `http://192.168.x.x` 不算）。免費部署到 GitHub Pages：

1. 在 GitHub 建一個 repo（Public 或 Private 都可以，Pages 對 Private repo 需付費方案，個人用建議 Public —— 裡面沒有任何帳號資料）。
2. 把這個資料夾的內容推上去：

   ```bash
   git init
   git add .
   git commit -m "記帳本"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/<repo>.git
   git push -u origin main
   ```

3. repo → **Settings → Pages → Source** 選 `Deploy from a branch`，branch 選 `main` / `(root)`，存檔。
4. 約一分鐘後網址會是 `https://<你的帳號>.github.io/<repo>/`。
5. 手機 Chrome 開這個網址 → 右上選單 →「加到主畫面 / 安裝應用程式」。

之後要更新就 `git push`，重開 App 即是新版（Service Worker 採「網路優先」，有網路時一定拿到最新檔案，離線時才用快取）。

> Cloudflare Pages、Netlify、Vercel 同樣可行，拖一個資料夾上去就好。

---

## 三、Google 雲端硬碟同步（手機＋電腦通用）

App 只會存取**自己建立的那一個檔案**（`bookkeeping.json`，使用 `drive.file` 權限範圍），看不到你雲端硬碟裡的其他東西。因為是純前端，需要你自己申請一組 OAuth Client ID（免費、一次性）：

1. 開 <https://console.cloud.google.com/> → 建立專案（名稱隨意）。
2. 左側 **API 和服務 → 程式庫** → 搜尋 **Google Drive API** → 啟用。
3. **API 和服務 → OAuth 同意畫面**
   - User Type 選「外部」→ 建立
   - 應用程式名稱、使用者支援電子郵件、開發人員聯絡資訊填自己的 Gmail → 儲存
   - 發布狀態維持「測試中」即可，在 **測試使用者** 加入自己的 Google 帳號
4. **API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID**
   - 應用程式類型：**網頁應用程式**
   - **已授權的 JavaScript 來源**（重點，兩個都加）：
     - `http://localhost:5173`
     - `https://sandtrace2794.github.io`  ← 只填到網域，不含路徑
   - 建立 → 複製 **用戶端 ID**（`xxxxx.apps.googleusercontent.com`）
5. 回到 App → **設定 → 雲端同步 → Client ID** 貼上 → 按 **連結帳號** → 授權。
6. 之後按 **立即同步**；勾選「變更後自動同步」則記帳後約 4 秒自動上傳。

手機和電腦填同一組 Client ID、登入同一個 Google 帳號，就會同步同一個檔案。

**同步規則**：雙向合併，以每筆紀錄的更新時間為準（last-write-wins）。刪除採「墓碑」標記而非真的移除，所以在 A 裝置刪掉的紀錄同步後也會在 B 裝置消失。不會因為某台裝置資料較舊而把新資料蓋掉。

**授權權杖只有一小時**，過期後要重按一次「連結帳號」（純前端 App 無法避免；不存 refresh token 反而比較安全）。因此**總覽頁最上面就有一張同步卡**，狀態分三種，一按就做對應的事：

| 卡片 | 狀態 | 按下去 |
|---|---|---|
| ☁️ 雲端同步 | 還沒填 Client ID | 跳到設定頁 |
| 🔑 需要重新連結 | 權杖過期或還沒授權 | 重新授權並立刻同步 |
| ✅ 已連結 | 權杖有效 | 立即同步 |

---

## 四、本機資料夾同步（電腦版替代方案）

如果你電腦已經裝了 OneDrive / Google Drive / Dropbox 桌面版：

**設定 → 雲端同步 → 本機資料夾 → 選擇資料夾**，挑一個在同步資料夾底下的目錄。App 會把 `bookkeeping.json` 寫進去，交給雲端軟體上傳；記帳後也會自動靜默寫檔。

僅電腦版 Chrome / Edge 支援（File System Access API），Android 請用上面的 Google 雲端硬碟方式。

---

## 五、備份與轉移

**設定 → 檔案備份**：

- **匯出 JSON** —— 完整快照（紀錄、類別、設定），可用來備份或搬到另一台裝置
- **匯入 JSON** —— 與現有資料**合併**（不是覆蓋），規則同上
- **匯出 CSV** —— 給 Excel / Google 試算表用，含 BOM 所以中文不會亂碼
