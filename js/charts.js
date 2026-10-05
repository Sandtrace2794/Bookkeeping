// 純 SVG 圖表（無外部套件）
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nice = n => n >= 10000 ? (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + '萬'
  : n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : String(Math.round(n));

/** 環圈圖 */
export function donut(el, items, opts = {}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) { el.innerHTML = `<div class="empty">這段期間沒有資料</div>`; return; }
  const size = 190, r = 66, sw = 30, cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  const arcs = items.map(it => {
    const frac = it.value / total;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}"
      stroke-width="${sw}" stroke-dasharray="${(C * frac - 2).toFixed(2)} ${(C - C * frac + 2).toFixed(2)}"
      stroke-dashoffset="${(-C * acc).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
    acc += frac;
    return seg;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(128,128,128,.12)" stroke-width="${sw}"/>
    ${arcs}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="12" fill="currentColor" opacity=".6">${esc(opts.label || '合計')}</text>
    <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="19" font-weight="700" fill="currentColor">${nice(total)}</text>
  </svg>`;
}
