// IndexedDB 薄封裝：records（記帳紀錄）+ meta（設定 / 城市 / 同步狀態）
const DB_NAME = 'bkcity';
const DB_VER = 1;
let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('upd', 'upd');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}
function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export async function allRecords() {
  return wrap((await tx('records', 'readonly')).getAll());
}
export async function putRecord(rec) {
  return wrap((await tx('records', 'readwrite')).put(rec));
}
export async function putRecords(list) {
  if (!list.length) return;
  const db = await open();
  await new Promise((res, rej) => {
    const t = db.transaction('records', 'readwrite');
    const s = t.objectStore('records');
    list.forEach(r => s.put(r));
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
export async function clearRecords() {
  return wrap((await tx('records', 'readwrite')).clear());
}
export async function getMeta(k, dflt = null) {
  const row = await wrap((await tx('meta', 'readonly')).get(k));
  return row ? row.v : dflt;
}
export async function setMeta(k, v) {
  return wrap((await tx('meta', 'readwrite')).put({ k, v }));
}
export async function delMeta(k) {
  return wrap((await tx('meta', 'readwrite')).delete(k));
}
export async function wipeAll() {
  const db = await open();
  await new Promise((res, rej) => {
    const t = db.transaction(['records', 'meta'], 'readwrite');
    t.objectStore('records').clear();
    t.objectStore('meta').clear();
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
