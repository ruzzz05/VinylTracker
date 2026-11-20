// Pantalla «Conciertos»: próximas fechas de tus artistas más escuchados, por orden.
import { h, safeUrl } from './dom.js';
import * as K from './concerts.js';
import * as S from './stats.js';
import { prefs } from './storage.js';

const PERIODS = [[6, '6 meses'], [12, '1 año'], [0, 'Todo']];
const LIMIT = 50;
let loaded;                                   // { data, idx } | null (se pide una vez por sesión)

async function load() {
  if (loaded !== undefined) return loaded;
  try {
    const r = await fetch('data/concerts.json');
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    loaded = { data, idx: K.indexConcerts(data) };
  } catch (e) { loaded = null; }
  return loaded;
}
export const resetConcerts = () => { loaded = undefined; };

const dateBlock = d => {
  const t = new Date(d + 'T12:00:00');
  return h('div', { class: 'cdate' }, h('b', null, t.getDate()), h('span', null, t.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')),
    h('small', null, t.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')));
};

function eventRow(e) {
  const where = [e.venue, e.city].filter(Boolean).join(' · ');
  const body = [h('b', null, e.artist), h('span', null, e.title !== e.artist ? e.title : where), e.title !== e.artist && where ? h('span', null, where) : null,
    h('div', { class: 'chips tight' },
      e.time ? h('span', { class: 'chip' }, e.time) : null,
      e.country ? h('span', { class: 'chip' }, e.country) : null,
      e.status === 'postponed' ? h('span', { class: 'chip warn' }, 'Aplazado') : null,
      e.status === 'offsale' ? h('span', { class: 'chip warn' }, 'Entradas agotadas') : null,
      [...(e.also || []), ...(e.others || [])].slice(0, 3).map(n => h('span', { class: 'chip' }, '+ ' + n)))];
  const link = safeUrl(e.url);
  return h('li', null, link !== '#'
    ? h('a', { class: 'row crow', href: link, target: '_blank', rel: 'noopener' }, dateBlock(e.date), h('div', { class: 't' }, body), h('div', { class: 'm' }, h('b', null, 'Entradas'), '↗'))
    : h('div', { class: 'row crow static' }, dateBlock(e.date), h('div', { class: 't' }, body)));
}

export function concertsView({ state, onSettings }) {
  const root = h('div');
  const months = Number(prefs.get('concMonths', '12'));
  const rerender = () => root.replaceWith(concertsView({ state, onSettings }));

  root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Artistas de' }, PERIODS.map(([m, label]) =>
    h('button', { 'aria-pressed': String(months === m), onclick: () => { prefs.set('concMonths', String(m)); rerender(); } }, label))));
  const names = K.artistNames({ stats: state.effStats, apiAlbums: state.apiAlbums, months, limit: LIMIT, topArtists: S.topArtists });
  if (!names.length) {
    root.append(h('div', { class: 'empty' }, h('p', null, 'Necesito saber qué escuchas.'),
      h('p', { class: 'muted' }, 'Conecta Spotify o importa tu historial en Ajustes y aquí saldrán los próximos conciertos de tus artistas más escuchados.'),
      h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: onSettings }, 'Ir a Ajustes'))));
    return root;
  }
  const info = h('p', { class: 'muted', role: 'status' }, 'Cargando conciertos…'), list = h('div'), none = h('details', { class: 'dt' });
  root.append(info, list, none);

  load().then(L => {
    if (!L) {
      info.textContent = '';
      list.replaceChildren(h('div', { class: 'card' }, h('h3', null, 'Todavía no hay datos de conciertos'),
        h('p', { class: 'muted' }, 'Los conciertos los descarga cada día GitHub y se publican junto a la app. Aún no hay ningún fichero: falta guardar la clave de Ticketmaster como secreto del repositorio (TICKETMASTER_KEY) y esperar al siguiente despliegue.'),
        h('button', { class: 'btn sec', onclick: () => { resetConcerts(); rerender(); } }, 'Volver a mirar')));
      return;
    }
    const countries = L.data.countries || [];
    const sel = h('select', { 'aria-label': 'País' }, countries.map(c => h('option', { value: c }, K.COUNTRY_NAMES[c] || c)), h('option', { value: '' }, 'Todos los países'));
    const saved = prefs.get('conc.country', 'ES');
    sel.value = saved === '' || countries.includes(saved) ? saved : (countries[0] || '');
    root.insertBefore(h('div', { class: 'filters' }, sel), info);
    const per = names.map(n => ({ n, ev: K.eventsFor(L.idx, n) }));
    const all = K.mergeEvents(per.map(p => p.ev));
    const today = new Date().toISOString().slice(0, 10);
    const paint = () => {
      const cc = sel.value, evs = K.filterCountry(all, cc).filter(e => e.date >= today);
      const where = cc ? ' en ' + (K.COUNTRY_NAMES[cc] || cc) : '';
      info.textContent = evs.length ? `${evs.length} concierto${evs.length === 1 ? '' : 's'} de tus ${names.length} artistas más escuchados${where}.` : '';
      list.replaceChildren(...K.groupByMonth(evs).map(([k, items]) => h('section', null, h('h2', { class: 'month' }, K.monthLabel(k)), h('ul', { class: 'list' }, items.map(eventRow)))));
      if (!evs.length) list.append(h('div', { class: 'empty' }, h('p', null, `Ninguno de tus artistas tiene conciertos anunciados${where}.`),
        h('p', { class: 'muted' }, cc ? 'Prueba con «Todos los países»: a veces la gira pasa por Lisboa o París.' : 'Ticketmaster solo cubre sus propios eventos.')));
      const without = per.filter(p => !K.filterCountry(p.ev, cc).some(e => e.date >= today)).map(p => p.n);
      none.replaceChildren(...(without.length ? [h('summary', null, `Sin fechas anunciadas (${without.length})`), h('p', { class: 'muted' }, without.join(', '))] : []));
    };
    sel.addEventListener('change', () => { prefs.set('conc.country', sel.value); paint(); });
    paint();
    const gen = L.data.generated ? new Date(L.data.generated).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
    none.after(h('p', { class: 'muted' }, `Datos de Ticketmaster${gen ? ' del ' + gen : ''} (se actualizan cada día).`));
  });
  return root;
}
