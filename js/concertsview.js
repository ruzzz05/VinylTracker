// Pantalla «Conciertos»: próximas fechas de tus artistas más escuchados, por orden.
import { h, safeUrl } from './dom.js';
import * as K from './concerts.js';
import * as S from './stats.js';
import { prefs } from './storage.js';

const PERIODS = [[6, '6 meses'], [12, '1 año'], [0, 'Todo']];
const LIMIT = 30;
let runId = 0;
export const cancelConcerts = () => { runId++; };
const results = new Map();            // artista -> eventos (se conserva mientras la app está abierta)

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

function keyCard(onSaved, bad) {
  const key = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'none', placeholder: 'Consumer Key de Ticketmaster', value: prefs.get('tm.key') });
  return h('div', { class: 'card' }, h('h3', null, 'Falta la clave de Ticketmaster'),
    bad ? h('p', { class: 'muted bad' }, bad) : null,
    h('p', { class: 'muted' }, 'Las fechas salen de Ticketmaster. Es gratis: entra en developer.ticketmaster.com, crea una cuenta, abre «My Apps» y copia la Consumer Key. Se guarda solo en este dispositivo.'),
    key, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { prefs.set('tm.key', key.value.trim()); onSaved(); } }, 'Guardar y buscar')));
}

export function concertsView({ state, onSettings }) {
  const root = h('div');
  const months = Number(prefs.get('concMonths', '12'));
  const country = prefs.get('conc.country', 'ES');
  const rerender = () => { root.replaceWith(concertsView({ state, onSettings })); };

  root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Artistas de' }, PERIODS.map(([m, label]) =>
    h('button', { 'aria-pressed': String(months === m), onclick: () => { prefs.set('concMonths', String(m)); rerender(); } }, label))));
  const sel = h('select', { 'aria-label': 'País' }, K.COUNTRIES.map(([c, n]) => h('option', { value: c }, n)));
  sel.value = country;
  sel.addEventListener('change', () => { prefs.set('conc.country', sel.value); paint(); });
  const refresh = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Buscar de nuevo', title: 'Buscar de nuevo', onclick: () => { results.clear(); run(true); } }, '↻');
  root.append(h('div', { class: 'filters' }, sel, h('div', { class: 'syncgroup' }, refresh)));

  const names = K.artistNames({ stats: state.effStats, apiAlbums: state.apiAlbums, months, limit: LIMIT, topArtists: S.topArtists });
  const info = h('p', { class: 'muted', role: 'status' }), list = h('div'), empty = h('details', { class: 'dt' });
  root.append(info, list, empty);

  if (!names.length) {
    root.append(h('div', { class: 'empty' }, h('p', null, 'Necesito saber qué escuchas.'),
      h('p', { class: 'muted' }, 'Conecta Spotify o importa tu historial en Ajustes y aquí saldrán los próximos conciertos de tus artistas más escuchados.'),
      h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: onSettings }, 'Ir a Ajustes'))));
    return root;
  }
  if (!K.hasKey()) { list.append(keyCard(rerender)); info.textContent = ''; return root; }

  let done = 0, failed = '';
  function paint() {
    const all = K.mergeEvents(names.filter(n => results.has(n)).map(n => results.get(n)));
    const evs = K.filterCountry(all, sel.value);
    const countryName = (K.COUNTRIES.find(([c]) => c === sel.value) || [])[1];
    const busy = done < names.length && !failed;
    info.textContent = failed ? '' : busy ? `Buscando conciertos de tus artistas… ${done}/${names.length}`
      : evs.length ? `${evs.length} concierto${evs.length === 1 ? '' : 's'} de tus ${names.length} artistas más escuchados${sel.value ? ' en ' + countryName : ''}.` : '';
    list.replaceChildren(...(failed ? [h('p', { class: 'muted bad' }, failed)] : []),
      ...K.groupByMonth(evs).map(([k, items]) => h('section', null, h('h2', { class: 'month' }, K.monthLabel(k)), h('ul', { class: 'list' }, items.map(eventRow)))));
    if (!busy && !evs.length && !failed) {
      list.append(h('div', { class: 'empty' }, h('p', null, sel.value ? `Ninguno de tus artistas tiene conciertos anunciados en ${countryName}.` : 'Ninguno de tus artistas tiene conciertos anunciados.'),
        h('p', { class: 'muted' }, sel.value ? 'Prueba con «Todos los países»: a veces la gira pasa por Lisboa o París.' : 'Ticketmaster solo cubre sus propios eventos.')));
    }
    const without = names.filter(n => results.has(n) && !K.filterCountry(results.get(n), sel.value).length);
    empty.replaceChildren(...(without.length && !busy ? [h('summary', null, `Sin fechas anunciadas (${without.length})`), h('p', { class: 'muted' }, without.join(', '))] : []));
  }

  async function run(force) {
    const me = ++runId;
    done = names.filter(n => results.has(n)).length; failed = '';
    paint();
    for (const n of names) {
      if (me !== runId) return;                       // se cambió de pantalla o de periodo
      if (results.has(n)) continue;
      try { results.set(n, await K.artistEvents(n, { force })); }
      catch (e) {
        if (e.code === 'key') { if (me === runId) { list.replaceChildren(keyCard(rerender, e.message)); info.textContent = ''; } return; }
        if (e.code === 'rate') { failed = e.message; done = names.length; break; }
        results.set(n, []);
      }
      done++;
      if (me === runId) paint();
    }
    if (me === runId) paint();
  }
  run(false);
  return root;
}
