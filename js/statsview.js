// Pantallas de Artistas, Canciones y Estadísticas. Recibe los datos ya cargados (no toca el estado de la app).
import { h } from './dom.js';
import * as S from './stats.js';
import { columnChart, hbars, heatmap, segBar, dataTable } from './charts.js';

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
      h('div', { class: 'n' }, i + 1), avatar(a.name),
      h('div', { class: 't' }, h('b', null, a.name), h('span', null, `${S.fmtNum(a.plays)} reprod. · ${S.fmtPct(a.share)} del tiempo`)),
      h('div', { class: 'm' }, h('b', null, S.fmtDur(a.ms)))))));
  }
  // Solo con la API: se suman los puntos de sus álbumes (aproximado)
  const byArtist = {};
  for (const a of Object.values(apiAlbums || {})) { const o = byArtist[a.artist] || (byArtist[a.artist] = { name: a.artist, points: 0, albums: 0 }); o.points += a.points || 0; o.albums++; }
  const list = Object.values(byArtist).filter(a => a.points > 0).sort((x, y) => y.points - x.points).slice(0, 50);
  if (!list.length) return needImport(onImport);
  return h('div', null, note('Aproximado, con tus tops de Spotify. Importa tu historial para tiempos reales.'),
    h('ul', { class: 'list' }, list.map((a, i) => h('li', null, h('div', { class: 'row static' },
      h('div', { class: 'n' }, i + 1), avatar(a.name),
      h('div', { class: 't' }, h('b', null, a.name), h('span', null, `${a.albums} álbum${a.albums === 1 ? '' : 'es'} en tus tops`)),
      h('div', { class: 'm' }, h('b', null, a.points + ' pts')))))));
}

// ---------------------------------------------------------------- Canciones
export function tracksView({ stats, months, now = new Date(), onImport }) {
  if (!stats) return needImport(onImport);
  const list = S.topTracks(stats, months, now, 50);
  if (!list.length) return h('div', { class: 'empty' }, 'No hay reproducciones en este periodo.');
  return h('ul', { class: 'list' }, list.map((t, i) => h('li', null, h('div', { class: 'row static' },
    h('div', { class: 'n' }, i + 1), avatar(t.name),
    h('div', { class: 't' }, h('b', null, t.name), h('span', null, t.album ? `${t.artist} · ${t.album}` : t.artist)),
    h('div', { class: 'm' }, h('b', null, S.fmtDur(t.ms)), `${S.fmtNum(t.plays)} reprod.`)))));
}

function needImport(onImport) {
  return h('div', { class: 'empty' },
    h('p', null, 'Esto necesita tu historial de Spotify.'),
    h('p', { class: 'muted' }, 'Importa el export de Spotify en Ajustes (sirve el paquete básico "Datos de la cuenta", que llega antes, o el ampliado). Si ya lo habías importado antes de esta versión, vuelve a importarlo para calcular estas estadísticas.'),
    h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: onImport }, 'Ir a Ajustes')));
}

// ------------------------------------------------------------- Estadísticas
export function statsView({ stats, history, collection, ranking, months, now = new Date(), onImport }) {
  const root = h('div', { class: 'stats' });
  if (!stats) return statsLite({ collection, ranking, onImport });

  const win = S.windowTotals(stats, months, now);
  const per = S.periodTotals(stats, now);

  // 1) Cifra principal: el tiempo del periodo elegido
  root.append(h('section', { class: 'card st hero' },
    h('span', { class: 'muted' }, `Has escuchado, en ${PERIOD[months]}`),
    h('div', { class: 'big' }, S.fmtDur(win.ms)),
    h('p', { class: 'muted' }, `${S.fmtNum(win.ms / 60000)} minutos · ${S.fmtDur(win.perDay)} al día de media · ${S.fmtNum(win.plays)} reproducciones`),
    delta(win.delta)));

  // 2) Hoy / 7 días / 30 días / este año
  root.append(h('div', { class: 'tiles' }, ['today', 'd7', 'd30', 'year'].map(k => {
    const p = per[k];
    return tile(p.label, S.fmtDur(p.ms), k === 'today' ? 'hoy' : `${S.fmtDur(p.perDay)} al día`, p.prevMs > 0 ? p.delta : null);
  })));

  // 3) Por mes (12 últimos meses) y por día (30 últimos)
  const months12 = S.monthSeries(stats, 12, now);
  root.append(card('Minutos por mes', note('Últimos 12 meses. Toca una barra para ver su valor.'),
    columnChart({ data: months12.map(m => ({ label: S.monthInitial(m.key), title: S.fmtMonth(m.key), value: m.ms })), fmt: S.fmtDur, axis: S.fmtAxis, highlight: 11 }),
    dataTable(['Mes', 'Tiempo'], months12.map(m => [S.fmtMonth(m.key), S.fmtDur(m.ms)]))));
  const days30 = S.daySeries(stats, 30, now);
  root.append(card('Minutos por día', note('Últimos 30 días.'),
    columnChart({ data: days30.map(d => ({ label: String(+d.key.slice(8)), title: S.fmtDay(d.key), value: d.ms })), fmt: S.fmtDur, axis: S.fmtAxis, highlight: 29, labelEvery: 5, height: 110 }),
    dataTable(['Día', 'Tiempo'], days30.map(d => [S.fmtDay(d.key), S.fmtDur(d.ms)]))));
  const years = S.yearTotals(stats);
  if (years.length > 1) root.append(card('Por año', hbars(years.map(y => ({ label: y.year, sub: `Año ${y.year}`, value: y.ms, text: S.fmtDur(y.ms) })))));

  // 4) Cuándo escuchas
  const p = S.persona(stats);
  const wk = p.weekendRatio;
  root.append(card('Cuándo escuchas',
    h('div', { class: 'chips' }, h('span', { class: 'chip on' }, p.label)),
    h('p', null, p.text),
    heatmap(stats.heat, S.fmtDur),
    h('p', { class: 'muted' }, `Tu día fuerte es el ${p.favDay} y tu hora punta, las ${String(p.peakHour).padStart(2, '0')}:00.` +
      (wk > 1.25 ? ` Escuchas un ${Math.round((wk - 1) * 100)} % más en fin de semana.` : wk < 0.8 ? ` Escuchas un ${Math.round((1 / wk - 1) * 100)} % más entre semana.` : ''))));

  // 5) Lo más escuchado del periodo
  const ta = S.topArtists(stats, months, now, 1)[0], tt = S.topTracks(stats, months, now, 1)[0], tal = (ranking || [])[0];
  if (ta || tt || tal) root.append(card(`Lo más escuchado en ${PERIOD_SHORT[months]}`,
    ta ? stat('Artista', ta.name, `${S.fmtDur(ta.ms)} · ${S.fmtPct(ta.share)} de tu tiempo`) : null,
    tt ? stat('Canción', tt.name, `${tt.artist} · ${S.fmtNum(tt.plays)} reproducciones`) : null,
    tal && tal.minutes ? stat('Álbum', tal.name, `${tal.artist} · ${S.fmtDur(tal.minutes * 60000)}`) : null));

  // 6) Récords y rachas
  const rec = S.records(stats), st = S.streaks(stats, now);
  const recs = [];
  if (rec.bestDay) recs.push(stat('Tu día de más música', S.fmtDay(rec.bestDay.day), S.fmtDur(rec.bestDay.ms)));
  if (st.longest.days > 1) recs.push(stat('Racha más larga', `${st.longest.days} días seguidos`, `${S.fmtDay(st.longest.from)} → ${S.fmtDay(st.longest.to)}`));
  if (st.current > 1) recs.push(stat('Racha actual', `${st.current} días seguidos`, 'sigue así'));
  if (rec.longestSession) recs.push(stat('Sesión más larga', S.fmtDur(rec.longestSession.ms), `${rec.longestSession.plays} canciones · ${S.fmtDay(S.dayKey(new Date(rec.longestSession.start)))}`));
  if (rec.repeat) recs.push(stat('Más repetida en un día', `${rec.repeat.count} veces`, `«${rec.repeat.name}» de ${rec.repeat.artist} · ${S.fmtDay(rec.repeat.day)}`));
  if (recs.length) root.append(card('Récords y rachas', ...recs));

  // 7) Descubrimientos
  const dis = S.discoveries(stats, months, now);
  if (dis && dis.count) root.append(card('Descubrimientos', h('div', { class: 'big sm' }, `${dis.count} artista${dis.count === 1 ? '' : 's'} nuevo${dis.count === 1 ? '' : 's'}`),
    note(`Artistas que no habías escuchado antes de ${PERIOD[months]}.`),
    hbars(dis.top.map(a => ({ label: a.name, sub: a.name, value: a.ms, text: S.fmtDur(a.ms) })))));

  // 8) Hábitos
  const hb = S.habits(stats, months, now);
  root.append(card('Cómo escuchas',
    h('div', { class: 'tiles' }, tile('Saltas', S.fmtPct(hb.skipRate), 'de las canciones'), tile('Aleatorio', S.fmtPct(hb.shuffleRate), 'de las canciones')),
    hb.platforms.length ? [h('p', { class: 'muted' }, 'Dónde escuchas (todo el historial)'),
      hbars(hb.platforms.slice(0, 4).map(x => ({ label: x.name, sub: x.name, value: x.ms, text: S.fmtPct(x.share) })))] : null));

  // 9) Tu vinilo y tu Spotify (lo que solo puede hacer VinylTracker)
  root.append(...vinylCards({ stats, history, collection, months, now }));

  // 10) Curiosidades de plato
  const f = S.funFacts(win.ms);
  if (win.ms > 0) root.append(card('Curiosidades de plato',
    h('p', null, `Equivale a ${S.fmtNum(f.lps)} vinilos de 45 minutos puestos uno detrás de otro.`),
    h('p', null, `Un plato a 33⅓ rpm habría dado ${S.fmtNum(f.revolutions)} vueltas.`),
    h('p', null, f.days >= 1 ? `Son ${f.days.toFixed(1).replace('.', ',')} días seguidos de música, sin dormir ni parar.` : `Son ${f.hours.toFixed(1).replace('.', ',')} horas seguidas de música.`)));

  root.append(collectionCard(collection));
  return root;
}

function stat(label, value, sub) {
  return h('div', { class: 'stat col' }, h('span', { class: 'muted' }, label), h('b', null, value), sub ? h('span', { class: 'muted' }, sub) : null);
}

function vinylCards({ stats, history, collection, months, now }) {
  if (!collection.length || !Object.keys(history || {}).length) return [];
  const v = S.vinylStats({ history, collection, stats, months, now });
  const out = [];
  out.push(card('Tu vinilo y tu Spotify',
    h('div', { class: 'big sm' }, S.fmtPct(v.share)),
    note(`de lo que escuchas en ${PERIOD_SHORT[months]} son discos que ya tienes en vinilo.`),
    segBar([{ label: 'En vinilo', value: v.ownedMinutes, cls: 'a' }, { label: 'Solo en streaming', value: Math.max(0, v.totalMinutes - v.ownedMinutes), cls: 'b' }]),
    v.topOwned.length ? [h('p', { class: 'muted' }, 'Lo que más pones de tu colección'),
      hbars(v.topOwned.map(a => ({ label: a.name, sub: `${a.name} · ${a.artist}`, value: a.minutes, text: S.fmtDur(a.minutes * 60000) })))] : null));
  if (v.forgotten.length) out.push(card(`Vinilos olvidados (${v.forgotten.length})`,
    note('No han sonado en Spotify en el último año. Quizá es hora de ponerlos en el plato.'),
    h('div', { class: 'chips' }, v.forgotten.slice(0, 12).map(a => h('span', { class: 'chip' }, `${a.name} · ${a.artist}`))),
    v.forgotten.length > 12 ? note(`…y ${v.forgotten.length - 12} más.`) : null));
  if (v.withoutVinyl.length) out.push(card('Escuchas mucho y no tienes en vinilo',
    hbars(v.withoutVinyl.map(a => ({ label: a.name, sub: a.name, value: a.ms, text: S.fmtDur(a.ms) })))));
  return out;
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
