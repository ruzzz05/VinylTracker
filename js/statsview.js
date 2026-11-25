// Pantallas de Artistas, Canciones y Estadísticas. Recibe los datos ya cargados (no toca el estado de la app).
import { h } from './dom.js';
import * as S from './stats.js';
import { columnChart, hbars, segBar, dataTable } from './charts.js';
import { artistAvatar } from './artists.js';

const PERIOD = { 1: 'este mes', 6: 'los últimos 6 meses', 12: 'el último año', 0: 'todo el historial' };
const PERIOD_SHORT = { 1: 'este mes', 6: 'los últimos 6 meses', 12: 'el último año', 0: 'todo el historial' };

const avatar = text => h('div', { class: 'cover ph' }, (text || '?').trim().charAt(0).toUpperCase());
const card = (title, ...kids) => h('section', { class: 'card st' }, title ? h('h3', null, title) : null, ...kids);
const note = text => h('p', { class: 'muted' }, text);

function delta(d, label = 'vs periodo anterior') {
  if (d == null) return null;
  return h('span', { class: 'delta' }, `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} % ${label}`);
}

function tile(label, value, sub, d) {
  return h('div', { class: 'tile2' }, h('span', { class: 'tl' }, label), h('b', null, value), h('span', { class: 'ts' }, sub), d != null ? delta(d, 'vs antes') : null);
}

// ---------------------------------------------------------------- Artistas
export function artistsView({ stats, apiAlbums, months, now = new Date(), onImport }) {
  if (stats) {
    const list = S.topArtists(stats, months, now, 50);
    if (!list.length) return h('div', { class: 'empty' }, 'No hay reproducciones en este periodo.');
    return h('ul', { class: 'list' }, list.map((a, i) => h('li', null, h('div', { class: 'row static' },
      h('div', { class: 'n' }, i + 1), artistAvatar(a.name),
      h('div', { class: 't' }, h('b', null, a.name), h('span', null, `${S.fmtNum(a.plays)} reprod. · ${S.fmtPct(a.share)}`)),
      h('div', { class: 'm' }, h('b', null, S.fmtDur(a.ms)))))));
  }
  // Solo con la API: se suman los puntos de sus álbumes (aproximado)
  const byArtist = {};
  for (const a of Object.values(apiAlbums || {})) { const o = byArtist[a.artist] || (byArtist[a.artist] = { name: a.artist, points: 0, albums: 0 }); o.points += a.points || 0; o.albums++; }
  const list = Object.values(byArtist).filter(a => a.points > 0).sort((x, y) => y.points - x.points).slice(0, 50);
  if (!list.length) return needImport(onImport);
  return h('div', null, note('Aproximado, con tus tops de Spotify. Importa tu historial para tiempos reales.'),
    h('ul', { class: 'list' }, list.map((a, i) => h('li', null, h('div', { class: 'row static' },
      h('div', { class: 'n' }, i + 1), artistAvatar(a.name),
      h('div', { class: 't' }, h('b', null, a.name), h('span', null, `${a.albums} álbum${a.albums === 1 ? '' : 'es'} en tus tops`)),
      h('div', { class: 'm' }, h('b', null, a.points + ' pts')))))));
}

// ---------------------------------------------------------------- Canciones
export function tracksView({ stats, months, now = new Date(), onImport, cover }) {
  if (!stats) return needImport(onImport);
  const list = S.topTracks(stats, months, now, 50);
  if (!list.length) return h('div', { class: 'empty' }, 'No hay reproducciones en este periodo.');
  return h('ul', { class: 'list' }, list.map((t, i) => h('li', null, h('div', { class: 'row static' },
    h('div', { class: 'n' }, i + 1), cover ? cover(t) : avatar(t.name),
    h('div', { class: 't' }, h('b', null, t.name), h('span', null, t.album ? `${t.artist} · ${t.album}` : t.artist)),
    h('div', { class: 'm' }, h('b', null, S.fmtDur(t.ms)), `${S.fmtNum(t.plays)} reprod.`)))));
}

function needImport(onImport) {
  return h('div', { class: 'empty' },
    h('p', null, 'Esto necesita tu historial de Spotify.'),
    h('p', { class: 'muted' }, 'Importa el export de Spotify en Ajustes (sirve el paquete básico "Datos de la cuenta", que llega antes, o el ampliado). Si ya lo habías importado antes de esta versión, vuelve a importarlo para calcular estas estadísticas.'),
    h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: onImport }, 'Ir a Ajustes')));
}

// ------------------------------------------------------------- Estadísticas (una sola página, lo esencial)
// Periodo → tiempo escuchado, una gráfica y tus tops (artistas, canciones, álbumes). Cada top lleva a su lista completa en Ranking.
const PERIODS = [[1, '1 mes'], [6, '6 meses'], [12, '1 año'], [0, 'Todo']];

export function statsPage({ stats, history, collection, ranking, months, onPeriod, onSeeAll, onImport, avatarFor, coverFor, albumCoverFor, now = new Date() }) {
  if (!stats) return statsLite({ collection, ranking, onImport });
  const root = h('div', { class: 'stats' });
  const win = S.windowTotals(stats, months, now);

  root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Periodo' }, PERIODS.map(([m, label]) =>
    h('button', { 'aria-pressed': String(months === m), onclick: () => onPeriod(m) }, label))));

  // 1) La cifra: tiempo escuchado en el periodo
  root.append(h('section', { class: 'card st hero' },
    h('span', { class: 'muted' }, `Has escuchado, en ${PERIOD[months]}`),
    h('div', { class: 'big' }, S.fmtDur(win.ms)),
    h('p', { class: 'muted' }, `${S.fmtNum(win.ms / 60000)} minutos · ${S.fmtNum(win.ms / 3600000)} horas`),
    delta(win.delta)));

  // 2) Cuatro números
  const artists = S.topArtists(stats, months, now, 100000).length;
  const tiles = [tile('Reproducciones', S.fmtNum(win.plays), 'canciones'), tile('Al día', S.fmtDur(win.perDay), 'de media'), tile('Artistas', S.fmtNum(artists), 'distintos')];
  if (collection.length && Object.keys(history || {}).length) {
    const v = S.vinylStats({ history, collection, stats, months, now });
    tiles.push(tile('En vinilo', S.fmtPct(v.share), 'de lo que escuchas'));
  }
  root.append(h('div', { class: 'tiles' }, tiles));

  // 3) Una gráfica: por día si el periodo es corto; por mes en el resto
  if (months === 1) {
    const d = S.daySeries(stats, 30, now);
    root.append(card('Minutos por día', note('Últimos 30 días. Toca una barra para ver su valor.'),
      columnChart({ data: d.map(x => ({ label: String(+x.key.slice(8)), title: S.fmtDay(x.key), value: x.ms })), fmt: S.fmtDur, axis: S.fmtAxis, highlight: 29, labelEvery: 5, height: 110 }),
      dataTable(['Día', 'Tiempo'], d.map(x => [S.fmtDay(x.key), S.fmtDur(x.ms)]))));
  } else {
    const n = months === 6 ? 6 : 12, m = S.monthSeries(stats, n, now);
    root.append(card('Minutos por mes', note(`Últimos ${n} meses. Toca una barra para ver su valor.`),
      columnChart({ data: m.map(x => ({ label: S.monthInitial(x.key), title: S.fmtMonth(x.key), value: x.ms })), fmt: S.fmtDur, axis: S.fmtAxis, highlight: n - 1 }),
      dataTable(['Mes', 'Tiempo'], m.map(x => [S.fmtMonth(x.key), S.fmtDur(x.ms)]))));
  }

  // 4) Tops del periodo (5 de cada; «Ver todo» abre la lista completa)
  const top = (title, view, rows) => rows.length ? h('section', { class: 'card st' },
    h('div', { class: 'cardhead' }, h('h3', null, title), h('button', { class: 'linkbtn', type: 'button', onclick: () => onSeeAll(view) }, 'Ver todo ›')),
    h('ul', { class: 'list' }, rows)) : null;
  const add = x => { if (x) root.append(x); };            // append(null) escribiría la palabra «null»
  const row = (i, media, name, sub, metric, metricSub) => h('li', null, h('div', { class: 'row static' }, h('div', { class: 'n' }, i + 1), media,
    h('div', { class: 't' }, h('b', null, name), sub ? h('span', null, sub) : null), h('div', { class: 'm' }, h('b', null, metric), metricSub || '')));

  add(top('Artistas', 'artists', S.topArtists(stats, months, now, 5).map((a, i) =>
    row(i, avatarFor(a.name), a.name, `${S.fmtNum(a.plays)} reprod.`, S.fmtDur(a.ms), S.fmtPct(a.share)))));
  add(top('Canciones', 'tracks', S.topTracks(stats, months, now, 5).map((t, i) =>
    row(i, coverFor({ artist: t.artist, name: t.name, album: t.album }), t.name, t.artist, S.fmtDur(t.ms), `${S.fmtNum(t.plays)} reprod.`))));
  add(top('Álbumes', 'albums', (ranking || []).filter(r => r.minutes > 0).slice(0, 5).map((r, i) =>
    row(i, albumCoverFor(r), r.name, r.artist, S.fmtDur(r.minutes * 60000), `${S.fmtNum(r.plays)} reprod.`))));
  return root;
}

function collectionCard(collection) {
  if (!collection.length) return h('span');
  const styles = S.collectionStyles(collection, 8);
  const artists = new Set(collection.map(a => a.artist)).size;
  return card('Tu colección',
    h('p', null, `${collection.length} vinilos de ${artists} artistas.`),
    styles.length ? [h('p', { class: 'muted' }, 'Estilos más frecuentes'), hbars(styles.map(s => ({ label: s.tag, sub: s.tag, value: s.count, text: String(s.count) })))] : null);
}

// Sin historial: lo que se puede contar solo con la API y tu colección
function statsLite({ collection, ranking, onImport }) {
  const root = h('div', { class: 'stats' });
  root.append(card('Estadísticas de escucha',
    h('p', null, 'Para ver minutos por día, mes y año, tus horas punta, rachas y récords necesito tu historial de Spotify.'),
    h('p', { class: 'muted' }, 'Pídelo en spotify.com/account/privacy: "Datos de la cuenta" llega antes (último año) y "Historial de reproducciones ampliado" trae todo y los álbumes. Impórtalo en Ajustes; se procesa en tu móvil.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: onImport }, 'Ir a Ajustes'))));
  const top = (ranking || []).slice(0, 40);
  if (top.length) {
    const owned = top.filter(r => r.owned).length;
    root.append(card('Tus tops y tu vinilo', h('div', { class: 'big sm' }, `${owned} de ${top.length}`),
      note('de tus álbumes más escuchados (según la API de Spotify) ya los tienes en vinilo.'),
      segBar([{ label: 'En vinilo', value: owned, cls: 'a' }, { label: 'Te faltan', value: top.length - owned, cls: 'b' }])));
  }
  root.append(collectionCard(collection));
  return root;
}
