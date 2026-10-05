// 介面控制：路由、記帳面板、明細、統計、設定
import * as store from './store.js';
import { S } from './store.js';
import * as sync from './sync.js';
import * as charts from './charts.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** #rrggbb → rgba()，用於圖示底色 */
function fade(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(140,150,160,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const md = d => d.slice(5).replace('-', '/');
/** 區間文字：同一個年度只顯示月日，跨年度才補上年份 */
function rangeText({ from, to }) {
  const cy = String(new Date().getFullYear());
  return (from.slice(0, 4) === cy && to.slice(0, 4) === cy)
    ? `${md(from)} – ${md(to)}` : `${from} – ${to}`;
}

/* =========================================================
   全域介面狀態
   ========================================================= */
const UI = {
  view: 'home',
  month: store.currentMonthKey(),   // 總覽／明細共用
  search: '',
};
/** 統計區間。月與年一律是完整單位 */
const R = {
  mode: 'month',
  key: store.currentMonthKey(),
  year: new Date().getFullYear(),
  from: '', to: '',
};
const currentSel = () => R.mode === 'month' ? { mode: 'month', key: R.key }
  : R.mode === 'year' ? { mode: 'year', year: R.year }
    : { mode: 'custom', from: R.from, to: R.to };

/* =========================================================
   小工具：Toast / 彈窗
   ========================================================= */
let toastTimer = 0;
function toast(msg, ms = 2000) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function openModal(html, onMount) {
  const box = $('modalBox');
  box.innerHTML = html;
  $('modalMask').hidden = false;
  onMount?.(box);
}
function closeModal() {
  $('modalMask').hidden = true;
  $('modalBox').innerHTML = '';
}
$('modalMask').addEventListener('click', e => { if (e.target.id === 'modalMask') closeModal(); });

/** 取代 confirm()，行動裝置上比較一致 */
function confirmBox(title, body, okText = '確定') {
  return new Promise(resolve => {
    openModal(`<h3>${esc(title)}</h3><p class="muted small">${body}</p>
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn btn-ghost" data-no>取消</button>
        <button class="btn btn-danger" data-yes>${esc(okText)}</button>
      </div>`, box => {
      box.querySelector('[data-no]').onclick = () => { closeModal(); resolve(false); };
      box.querySelector('[data-yes]').onclick = () => { closeModal(); resolve(true); };
    });
  });
}

/* =========================================================
   路由
   ========================================================= */
function go(view) {
  UI.view = view;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  document.querySelectorAll('.tabbar .tab').forEach(t => t.classList.toggle('is-on', t.dataset.go === view));
  window.scrollTo(0, 0);
  render();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go]');
  if (t) go(t.dataset.go);
});

/* =========================================================
   月份選擇器（總覽／明細）
   ========================================================= */
function monthPicker() {
  let year = +UI.month.split('-')[0];
  const draw = box => {
    const cur = store.currentMonthKey();
    box.innerHTML = `<div class="year-nav">
        <button class="icon-btn" data-y="-1">‹</button><b>${year}</b><button class="icon-btn" data-y="1">›</button>
      </div>
      <div class="month-grid">${Array.from({ length: 12 }, (_, i) => {
        const k = `${year}-${String(i + 1).padStart(2, '0')}`;
        return `<button data-k="${k}" class="${k === UI.month ? 'is-on' : ''}">${i + 1} 月${k === cur ? ' •' : ''}</button>`;
      }).join('')}</div>`;
    box.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { year += +b.dataset.y; draw(box); });
    box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      UI.month = b.dataset.k; closeModal(); render();
    });
  };
  openModal('', draw);
}
['btnMonthPickHome', 'btnMonthPickList'].forEach(id => $(id).onclick = monthPicker);

/* =========================================================
   記帳面板
   ========================================================= */
const E = {
  id: null, cat: null,
  buf: '0',
  acc: null,     // 已累計的值
  op: null,      // 待運算的符號
  head: '',      // 已輸入的算式文字，例如 "120 + 45 + "
  done: '',      // 按過 ✓ 之後保留的完整算式
  afterEq: false,
};

function openEntry(rec, presetCat) {
  Object.assign(E, { acc: null, op: null, head: '', done: '', afterEq: false });
  if (rec) {
    E.id = rec.id; E.cat = rec.cat; E.buf = String(rec.amount); E.done = rec.expr || '';
    $('entryDate').value = rec.date;
    $('entryNote').value = rec.note || '';
    $('entryTitle').textContent = '編輯紀錄';
    $('entryDeleteWrap').hidden = false;
  } else {
    E.id = null; E.buf = '0';
    E.cat = presetCat || S.cats[0]?.id || null;
    $('entryDate').value = store.todayStr();
    $('entryNote').value = '';
    $('entryTitle').textContent = '記一筆';
    $('entryDeleteWrap').hidden = true;
  }
  $('entryDate').max = store.todayStr();   // 不能新增未來的紀錄
  $('entryMask').hidden = false;
  drawEntry();
}
function closeEntry() { $('entryMask').hidden = true; }

function drawEntry() {
  $('entryCur').textContent = S.settings.currency;
  $('entryAmount').textContent = E.buf;
  $('calcPreview').textContent = E.op ? `${E.head}${E.buf}` : (E.done ? `${E.done} =` : '');
  $('amountView').classList.toggle('is-income', store.typeOfCat(E.cat) === 'income');

  if (!S.cats.some(c => c.id === E.cat)) E.cat = S.cats[0]?.id || null;
  $('entryCats').innerHTML = S.cats.map(c => `
    <button class="cat-item ${c.id === E.cat ? 'is-on' : ''}" data-cat="${esc(c.id)}">
      <span class="ci" style="background:${fade(c.color, .18)}">${esc(c.icon)}</span>
      <small>${esc(c.name)}</small>
    </button>`).join('')
    // 就地新增類別，不必為了一個新類別特地跑去設定頁
    + `<button class="cat-item cat-add" data-newcat>
        <span class="ci">＋</span><small>新增</small>
      </button>`;

  drawNoteChips();
}

/** 備註快填：同類別用過的備註，最近一次標上「上次」 */
function drawNoteChips() {
  const list = store.noteSuggestions(E.cat, 8);
  $('noteChips').innerHTML = list.map(s =>
    `<button data-note="${esc(s.note)}" class="${s.last ? 'is-last' : ''}">${esc(s.note)}${s.last ? '<span class="tag">上次</span>' : ''}</button>`
  ).join('');
}
$('noteChips').addEventListener('click', e => {
  const b = e.target.closest('[data-note]');
  if (b) $('entryNote').value = b.dataset.note;
});

$('entryCats').addEventListener('click', e => {
  if (e.target.closest('[data-newcat]')) {
    // 新增完直接選起來，可以接著記這一筆
    return catEditor(null, c => { if (c) E.cat = c.id; drawEntry(); });
  }
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  E.cat = b.dataset.cat;
  drawEntry();
});
$('entryCancel').onclick = closeEntry;
$('entryMask').addEventListener('click', e => { if (e.target.id === 'entryMask') closeEntry(); });
$('entryDate').addEventListener('change', e => {
  if (e.target.value > store.todayStr()) {
    e.target.value = store.todayStr();
    toast('不能記未來的日期');
  }
});

/* ---- 計算機（保留計算履歷） ---- */
const applyOp = (a, b, op) => Math.round((op === '-' ? a - b : a + b) * 100) / 100;
const curValue = () => (E.op ? applyOp(E.acc, +E.buf, E.op) : +E.buf);
/** 要存進紀錄的算式；只有真的算過才留 */
function fullExpr() {
  const s = E.op ? `${E.head}${E.buf}` : E.done;
  return /[+-]/.test(s || '') ? s : '';
}

function keyIn(k) {
  const digit = /^\d$|^00$/.test(k);
  if ((digit || k === '.') && E.afterEq) {          // 算完後再輸入 = 重新開始
    E.buf = '0'; E.done = ''; E.afterEq = false;
  }
  if (digit) {
    if (E.buf === '0') E.buf = k === '00' ? '0' : k;
    else if (E.buf.replace('.', '').length < 11) E.buf += k;
  } else if (k === '.') {
    if (!E.buf.includes('.')) E.buf += '.';
  } else if (k === 'del') {
    E.buf = E.buf.length > 1 ? E.buf.slice(0, -1) : '0';
    if (E.buf === '0' && E.op) {                     // 退回到還沒按運算符號的狀態
      E.buf = String(E.acc); E.acc = null; E.op = null; E.head = '';
    }
    E.done = ''; E.afterEq = false;
  } else if (k === '+' || k === '-') {
    E.head = `${E.head}${E.buf} ${k} `;
    E.acc = curValue();
    E.op = k;
    E.buf = '0';
    E.done = ''; E.afterEq = false;
  } else if (k === 'ok') {
    if (E.op) {
      E.done = `${E.head}${E.buf}`;
      E.buf = String(curValue());
      E.acc = null; E.op = null; E.head = '';
      E.afterEq = true;
    } else return saveEntry();
  }
  if (/\.\d{3,}$/.test(E.buf)) E.buf = (+E.buf).toFixed(2);   // 小數點後最多兩位
  drawEntry();
}
$('keypad').addEventListener('click', e => {
  const b = e.target.closest('[data-k]');
  if (b) keyIn(b.dataset.k);
});
// 電腦版鍵盤
document.addEventListener('keydown', e => {
  if ($('entryMask').hidden) return;
  if (!$('modalMask').hidden) return;          // 類別編輯器蓋在上面時不搶按鍵
  if (e.target.matches('input')) { if (e.key === 'Escape') closeEntry(); return; }
  if (e.key === 'Escape') return closeEntry();
  if (/^[0-9]$/.test(e.key)) return keyIn(e.key);
  if (e.key === '.') return keyIn('.');
  if (e.key === '+' || e.key === '-') return keyIn(e.key);
  if (e.key === 'Backspace') { e.preventDefault(); return keyIn('del'); }
  if (e.key === 'Enter') return keyIn('ok');
});

async function saveEntry() {
  const amount = curValue();
  if (!(amount > 0)) return toast('請輸入金額');
  if (!E.cat) return toast('請選擇類別');
  const date = $('entryDate').value || store.todayStr();
  if (date > store.todayStr()) return toast('不能記未來的日期');
  const data = {
    amount, cat: E.cat,
    note: $('entryNote').value.trim(),
    expr: fullExpr(),
    date,
  };
  if (E.id) { await store.updateRecord(E.id, data); toast('已更新'); }
  else { await store.addRecord(data); toast('已記下一筆'); }
  closeEntry();
}
$('entrySave').onclick = saveEntry;
$('entryDelete').onclick = async () => {
  if (!E.id) return;
  if (!(await confirmBox('刪除這筆紀錄？', '刪除後可透過雲端同步套用到其他裝置。', '刪除'))) return;
  await store.removeRecord(E.id);
  closeEntry();
  toast('已刪除');
};
$('fabAdd').onclick = () => openEntry(null);

// 點擊任何一列紀錄 → 編輯
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rec]');
  if (!b) return;
  const rec = S.records.find(r => r.id === b.dataset.rec);
  if (rec) openEntry(rec);
});

/* =========================================================
   渲染：共用片段
   ========================================================= */
function recRow(r) {
  const c = store.catById(r.cat);
  const inc = r.type === 'income';
  const sub = [r.note, r.expr].filter(Boolean).join('  ·  ');
  return `<button class="rec" data-rec="${esc(r.id)}">
    <span class="rec-ico" style="background:${fade(c.color, .18)}">${esc(c.icon)}</span>
    <span class="rec-main">
      <span class="rec-cat">${esc(c.name)}</span>
      ${sub ? `<span class="rec-note">${esc(sub)}</span>` : ''}
    </span>
    <span class="rec-amt ${inc ? 'in' : 'out'}">${inc ? '+' : '-'}${store.fmtMoney(r.amount)}</span>
  </button>`;
}

/** 類別金額條列。income 那幾筆用各自的收入總額當分母 */
function rankList(items, totalExp, totalInc) {
  if (!items.length) return `<div class="empty">沒有資料</div>`;
  const max = Math.max(...items.map(i => i.amount)) || 1;
  return items.map(it => {
    const inc = it.c.type === 'income';
    const base = inc ? totalInc : totalExp;
    return `<div class="rank">
      <span class="rank-ico" style="background:${fade(it.c.color, .18)}">${esc(it.c.icon)}</span>
      <div class="rank-body">
        <div class="rank-top"><span>${esc(it.c.name)}</span>
          <span class="muted">${base ? Math.round(it.amount / base * 100) : 0}%</span>
          <b class="${inc ? 'rec-amt in' : ''}">${inc ? '+' : ''}${store.fmtMoney(it.amount)}</b></div>
        <div class="rank-bar"><i style="width:${(it.amount / max * 100).toFixed(1)}%;background:${it.c.color}"></i></div>
      </div>
    </div>`;
  }).join('');
}

/** 連續記帳天數（今天還沒記不算中斷） */
function streakDays() {
  const days = new Set(store.liveRecords().map(r => r.date));
  const d = new Date();
  if (!days.has(store.todayStr(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(store.todayStr(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* =========================================================
   渲染：總覽
   ========================================================= */
function renderHome() {
  const key = UI.month;
  const recs = store.recordsOfMonth(key);
  const t = store.totals(recs);
  $('heroMonth').textContent = store.monthLabel(key);
  $('heroSpent').textContent = `${S.settings.currency} ${store.fmtMoney(t.out)}`;

  // 預算
  const budget = +S.settings.budget || 0;
  const fill = $('budgetFill');
  if (budget > 0) {
    const pct = t.out / budget * 100;
    fill.style.width = Math.min(100, pct) + '%';
    fill.classList.toggle('warn', pct >= 80 && pct < 100);
    fill.classList.toggle('over', pct >= 100);
    const left = budget - t.out;
    $('budgetText').textContent = left >= 0
      ? `預算 ${store.fmtMoney(budget)}，還可用 ${store.fmtMoney(left)}（${Math.round(pct)}%）`
      : `已超出預算 ${store.fmtMoney(-left)}（${Math.round(pct)}%）`;
  } else {
    fill.style.width = '0%';
    fill.classList.remove('warn', 'over');
    $('budgetText').textContent = '尚未設定預算 · 可到「設定」新增';
  }

  // 統計條
  const { fromDate, toDate } = store.monthRange(key);
  const now = new Date();
  const endDay = now < toDate ? now : toDate;
  const elapsed = Math.max(1, Math.round((endDay - fromDate) / 86400000) + 1);
  $('statIn').textContent = store.fmtMoney(t.inc);
  $('statNet').textContent = (t.net < 0 ? '-' : '') + store.fmtMoney(t.net);
  $('statAvg').textContent = store.fmtMoney(Math.round(t.out / elapsed));
  $('statStreak').textContent = streakDays();

  // 快速記帳：最近 60 天用最多的類別
  const sinceStr = store.addDays(store.todayStr(), -60);
  const freq = new Map();
  store.liveRecords().forEach(r => { if (r.date >= sinceStr) freq.set(r.cat, (freq.get(r.cat) || 0) + 1); });
  let quick = [...freq.entries()].sort((a, b) => b[1] - a[1])
    .map(([id]) => S.cats.find(c => c.id === id)).filter(Boolean);
  S.cats.forEach(c => { if (quick.length < 6 && !quick.some(q => q.id === c.id)) quick.push(c); });
  $('quickCats').innerHTML = quick.slice(0, 6).map(c => `
    <button data-quick="${esc(c.id)}">
      <span class="qi" style="background:${fade(c.color, .18)}">${esc(c.icon)}</span>
      <small>${esc(c.name)}</small>
    </button>`).join('');

  // 今日
  const today = store.recordsOfDay(store.todayStr());
  const tt = store.totals(today);
  $('todayTotal').textContent = today.length
    ? `支出 ${store.fmtMoney(tt.out)}${tt.inc ? ` · 收入 ${store.fmtMoney(tt.inc)}` : ''}`
    : '';
  $('todayList').innerHTML = today.length
    ? today.map(recRow).join('')
    : `<div class="empty">今天還沒有紀錄，點下方 ＋ 記一筆</div>`;

  // 支出排行
  const by = store.byCategory(recs, 'expense');
  $('homeRank').innerHTML = rankList(by.slice(0, 5), t.out, t.inc);
}
$('quickCats').addEventListener('click', e => {
  const b = e.target.closest('[data-quick]');
  if (b) openEntry(null, b.dataset.quick);
});

/* =========================================================
   渲染：明細
   ========================================================= */
function renderList() {
  $('listMonth').textContent = UI.search ? '全部搜尋結果' : store.monthLabel(UI.month);
  const q = UI.search.trim().toLowerCase();
  let recs;
  if (q) {
    recs = store.liveRecords()
      .filter(r => (r.note || '').toLowerCase().includes(q) || store.catById(r.cat).name.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || b.upd - a.upd)
      .slice(0, 300);
  } else {
    recs = store.recordsOfMonth(UI.month);
  }
  const t = store.totals(recs);
  $('listOut').textContent = store.fmtMoney(t.out);
  $('listIn').textContent = store.fmtMoney(t.inc);
  $('listNet').textContent = (t.net < 0 ? '-' : '') + store.fmtMoney(t.net);

  if (!recs.length) {
    $('listBody').innerHTML = `<div class="card"><div class="empty">${q ? '找不到符合的紀錄' : '這個月還沒有紀錄'}</div></div>`;
    return;
  }
  const groups = new Map();
  recs.forEach(r => {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  });
  $('listBody').innerHTML = [...groups.entries()].map(([date, list]) => {
    const g = store.totals(list);
    const [y, m, d] = date.split('-').map(Number);
    const wd = WEEK[new Date(y, m - 1, d).getDay()];
    const sum = [g.out ? `-${store.fmtMoney(g.out)}` : '', g.inc ? `+${store.fmtMoney(g.inc)}` : '']
      .filter(Boolean).join('  ');
    return `<div class="day-group">
      <div class="day-head"><b>${m}/${d}</b><span>週${wd}</span><span class="day-sum">${sum}</span></div>
      <div class="rec-list">${list.map(recRow).join('')}</div>
    </div>`;
  }).join('');
}
$('btnSearch').onclick = () => {
  const row = $('searchRow');
  row.hidden = !row.hidden;
  if (!row.hidden) $('searchInput').focus();
  else { UI.search = ''; $('searchInput').value = ''; render(); }
};
$('searchInput').addEventListener('input', e => { UI.search = e.target.value; renderList(); });
$('btnSearchClear').onclick = () => { UI.search = ''; $('searchInput').value = ''; renderList(); };

/* =========================================================
   渲染：統計
   ========================================================= */
$('rangeModeSeg').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  R.mode = b.dataset.mode;
  if (R.mode === 'custom' && !R.from) {
    const r = store.monthRange(store.currentMonthKey());
    R.from = r.from; R.to = r.to;
  }
  renderStats();
});
$('periodNav').addEventListener('click', e => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  const next = store.shiftSel(currentSel(), +b.dataset.p);
  if (next.mode === 'month') R.key = next.key; else R.year = next.year;
  renderStats();
});
$('periodLabel').onclick = () => {
  if (R.mode === 'year') return;
  let year = +R.key.split('-')[0];
  const draw = box => {
    box.innerHTML = `<div class="year-nav">
        <button class="icon-btn" data-y="-1">‹</button><b>${year}</b><button class="icon-btn" data-y="1">›</button>
      </div>
      <div class="month-grid">${Array.from({ length: 12 }, (_, i) => {
        const k = `${year}-${String(i + 1).padStart(2, '0')}`;
        return `<button data-k="${k}" class="${k === R.key ? 'is-on' : ''}">${i + 1} 月</button>`;
      }).join('')}</div>`;
    box.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { year += +b.dataset.y; draw(box); });
    box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      R.key = b.dataset.k; closeModal(); renderStats();
    });
  };
  openModal('', draw);
};
['rangeFrom', 'rangeTo'].forEach(id => $(id).addEventListener('change', () => {
  R.from = $('rangeFrom').value || R.from;
  R.to = $('rangeTo').value || R.to;
  renderStats();
}));

function renderStats() {
  const sel = currentSel();
  const rg = store.rangeOf(sel);
  $('rangeModeSeg').querySelectorAll('.seg-btn')
    .forEach(b => b.classList.toggle('is-on', b.dataset.mode === R.mode));
  $('periodNav').hidden = R.mode === 'custom';
  $('customRange').hidden = R.mode !== 'custom';
  $('periodLabel').textContent = store.selLabel(sel);
  if (R.mode === 'custom') {
    $('rangeFrom').value = rg.from;
    $('rangeTo').value = rg.to;
    $('rangeFrom').max = store.todayStr();
    $('rangeTo').max = store.todayStr();
  }

  const recs = store.recordsInRange(rg);
  const t = store.totals(recs);
  const days = store.daysBetween(rg.from, rg.to) + 1;

  // 1) 損益
  $('plDays').textContent = `${rangeText(rg)} · ${days} 天`;
  const net = $('plNet');
  net.textContent = `${t.net < 0 ? '-' : '+'}${S.settings.currency} ${store.fmtMoney(t.net)}`;
  net.className = 'pl-big ' + (t.net < 0 ? 'down' : 'up');
  $('plIn').textContent = store.fmtMoney(t.inc);
  $('plOut').textContent = store.fmtMoney(t.out);
  $('plRate').textContent = t.inc > 0 ? Math.round(t.net / t.inc * 100) + '%' : '—';

  // 2) 支出類別佔比（不含收入）
  const exp = store.byCategory(recs, 'expense');
  $('pieTotal').textContent = t.out ? `${S.settings.currency} ${store.fmtMoney(t.out)}` : '';
  charts.donut($('donut'), exp.map(i => ({ value: i.amount, color: i.c.color })), { label: '支出' });
  $('pieLegend').innerHTML = exp.map(i => `<div class="legend-item">
      <i class="dot" style="background:${i.c.color}"></i>${esc(i.c.name)}
      <span class="lg-pct">${Math.round(i.amount / t.out * 100)}%</span></div>`).join('');

  // 3) 各類別金額（支出由大到小，收入排在最後）
  const all = store.byCategory(recs, null);
  const ordered = [...all.filter(i => i.c.type !== 'income'), ...all.filter(i => i.c.type === 'income')];
  $('rankList').innerHTML = rankList(ordered, t.out, t.inc);

  // 4) 與上一期比較
  renderCompare(sel, recs, t);
}

function renderCompare(sel, recs, t) {
  const pSel = store.prevSel(sel);
  const pRg = store.rangeOf(pSel);
  const pRecs = store.recordsInRange(pRg);
  const pT = store.totals(pRecs);
  $('cmpLabel').textContent = sel.mode === 'custom' ? rangeText(pRg) : store.selLabel(pSel);

  const pct = pT.out > 0 ? (t.out - pT.out) / pT.out * 100 : null;
  const arrow = t.out === pT.out ? '' : (t.out > pT.out ? '▲' : '▼');
  const cls = t.out === pT.out ? '' : (t.out > pT.out ? 'up' : 'down');

  if (!recs.length && !pRecs.length) {
    $('cmpBody').innerHTML = `<div class="empty">這兩個區間都沒有資料</div>`;
    return;
  }

  const now = new Map(store.byCategory(recs, 'expense').map(i => [i.cat, i.amount]));
  const prev = new Map(store.byCategory(pRecs, 'expense').map(i => [i.cat, i.amount]));
  const rows = [...new Set([...now.keys(), ...prev.keys()])]
    .map(id => ({ c: store.catById(id), now: now.get(id) || 0, prev: prev.get(id) || 0 }))
    .map(r => ({ ...r, diff: r.now - r.prev }))
    .filter(r => r.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 8);

  $('cmpBody').innerHTML = `
    <div class="cmp-head">
      <div><small>本期支出</small><b>${store.fmtMoney(t.out)}</b></div>
      <div><small>上期支出</small><b>${store.fmtMoney(pT.out)}</b></div>
      <div><small>增減</small><b class="${cls}">${pct === null ? '—' : `${arrow}${Math.abs(Math.round(pct))}%`}</b></div>
    </div>
    ${rows.length ? rows.map(r => `<div class="cmp-row">
      <span class="rank-ico" style="background:${fade(r.c.color, .18)}">${esc(r.c.icon)}</span>
      <span class="cmp-name">${esc(r.c.name)}</span>
      <span class="cmp-now">${store.fmtMoney(r.prev)} → ${store.fmtMoney(r.now)}</span>
      <span class="cmp-delta ${r.diff > 0 ? 'up' : 'down'}">${r.diff > 0 ? '+' : '-'}${store.fmtMoney(r.diff)}</span>
    </div>`).join('') : `<div class="empty">各類別支出與上期相同</div>`}`;
}

/* =========================================================
   設定：基本
   ========================================================= */
function applyTheme() {
  const t = S.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
function fillSettings() {
  $('setBudget').value = S.settings.budget || '';
  $('setCurrency').value = S.settings.currency;
  $('setStartDay').value = S.settings.startDay || 1;
  $('setTheme').value = S.settings.theme || 'auto';
  $('setGClientId').value = S.settings.gClientId || '';
  $('setAutoSync').checked = !!S.settings.autoSync;
}
$('setBudget').onchange = e => store.saveSettings({ budget: Math.max(0, +e.target.value || 0) });
$('setCurrency').onchange = e => store.saveSettings({ currency: e.target.value.trim() || 'NT$' });
$('setStartDay').onchange = e => {
  const v = Math.min(28, Math.max(1, +e.target.value || 1));
  e.target.value = v;
  store.saveSettings({ startDay: v });
  UI.month = store.currentMonthKey();
  R.key = store.currentMonthKey();
};
$('setTheme').onchange = e => store.saveSettings({ theme: e.target.value });
$('setGClientId').onchange = e => store.saveSettings({ gClientId: e.target.value.trim() });
$('setAutoSync').onchange = e => store.saveSettings({ autoSync: e.target.checked });

/* =========================================================
   設定：類別管理
   ========================================================= */
const EMOJIS = ['🍜', '🍱', '☕', '🍺', '🛒', '🛍️', '👕', '🚌', '🚗', '⛽', '🚕', '✈️', '🏠', '💡', '📱', '💻',
  '💊', '🏥', '💇', '💅', '🎮', '🎬', '🎵', '📚', '✏️', '🐾', '🎁', '🧾', '💳', '🏦', '💰', '🏆',
  '📈', '💼', '🧰', '🧼', '🍎', '🏋️', '⚽', '🎨', '🧳', '🎂', '👶', '🚿', '🔧', '📦', '✨', '❓'];
const COLORS = ['#FF8A65', '#FFB74D', '#FFD54F', '#AED581', '#81C784', '#4DB6AC', '#4DD0E1', '#64B5F6',
  '#7986CB', '#9575CD', '#BA68C8', '#F06292', '#E57373', '#A1887F', '#90A4AE', '#8D9BA8'];

function renderCatManage() {
  $('catManage').innerHTML = S.cats.map((c, i) => `<div class="cat-line">
      <span class="ci" style="background:${fade(c.color, .18)}">${esc(c.icon)}</span>
      <span class="nm">${esc(c.name)}${c.type === 'income' ? ' <span class="muted small">收入</span>' : ''}</span>
      <button class="mv" data-mv="up" data-id="${esc(c.id)}" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>▲</button>
      <button class="mv" data-mv="down" data-id="${esc(c.id)}" ${i === S.cats.length - 1 ? 'disabled style="opacity:.25"' : ''}>▼</button>
      <button class="text-btn" data-edit="${esc(c.id)}">編輯</button>
    </div>`).join('') || `<div class="empty">還沒有類別</div>`;
}
$('catManage').addEventListener('click', async e => {
  const mv = e.target.closest('[data-mv]');
  if (mv) {
    const a = S.cats.findIndex(c => c.id === mv.dataset.id);
    const b = a + (mv.dataset.mv === 'up' ? -1 : 1);
    if (b < 0 || b >= S.cats.length) return;
    [S.cats[a], S.cats[b]] = [S.cats[b], S.cats[a]];
    await store.saveCats();
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) catEditor(S.cats.find(c => c.id === ed.dataset.edit));
});
$('btnAddCat').onclick = () => catEditor(null);

/** 類別編輯器。設定頁與記帳面板共用；onSaved 讓呼叫端接手剛存好的類別 */
function catEditor(cat, onSaved) {
  const isNew = !cat;
  const draft = cat
    ? { ...cat }
    : { id: 'c' + Date.now().toString(36), name: '', icon: '📦', color: COLORS[0], type: 'expense' };
  openModal(`<h3>${isNew ? '新增類別' : '編輯類別'}</h3>
    <label class="row"><span>名稱</span><input type="text" id="ceName" maxlength="8" value="${esc(draft.name)}"></label>
    <label class="row"><span>算成收入</span><input type="checkbox" id="ceIncome" ${draft.type === 'income' ? 'checked' : ''}></label>
    <div class="muted small" style="margin-top:10px">圖示</div>
    <div class="emoji-pick" id="ceEmoji">${EMOJIS.map(x =>
      `<button data-e="${x}" class="${x === draft.icon ? 'is-on' : ''}">${x}</button>`).join('')}</div>
    <div class="muted small">顏色</div>
    <div class="color-pick" id="ceColor">${COLORS.map(x =>
      `<button data-c="${x}" style="background:${x}" class="${x === draft.color ? 'is-on' : ''}"></button>`).join('')}</div>
    <div class="btn-row" style="justify-content:space-between">
      ${isNew ? '<span></span>' : '<button class="btn btn-danger" id="ceDel">刪除</button>'}
      <span><button class="btn btn-ghost" id="ceCancel">取消</button>
      <button class="btn btn-primary" id="ceOk">儲存</button></span>
    </div>`, box => {
    box.querySelector('#ceEmoji').onclick = ev => {
      const b = ev.target.closest('[data-e]'); if (!b) return;
      draft.icon = b.dataset.e;
      box.querySelectorAll('#ceEmoji button').forEach(x => x.classList.toggle('is-on', x === b));
    };
    box.querySelector('#ceColor').onclick = ev => {
      const b = ev.target.closest('[data-c]'); if (!b) return;
      draft.color = b.dataset.c;
      box.querySelectorAll('#ceColor button').forEach(x => x.classList.toggle('is-on', x === b));
    };
    box.querySelector('#ceCancel').onclick = closeModal;
    box.querySelector('#ceOk').onclick = async () => {
      draft.name = box.querySelector('#ceName').value.trim();
      draft.type = box.querySelector('#ceIncome').checked ? 'income' : 'expense';
      if (!draft.name) return toast('請輸入名稱');
      if (isNew) S.cats.push(draft);
      else {
        Object.assign(S.cats.find(c => c.id === draft.id), draft);
        // 類別改了收支別，既有紀錄要跟著改
        const restamp = S.records.filter(r => r.cat === draft.id && r.type !== draft.type);
        for (const r of restamp) await store.updateRecord(r.id, { cat: draft.id });
      }
      await store.saveCats();
      closeModal();
      if (isNew) toast(`已新增「${draft.name}」`);
      onSaved?.(S.cats.find(c => c.id === draft.id));
    };
    box.querySelector('#ceDel')?.addEventListener('click', async () => {
      const used = store.liveRecords().filter(r => r.cat === draft.id).length;
      closeModal();
      if (!(await confirmBox('刪除類別？',
        used ? `有 ${used} 筆紀錄使用這個類別，刪除後它們會顯示為「未分類」。` : '這個類別目前沒有被使用。', '刪除'))) return;
      S.cats = S.cats.filter(c => c.id !== draft.id);
      await store.saveCats();
      toast('已刪除類別');
      onSaved?.(null);
    });
  });
}

/* =========================================================
   同步
   ========================================================= */
const fmtTime = ts => ts ? new Date(ts).toLocaleString('zh-TW', { hour12: false }).replace(/:\d\d$/, '') : '—';

/** 主畫面的同步卡：權杖一小時就過期，所以放在最容易按的位置 */
async function renderHomeSync() {
  const card = $('homeSyncCard');
  const info = await sync.lastSyncInfo();
  const last = Math.max(info.g?.at || 0, info.folder?.at || 0);
  card.classList.remove('is-ok', 'is-warn');

  if (!S.settings.gClientId) {
    $('homeSyncIco').textContent = '☁️';
    $('homeSyncTitle').textContent = '雲端同步';
    $('homeSyncSub').textContent = last ? `尚未設定 Google 雲端硬碟 · 上次備份 ${fmtTime(last)}` : '尚未設定 Google 雲端硬碟';
    $('homeSyncAction').textContent = '設定';
    card.dataset.act = 'settings';
  } else if (sync.gIsConnected()) {
    card.classList.add('is-ok');
    $('homeSyncIco').textContent = '✅';
    $('homeSyncTitle').textContent = '已連結 Google 雲端硬碟';
    $('homeSyncSub').textContent = info.g?.at ? `上次同步 ${fmtTime(info.g.at)}` : '尚未同步過';
    $('homeSyncAction').textContent = '立即同步';
    card.dataset.act = 'sync';
  } else {
    card.classList.add('is-warn');
    $('homeSyncIco').textContent = '🔑';
    $('homeSyncTitle').textContent = '需要重新連結';
    $('homeSyncSub').textContent = '授權一小時後過期'
      + (info.g?.at ? ` · 上次同步 ${fmtTime(info.g.at)}` : '');
    $('homeSyncAction').textContent = '連結帳號';
    card.dataset.act = 'connect';
  }
}
$('homeSyncCard').onclick = async () => {
  const act = $('homeSyncCard').dataset.act;
  if (act === 'settings') return go('settings');
  await doGoogleSync(act === 'connect');
};

/** 連結（必要時）並同步 */
async function doGoogleSync(needConnect) {
  try {
    if (needConnect) await sync.gToken(true);
    toast('同步中…', 8000);
    const r = await sync.gSync(true);
    toast(`同步完成 · 新增 ${r.added}、更新 ${r.updated}`, 2600);
    render();
  } catch (e) { toast(gErr(e), 4000); }
  renderHomeSync();
  if (UI.view === 'settings') renderSyncInfo();
}

async function renderSyncInfo() {
  const info = await sync.lastSyncInfo();
  const g = info.g, f = info.folder;
  $('gInfo').innerHTML = S.settings.gClientId
    ? `${sync.gIsConnected() ? '<span class="ok">● 已連結</span>' : '○ 尚未連結（按「連結帳號」）'} · 上次同步：${fmtTime(g?.at)}`
    : '尚未設定 Client ID';

  const handle = await sync.getFolder();
  $('folderInfo').innerHTML = !sync.folderSupported()
    ? '此瀏覽器不支援（Android 請改用 Google 雲端硬碟）'
    : handle ? `<span class="ok">● ${esc(handle.name)}</span> · 上次寫入：${fmtTime(f?.at)}`
      : '尚未選擇資料夾';

  const last = Math.max(g?.at || 0, f?.at || 0);
  $('syncStatus').textContent = last ? '上次同步 ' + fmtTime(last) : '未設定';
}

$('btnGConnect').onclick = async () => {
  try {
    await sync.gToken(true);
    toast('已連結 Google 帳號');
  } catch (e) { toast(gErr(e), 3500); }
  renderSyncInfo(); renderHomeSync();
};
$('btnGSync').onclick = () => doGoogleSync(false);
$('btnGDisconnect').onclick = async () => {
  await sync.gDisconnect();
  toast('已解除連結');
  renderSyncInfo(); renderHomeSync();
};
function gErr(e) {
  const m = e?.message || String(e);
  if (m === 'NEED_AUTH') return '請先按「連結帳號」';
  if (/idpiframe|origin|redirect_uri/i.test(m)) return '授權失敗：請確認 Client ID 的「已授權的 JavaScript 來源」包含目前網址';
  return '同步失敗：' + m.slice(0, 90);
}

$('btnPickFolder').onclick = async () => {
  try { const h = await sync.pickFolder(); toast('已選擇 ' + h.name); await sync.folderSync(true); }
  catch (e) { if (e.name !== 'AbortError') toast(e.message, 3500); }
  renderSyncInfo(); renderHomeSync();
};
$('btnFolderSync').onclick = async () => {
  try { const r = await sync.folderSync(true); toast(`已同步 · 新增 ${r.added}、更新 ${r.updated}`); render(); }
  catch (e) { toast(e.message, 3500); }
  renderSyncInfo(); renderHomeSync();
};
$('btnFolderForget').onclick = async () => { await sync.forgetFolder(); toast('已解除'); renderSyncInfo(); };

$('btnExport').onclick = () => { sync.exportJson(); toast('已匯出 JSON'); };
$('btnExportCsv').onclick = () => { sync.exportCsv(); toast('已匯出 CSV'); };
$('btnImport').onclick = () => $('fileInput').click();
$('fileInput').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const r = await sync.importFile(f);
    toast(`匯入完成 · 新增 ${r.added}、更新 ${r.updated}`, 2600);
    render();
  } catch (err) { toast('匯入失敗：' + err.message, 3500); }
};

$('btnWipe').onclick = async () => {
  if (!(await confirmBox('清除所有資料？', '此裝置上的紀錄、類別與設定都會刪除，且無法復原。建議先匯出備份。', '全部清除'))) return;
  await store.wipe();
  UI.month = store.currentMonthKey();
  R.key = store.currentMonthKey();
  toast('已清除');
};

function renderDataInfo() {
  const live = store.liveRecords();
  const dates = live.map(r => r.date).sort();
  $('dataInfo').innerHTML = `共 ${live.length} 筆紀錄`
    + (dates.length ? ` · 從 ${dates[0]} 到 ${dates[dates.length - 1]}` : '')
    + ` · 類別 ${S.cats.length} 個`
    + (S.records.length - live.length ? `（另有 ${S.records.length - live.length} 筆刪除標記保留給同步）` : '');
}

/* =========================================================
   自動同步
   ========================================================= */
let autoTimer = 0;
function scheduleAutoSync() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    try { await sync.folderSaveQuiet(); } catch {}
    if (S.settings.autoSync && S.settings.gClientId) {
      try { await sync.gSync(false); } catch { /* 需要重新授權時安靜略過 */ }
    }
    renderHomeSync();
  }, 4000);
}

/* =========================================================
   主渲染
   ========================================================= */
function render() {
  if (!S.ready) return;
  applyTheme();
  if (UI.view === 'home') { renderHome(); renderHomeSync(); }
  else if (UI.view === 'list') renderList();
  else if (UI.view === 'stats') renderStats();
  else if (UI.view === 'settings') { fillSettings(); renderCatManage(); renderDataInfo(); renderSyncInfo(); }
}

store.on(what => {
  render();
  if (what === 'records' || what === 'cats' || what === 'settings') scheduleAutoSync();
});

/* =========================================================
   安裝 / Service Worker / 啟動
   ========================================================= */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('btnInstall').hidden = false;
});
$('btnInstall').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('btnInstall').hidden = true;
};

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 從背景回到前景時，若跨日則更新「今日」與同步狀態
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});

(async function init() {
  await store.load();
  UI.month = store.currentMonthKey();
  R.key = store.currentMonthKey();
  applyTheme();
  go('home');
  // 主畫面捷徑「記一筆」
  if (new URLSearchParams(location.search).has('add')) {
    history.replaceState(null, '', location.pathname);
    openEntry(null);
  }
  // 啟動時嘗試靜默取得雲端最新資料
  if (S.settings.autoSync && S.settings.gClientId) {
    try { await sync.gSync(false); render(); } catch {}
  }
})();
