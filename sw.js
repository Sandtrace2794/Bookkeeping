// 離線快取：app shell 用 stale-while-revalidate，其餘一律走網路
const CACHE = 'bk-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/db.js',
  './js/sync.js',
  './js/charts.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // 個別加入，任何一個檔案缺失都不會讓整個安裝失敗
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 只處理自己網域的資源；Google API / 登入元件一律走網路
  if (url.origin !== location.origin) return;

  // 網路優先：有網路時永遠拿到最新版本，離線時才退回快取。
  // （快取優先會讓改版後的程式碼卡住，對自己維護的 App 反而麻煩。）
  // no-cache：略過瀏覽器 HTTP 快取，每次都向伺服器確認（沒變只回 304）。
  // GitHub Pages 給 max-age=600，不加的話推送後最多 10 分鐘內都還會拿到舊檔。
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
