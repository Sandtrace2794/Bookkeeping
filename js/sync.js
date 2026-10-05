// 同步：Google 雲端硬碟 / 本機資料夾（File System Access）/ 檔案匯出匯入
import { S, snapshot, mergeSnapshot, liveRecords, catById } from './store.js';
import * as db from './db.js';

export const FILE_NAME = 'bookkeeping.json';
const G_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/* =======================================================================
   Google 雲端硬碟
   ======================================================================= */
let tokenClient = null;
let accessToken = null;
let tokenExp = 0;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = res;
    s.onerror = () => rej(new Error('無法載入 Google 登入元件，請確認網路連線'));
    document.head.appendChild(s);
  });
}

async function ensureClient() {
  const cid = (S.settings.gClientId || '').trim();
  if (!cid) throw new Error('請先填入 Google OAuth Client ID');
  await loadGis();
  if (!tokenClient || tokenClient._cid !== cid) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid, scope: G_SCOPE, callback: () => {},
    });
    tokenClient._cid = cid;
  }
  return tokenClient;
}

/** 取得存取權杖。interactive=false 時嘗試靜默取得 */
export async function gToken(interactive = true) {
  if (accessToken && Date.now() < tokenExp - 60000) return accessToken;
  const cached = sessionStorage.getItem('bk_gtoken');
  if (cached) {
    const o = JSON.parse(cached);
    if (Date.now() < o.exp - 60000) { accessToken = o.t; tokenExp = o.exp; return accessToken; }
  }
  if (!interactive) throw new Error('NEED_AUTH');
  const client = await ensureClient();
  return new Promise((resolve, reject) => {
    client.callback = resp => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      accessToken = resp.access_token;
      tokenExp = Date.now() + (resp.expires_in || 3600) * 1000;
      sessionStorage.setItem('bk_gtoken', JSON.stringify({ t: accessToken, exp: tokenExp }));
      resolve(accessToken);
    };
    client.error_callback = err => reject(new Error(err?.message || '授權被取消'));
    try {
      client.requestAccessToken({ prompt: '' });
    } catch (e) { reject(e); }
  });
}

export function gIsConnected() { return !!sessionStorage.getItem('bk_gtoken') || !!accessToken; }

export async function gDisconnect() {
  try { if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {}); } catch {}
  accessToken = null; tokenExp = 0;
  sessionStorage.removeItem('bk_gtoken');
  await db.delMeta('gFileId');
}

async function gFetch(url, opts = {}, interactive = false) {
  const t = await gToken(interactive);
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (r.status === 401) {
    accessToken = null; sessionStorage.removeItem('bk_gtoken');
    const t2 = await gToken(true);
    return fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t2, ...(opts.headers || {}) } });
  }
  return r;
}

async function gFindFile() {
  const cached = await db.getMeta('gFileId');
  if (cached) {
    const r = await gFetch(`https://www.googleapis.com/drive/v3/files/${cached}?fields=id,name,modifiedTime,trashed`);
    if (r.ok) {
      const f = await r.json();
      if (!f.trashed) return f;
    }
    await db.delMeta('gFileId');
  }
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=5`);
  if (!r.ok) throw new Error('讀取雲端檔案清單失敗：' + (await r.text()).slice(0, 120));
  const j = await r.json();
  const f = (j.files || [])[0];
  if (f) await db.setMeta('gFileId', f.id);
  return f || null;
}

async function gUpload(fileId, data) {
  const meta = { name: FILE_NAME, mimeType: 'application/json' };
  const boundary = 'bk' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`;
  const r = await gFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) throw new Error('上傳失敗：' + (await r.text()).slice(0, 160));
  const j = await r.json();
  await db.setMeta('gFileId', j.id);
  return j;
}

/** 完整同步：下載 → 合併 → 上傳 */
export async function gSync(interactive = true) {
  await gToken(interactive);
  const f = await gFindFile();
  let merged = { added: 0, updated: 0 };
  if (f) {
    const r = await gFetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
    if (r.ok) {
      const text = await r.text();
      if (text.trim()) {
        try { merged = await mergeSnapshot(JSON.parse(text)); }
        catch (e) { throw new Error('雲端檔案無法解析：' + e.message); }
      }
    }
  }
  const up = await gUpload(f?.id, snapshot());
  const info = { at: Date.now(), fileId: up.id, ...merged };
  await db.setMeta('lastSync', info);
  return info;
}

/* =======================================================================
   本機資料夾（電腦版 Chrome / Edge）
   ======================================================================= */
export const folderSupported = () => typeof window.showDirectoryPicker === 'function';

export async function pickFolder() {
  if (!folderSupported()) throw new Error('此瀏覽器不支援資料夾存取（請用電腦版 Chrome / Edge）');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'bkcity' });
  await db.setMeta('folderHandle', handle);
  return handle;
}
export async function forgetFolder() { await db.delMeta('folderHandle'); }
export async function getFolder() { return db.getMeta('folderHandle'); }

async function folderPerm(handle, request) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

/** 讀取資料夾中的檔案 → 合併 → 寫回 */
export async function folderSync(request = true) {
  const handle = await getFolder();
  if (!handle) throw new Error('尚未選擇資料夾');
  if (!(await folderPerm(handle, request))) throw new Error('沒有資料夾存取權限');
  let merged = { added: 0, updated: 0 };
  try {
    const fh = await handle.getFileHandle(FILE_NAME);
    const text = await (await fh.getFile()).text();
    if (text.trim()) merged = await mergeSnapshot(JSON.parse(text));
  } catch (e) {
    if (e.name !== 'NotFoundError') throw e;
  }
  const fh = await handle.getFileHandle(FILE_NAME, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(snapshot(), null, 1));
  await w.close();
  const info = { at: Date.now(), ...merged };
  await db.setMeta('lastFolderSync', info);
  return info;
}

/** 只寫入（自動存檔用，不跳權限視窗） */
export async function folderSaveQuiet() {
  const handle = await getFolder();
  if (!handle) return false;
  if (!(await folderPerm(handle, false))) return false;
  const fh = await handle.getFileHandle(FILE_NAME, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(snapshot(), null, 1));
  await w.close();
  await db.setMeta('lastFolderSync', { at: Date.now(), quiet: true });
  return true;
}

/* =======================================================================
   檔案匯出 / 匯入
   ======================================================================= */
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportJson() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  download(`bookkeeping-${stamp}.json`, JSON.stringify(snapshot(), null, 1), 'application/json');
}

export function exportCsv() {
  const rows = [['日期', '類型', '類別', '金額', '備註', '算式']];
  liveRecords().sort((a, b) => a.date.localeCompare(b.date)).forEach(r => {
    rows.push([r.date, r.type === 'income' ? '收入' : '支出', catById(r.cat).name, r.amount, r.note || '', r.expr || '']);
  });
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download('bookkeeping.csv', csv, 'text/csv;charset=utf-8');
}

export async function importFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  return mergeSnapshot(data);
}

export async function lastSyncInfo() {
  return { g: await db.getMeta('lastSync'), folder: await db.getMeta('lastFolderSync') };
}
