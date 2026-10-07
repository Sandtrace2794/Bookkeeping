// 應用狀態：記錄、類別、設定。所有變更都經過這裡並發出事件。
import * as db from './db.js';

/** 類別版本；改動預設類別時 +1，資料庫還沒有紀錄的話會自動換成新的預設值 */
export const CATS_VER = 3;

export const DEFAULT_CATS = [
  { id: 'food', name: '食物', icon: '🍜', color: '#FF8A65', type: 'expense' },
  { id: 'drink', name: '飲品', icon: '☕', color: '#FFB74D', type: 'expense' },
  { id: 'transit', name: '交通', icon: '🚌', color: '#64B5F6', type: 'expense' },
  { id: 'fun', name: '娛樂', icon: '🎮', color: '#4DD0E1', type: 'expense' },
  { id: 'home', name: '居家', icon: '🏠', color: '#81C784', type: 'expense' },
  { id: 'income', name: '收入', icon: '💰', color: '#4DB6AC', type: 'income' },
  { id: 'tech', name: '3C', icon: '💻', color: '#7986CB', type: 'expense' },
  { id: 'health', name: '醫藥', icon: '💊', color: '#E57373', type: 'expense' },
  { id: 'shop', name: '消費', icon: '🛍️', color: '#BA68C8', type: 'expense' },
  { id: 'pet', name: '寵物', icon: '🐾', color: '#A1887F', type: 'expense' },
  { id: 'other', name: '其他', icon: '📦', color: '#90A4AE', type: 'expense' },
];

export const DEFAULT_SETTINGS = {
  currency: 'NT$', budget: 0, startDay: 1, theme: 'auto',
  gClientId: '', autoSync: false,
};

export const S = {
  records: [],
  cats: [],
  settings: { ...DEFAULT_SETTINGS },
  ready: false,
};

/* ---------- 事件 ---------- */
const listeners = new Set();
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what = 'data') { listeners.forEach(fn => fn(what)); }

/* ---------- 工具 ---------- */
export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
export const pad2 = n => String(n).padStart(2, '0');
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return todayStr(t);
};
export const daysBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
};

export function fmtMoney(n, withSign = false) {
  const v = Math.round(Math.abs(n) * 100) / 100;
  const s = v.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  return (withSign && n < 0 ? '-' : '') + s;
}
export function money(n) { return S.settings.currency + ' ' + fmtMoney(n); }

/** 日期屬於哪個「記帳月」（考慮每月起算日） */
export function monthKeyOf(dateStr) {
  const sd = S.settings.startDay || 1;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (d >= sd) return `${y}-${pad2(m)}`;
  let mm = m - 1, yy = y;
  if (mm < 1) { mm = 12; yy--; }
  return `${yy}-${pad2(mm)}`;
}
/** 記帳月的起訖日（含頭含尾） */
export function monthRange(key) {
  const sd = S.settings.startDay || 1;
  const [y, m] = key.split('-').map(Number);
  const from = new Date(y, m - 1, sd);
  const to = new Date(y, m, sd);
  to.setDate(to.getDate() - 1);
  return { from: todayStr(from), to: todayStr(to), fromDate: from, toDate: to };
}
export function currentMonthKey() { return monthKeyOf(todayStr()); }
export function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return y === new Date().getFullYear() ? `${m} 月` : `${y}/${m}`;
}

export const catById = id => S.cats.find(c => c.id === id)
  || { id, name: '未分類', icon: '❓', color: '#9aa7b4', type: 'expense' };
/** 記錄的收支別完全由類別決定 —— 新增時不需要額外選 */
export const typeOfCat = id => (catById(id).type === 'income' ? 'income' : 'expense');

/* ---------- 載入 / 儲存 ---------- */
export async function load() {
  const [recs, cats, settings, catsVer] = await Promise.all([
    db.allRecords(), db.getMeta('cats'), db.getMeta('settings'), db.getMeta('catsVer'),
  ]);
  S.records = recs || [];
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  // 還沒有任何紀錄時，直接換上新版預設類別；已經在用的人保留自己的設定
  const stale = (catsVer || 1) < CATS_VER && !S.records.length;
  if (!cats || !cats.length || stale) {
    S.cats = DEFAULT_CATS.map(c => ({ ...c }));
    await db.setMeta('cats', S.cats);
  } else {
    S.cats = cats;
  }
  await db.setMeta('catsVer', CATS_VER);

  S.ready = true;
  emit('load');
}

export async function saveSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  await db.setMeta('settings', S.settings);
  emit('settings');
}
export async function saveCats() {
  S.cats = S.cats.map((c, i) => ({ ...c, ord: i }));
  await db.setMeta('cats', S.cats);
  emit('cats');
}

/* ---------- 記錄 CRUD ---------- */
export async function addRecord({ amount, cat, note, date, expr }) {
  const rec = {
    id: uid(), type: typeOfCat(cat), amount: +amount, cat,
    note: note || '', expr: expr || '',
    date: date || todayStr(), upd: Date.now(), del: 0,
  };
  S.records.push(rec);
  await db.putRecord(rec);
  emit('records');
  return rec;
}
export async function updateRecord(id, patch) {
  const i = S.records.findIndex(r => r.id === id);
  if (i < 0) return null;
  const rec = { ...S.records[i], ...patch, upd: Date.now() };
  if (patch.amount !== undefined) rec.amount = +patch.amount;
  if (patch.cat !== undefined) rec.type = typeOfCat(patch.cat);
  S.records[i] = rec;
  await db.putRecord(rec);
  emit('records');
  return rec;
}
export async function removeRecord(id) {
  return updateRecord(id, { del: 1 });
}

/* ---------- 查詢 ---------- */
export const liveRecords = () => S.records.filter(r => !r.del);
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.upd - a.upd;

export function recordsOfMonth(key) {
  return liveRecords().filter(r => monthKeyOf(r.date) === key).sort(byDateDesc);
}
export function recordsOfDay(day) {
  return liveRecords().filter(r => r.date === day).sort((a, b) => b.upd - a.upd);
}
export function recordsInRange({ from, to }) {
  return liveRecords().filter(r => r.date >= from && r.date <= to).sort(byDateDesc);
}
export function totals(list) {
  let out = 0, inc = 0;
  for (const r of list) (r.type === 'income' ? (inc += r.amount) : (out += r.amount));
  return { out, inc, net: inc - out };
}
export function byCategory(list, type) {
  const map = new Map();
  for (const r of list) {
    if (type && r.type !== type) continue;
    map.set(r.cat, (map.get(r.cat) || 0) + r.amount);
  }
  return [...map.entries()]
    .map(([cat, amount]) => ({ cat, amount, c: catById(cat) }))
    .sort((a, b) => b.amount - a.amount);
}

/* ---------- 統計區間 ----------
   sel = { mode:'month', key:'2026-09' }
       | { mode:'year',  year:2026 }
       | { mode:'custom', from:'2026-01-01', to:'2026-03-31' }
   月／年一律是完整單位：9/14 看「一個月」得到的是整個 9 月。                    */
export function rangeOf(sel) {
  if (sel.mode === 'year') {
    const a = monthRange(`${sel.year}-01`), b = monthRange(`${sel.year}-12`);
    return { from: a.from, to: b.to };
  }
  if (sel.mode === 'custom') {
    const [from, to] = sel.from <= sel.to ? [sel.from, sel.to] : [sel.to, sel.from];
    return { from, to };
  }
  const r = monthRange(sel.key);
  return { from: r.from, to: r.to };
}
/** 上一個等長區間，用來做期間比較 */
export function prevSel(sel) {
  if (sel.mode === 'year') return { mode: 'year', year: sel.year - 1 };
  if (sel.mode === 'custom') {
    const { from, to } = rangeOf(sel);
    const len = daysBetween(from, to);
    const pTo = addDays(from, -1);
    return { mode: 'custom', from: addDays(pTo, -len), to: pTo };
  }
  return { mode: 'month', key: shiftMonthKey(sel.key, -1) };
}
export function shiftSel(sel, delta) {
  if (sel.mode === 'year') return { ...sel, year: sel.year + delta };
  if (sel.mode === 'custom') {
    const { from, to } = rangeOf(sel);
    const len = daysBetween(from, to) + 1;
    return { mode: 'custom', from: addDays(from, delta * len), to: addDays(to, delta * len) };
  }
  return { ...sel, key: shiftMonthKey(sel.key, delta) };
}
export function selLabel(sel) {
  if (sel.mode === 'year') return `${sel.year} 年`;
  if (sel.mode === 'custom') {
    const { from, to } = rangeOf(sel);
    return `${from.slice(5).replace('-', '/')} – ${to.slice(5).replace('-', '/')}`;
  }
  const [y, m] = sel.key.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}


/** 備註快填建議：同類別用過的備註，常用與最近使用優先 */
export function noteSuggestions(catId, limit = 8) {
  const stat = new Map();
  for (const r of liveRecords()) {
    const note = (r.note || '').trim();
    if (!note) continue;
    const key = note;
    const cur = stat.get(key) || { note, n: 0, upd: 0, sameCat: false };
    cur.n++;
    cur.upd = Math.max(cur.upd, r.upd || 0);
    if (r.cat === catId) cur.sameCat = true;
    stat.set(key, cur);
  }
  const all = [...stat.values()];
  const mine = all.filter(x => x.sameCat);
  const pool = mine.length ? mine : all;
  const last = pool.reduce((a, b) => (!a || b.upd > a.upd ? b : a), null);
  const rest = pool
    .filter(x => x !== last)
    .sort((a, b) => b.n - a.n || b.upd - a.upd);
  return [last, ...rest].filter(Boolean).slice(0, limit)
    .map(x => ({ note: x.note, last: x === last }));
}

/* ---------- 匯入 / 匯出（同步用快照） ---------- */
export function snapshot() {
  return {
    app: 'bookkeeping', ver: 2, exportedAt: new Date().toISOString(),
    records: S.records, cats: S.cats, settings: S.settings,
  };
}

/** 以 updatedAt 為準的雙向合併（last-write-wins，刪除用墓碑） */
export async function mergeSnapshot(remote) {
  if (!remote || !Array.isArray(remote.records)) throw new Error('檔案格式不符');
  const mine = new Map(S.records.map(r => [r.id, r]));
  const theirs = new Map(remote.records.filter(r => r && r.id).map(r => [r.id, r]));
  // 本機有、遠端沒有或較舊的筆數 —— 同步時會被上傳過去
  let uploaded = 0;
  for (const r of S.records) {
    const t = theirs.get(r.id);
    if (!t || (r.upd || 0) > (t.upd || 0)) uploaded++;
  }
  const toPut = [];
  let added = 0, updated = 0;
  for (const r of remote.records) {
    if (!r || !r.id) continue;
    const cur = mine.get(r.id);
    if (!cur) { mine.set(r.id, r); toPut.push(r); added++; }
    else if ((r.upd || 0) > (cur.upd || 0)) { mine.set(r.id, r); toPut.push(r); updated++; }
  }
  S.records = [...mine.values()];
  await db.putRecords(toPut);

  // 類別：以遠端為準補齊缺少的，不刪除本機自訂
  if (Array.isArray(remote.cats) && remote.cats.length) {
    const have = new Set(S.cats.map(c => c.id));
    const merged = [...S.cats];
    remote.cats.forEach(c => { if (!have.has(c.id)) merged.push(c); });
    S.cats = merged;
    await db.setMeta('cats', S.cats);
  }
  emit('merge');
  return { added, updated, uploaded, total: S.records.length };
}

/** 完整覆蓋匯入（使用者明確選擇時才用） */
export async function replaceAll(data) {
  await db.wipeAll();
  S.records = data.records || [];
  S.cats = (data.cats && data.cats.length) ? data.cats : DEFAULT_CATS.map(c => ({ ...c }));
  S.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  await db.putRecords(S.records);
  await db.setMeta('cats', S.cats);
  await db.setMeta('settings', S.settings);
  await db.setMeta('catsVer', CATS_VER);
  emit('load');
}

export async function wipe() {
  await db.wipeAll();
  S.records = [];
  S.cats = DEFAULT_CATS.map(c => ({ ...c }));
  S.settings = { ...DEFAULT_SETTINGS };
  await db.setMeta('cats', S.cats);
  await db.setMeta('catsVer', CATS_VER);
  emit('load');
}
