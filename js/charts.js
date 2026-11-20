// Gráficos sencillos en HTML/CSS (responsive, accesibles). Marcas finas, esquinas de 4 px en el extremo del dato,
// separación de 2 px, cuadrícula recesiva, etiquetas solo donde importan y tooltip en cada marca.
import { h, bindTip } from './dom.js';
import { niceCeilMs } from './stats.js';

// Columnas sobre una base común. data: [{label, title, value}]; fmt(valor) -> texto; axis(valor) -> texto del eje
export function columnChart({ data, fmt, axis, highlight = -1, labelEvery = 1, height = 120 }) {
  const max = Math.max(0, ...data.map(d => d.value));
  const top = niceCeilMs(max || 60000);
  const maxIdx = max > 0 ? data.findIndex(d => d.value === max) : -1;
  const bars = data.map((d, i) => {
    const pct = d.value > 0 ? Math.max(2 / height * 100, d.value / top * 100) : 0;
    const col = h('div', { class: 'cc-col' },
      i === maxIdx ? h('span', { class: 'cc-val' + (i < 2 ? ' l' : i > data.length - 3 ? ' r' : ''), style: `bottom:calc(${pct}% + 3px)` }, fmt(d.value)) : null,
      h('span', { class: 'cc-bar' + (i === highlight ? ' hl' : ''), style: `height:${pct}%` }));
    return bindTip(col, d.title, fmt(d.value));
  });
  return h('div', { class: 'cc' },
    h('div', { class: 'cc-plot', style: `height:${height}px` },
      h('i', { class: 'cc-grid', style: 'top:0' }), h('i', { class: 'cc-grid', style: 'top:50%' }),
      h('span', { class: 'cc-y', style: 'top:0' }, axis(top)), h('span', { class: 'cc-y', style: 'top:50%' }, axis(top / 2)),
      h('div', { class: 'cc-bars' }, bars)),
    h('div', { class: 'cc-x' }, data.map((d, i) => h('span', null, i % labelEvery === 0 || i === data.length - 1 ? d.label : ''))));
}

// Barras horizontales ordenadas, de un solo tono. items: [{label, sub, value, text}]
export function hbars(items, { max } = {}) {
  const m = max || Math.max(1, ...items.map(i => i.value));
  return h('div', { class: 'hb' }, items.map(i => bindTip(
    h('div', { class: 'hb-row' },
      h('span', { class: 'hb-l' }, i.label), h('span', { class: 'hb-t' }, h('span', { class: 'hb-b', style: `width:${Math.max(2, i.value / m * 100)}%` })),
      h('span', { class: 'hb-v' }, i.text)), i.sub || i.label, i.text)));
}

// Mapa de calor día de la semana × hora (cells: 168 valores, lunes = 0)
export function heatmap(cells, fmt) {
  const max = Math.max(1, ...cells);
  const days = ['L', 'M', 'X', 'J', 'V', 'S', 'D'], names = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const level = v => (v <= 0 ? 0 : Math.min(4, Math.ceil(4 * Math.sqrt(v / max))));
  const grid = h('div', { class: 'hm-grid' });
  for (let d = 0; d < 7; d++) {
    grid.append(h('span', { class: 'hm-d' }, days[d]));
    for (let hr = 0; hr < 24; hr++) {
      const v = cells[d * 24 + hr];
      grid.append(bindTip(h('i', { class: 'hm-c lv' + level(v) }), `${names[d]} ${String(hr).padStart(2, '0')}:00`, fmt(v)));
    }
  }
  return h('div', { class: 'hm' },
    h('div', { class: 'hm-h' }, h('span'), [0, 6, 12, 18].map(x => h('span', { style: `grid-column:${x + 2}` }, String(x).padStart(2, '0')))),
    grid,
    h('div', { class: 'hm-key' }, 'menos', [0, 1, 2, 3, 4].map(l => h('i', { class: 'hm-c lv' + l })), 'más'));
}

// Barra fina de una proporción (dos partes). parts: [{label, value, cls}]
export function segBar(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return h('div', null,
    h('div', { class: 'seg2', role: 'img', 'aria-label': parts.map(p => `${p.label}: ${Math.round(p.value / total * 100)} %`).join('; ') },
      parts.filter(p => p.value > 0).map(p => h('i', { class: p.cls, style: `flex:${p.value}` }))),
    h('div', { class: 'seg2-key' }, parts.map(p => h('span', null, h('i', { class: 'sw ' + p.cls }), `${p.label} · ${Math.round(p.value / total * 100)} %`))));
}

// Gemelo accesible del gráfico: los mismos datos en una tabla
export function dataTable(headers, rows) {
  return h('details', { class: 'dt' }, h('summary', null, 'Ver como tabla'),
    h('table', null, h('thead', null, h('tr', null, headers.map(x => h('th', null, x)))),
      h('tbody', null, rows.map(r => h('tr', null, r.map(c => h('td', null, c)))))));
}
