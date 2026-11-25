// Pantalla «Olvidados» (dentro de Ranking): artistas y canciones que escuchaste mucho y hace tiempo que no suenan,
// con lista de artistas excluidos, playlists de Spotify como fuente extra y botón para crear una playlist con ellos.
import { h } from './dom.js';
import * as R from './rediscover.js';
import * as spotify from './spotify.js';
import * as store from './storage.js';
import { prefs } from './storage.js';
import { artistAvatar } from './artists.js';
import { trackCover } from './covers.js';

const MONTHS = [[3, '3 meses'], [6, '6 meses'], [12, '1 año'], [24, '2 años']];
let plists = {};                         // id -> { name, at, tracks: [{ a, n, al, u, t }] }  (importadas de Spotify, guardadas en el móvil)
export const preload = async () => { plists = (await store.get('plists', {})) || {}; };
const savePlists = () => store.set('plists', plists);

const readExcluded = () => { try { const v = JSON.parse(prefs.get('rd.excluded', '[]')); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const writeExcluded = list => prefs.set('rd.excluded', JSON.stringify([...new Set(list)].slice(0, 500)));

const ago = n => (n < 12 ? `hace ${n} ${n === 1 ? 'mes' : 'meses'}` : `hace ${Math.floor(n / 12)} ${Math.floor(n / 12) === 1 ? 'año' : 'años'}` + (n % 12 ? ` y ${n % 12} ${n % 12 === 1 ? 'mes' : 'meses'}` : ''));
const monthLabel = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }).replace('.', ''); };

const selectedTracks = () => Object.values(plists).flatMap(p => p.tracks);

export function rediscoverView(ctx) {
  const st = ctx.state;
  const root = h('div');
  const months = Number(prefs.get('rd.months', '6')), kind = prefs.get('rd.kind', 'artists');
  const excluded = readExcluded();
  const redo = () => ctx.render();

  root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Qué' }, [['artists', 'Artistas'], ['tracks', 'Canciones']].map(([k, l]) =>
    h('button', { 'aria-pressed': String(kind === k), onclick: () => { prefs.set('rd.kind', k); redo(); } }, l))));
  root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Sin escuchar desde hace' }, MONTHS.map(([m, l]) =>
    h('button', { 'aria-pressed': String(months === m), onclick: () => { prefs.set('rd.months', String(m)); redo(); } }, l))));
  root.append(h('p', { class: 'muted' }, `Lo que más escuchaste y lleva al menos ${MONTHS.find(x => x[0] === months)[1]} sin sonar. Pulsa «No» en lo que no quieras volver a ver.`));

  const plist = selectedTracks();
  const list = R.forgotten(st.effStats, { kind, silent: months, excluded, plist, now: new Date(), minWeight: kind === 'tracks' ? 5 : 12 });
  root.append(playlistCard(ctx, redo));

  if (!st.effStats && !plist.length) {
    root.append(h('div', { class: 'empty' }, h('p', null, 'Esto necesita tu historial de Spotify o una playlist.'),
      h('p', { class: 'muted' }, 'Importa el export en Ajustes, o elige abajo una playlist tuya (por ejemplo la que tiene casi todo lo que has escuchado, en orden).')));
    return root;
  }

  if (!list.length) root.append(h('div', { class: 'empty' }, 'No hay nada que cumpla eso. Prueba con menos meses.'));
  else {
    const known = ctx.known();
    root.append(h('ul', { class: 'list' }, list.map((r, i) => h('li', null, h('div', { class: 'row static frow' },
      h('div', { class: 'n' }, i + 1),
      kind === 'artists' ? artistAvatar(r.artist) : trackCover({ artist: r.artist, name: r.name, album: r.album }, known),
      h('div', { class: 't' }, h('b', null, r.name), kind === 'tracks' ? h('span', null, r.artist) : null,
        h('span', null, `Última vez ${monthLabel(r.last)} (${ago(r.ago)})`),
        h('div', { class: 'chips tight' }, r.plays ? h('span', { class: 'chip' }, `${r.plays} reprod.`) : null,
          r.peak && r.peak !== r.last ? h('span', { class: 'chip' }, `pico ${monthLabel(r.peak)}`) : null,
          r.inPlaylist ? h('span', { class: 'chip ok' }, 'en playlist') : null)),
      h('button', { class: 'btn sec sm', type: 'button', 'aria-label': `No me interesa ${r.artist}`, title: kind === 'artists' ? 'No me interesa este artista' : 'No me interesa este artista (se ocultan también sus canciones)',
        onclick: () => { writeExcluded([...excluded, r.artist]); ctx.toast(`Ocultado: ${r.artist}`); redo(); } }, 'No'))))));
    root.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => createPlaylistFlow(ctx, st.effStats, list, kind, plist) }, 'Crear playlist con esto')));
  }

  if (excluded.length) {
    root.append(h('details', { class: 'dt' }, h('summary', null, `Artistas excluidos (${excluded.length})`),
      h('div', { class: 'chips' }, excluded.map(n => h('button', { class: 'chip', type: 'button', title: 'Volver a incluir', onclick: () => { writeExcluded(excluded.filter(x => x !== n)); redo(); } }, n + ' ×'))),
      h('p', { class: 'muted' }, 'Toca uno para volver a incluirlo.')));
  }
  return root;
}

// ---------- playlists como fuente ----------
function playlistCard(ctx, redo) {
  const ids = Object.keys(plists);
  return h('div', { class: 'card' }, h('h3', null, 'Playlists como fuente'),
    h('p', { class: 'muted' }, 'Las canciones de tus playlists también cuentan, y la fecha en que las añadiste hace de «última vez que las escuché». Sirve, por ejemplo, para una playlist con casi todo lo que has escuchado, en orden.'),
    ids.length ? h('div', { class: 'chips' }, ids.map(id => h('span', { class: 'chip ok' }, `${plists[id].name} · ${plists[id].tracks.length}`))) : null,
    !spotify.isConnected() ? h('p', { class: 'muted' }, 'Conecta Spotify en Ajustes para elegir playlists.')
      : h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => pickPlaylists(ctx, redo) }, ids.length ? 'Cambiar playlists' : 'Elegir playlists'),
        ids.length ? h('button', { class: 'btn danger', onclick: async () => { plists = {}; await savePlists(); redo(); } }, 'Quitar todas') : null));
}

async function pickPlaylists(ctx, redo) {
  const body = h('div', null, h('p', { class: 'muted', role: 'status' }, 'Cargando tus playlists…'));
  ctx.showPanel(h('h2', null, 'Elegir playlists'), body);
  let all;
  try { all = await spotify.myPlaylists(); }
  catch (e) { body.replaceChildren(errorBlock(ctx, e)); return; }
  if (!all.length) { body.replaceChildren(h('p', { class: 'muted' }, 'No tienes playlists.')); return; }
  const boxes = all.map(p => ({ p, el: h('input', { type: 'checkbox', checked: !!plists[p.id], style: 'width:auto;margin:0 10px 0 0' }) }));
  const status = h('p', { class: 'muted', role: 'status' });
  const go = h('button', { class: 'btn' }, 'Importar las marcadas');
  go.addEventListener('click', async () => {
    go.disabled = true;
    const next = {};
    try {
      for (const { p, el } of boxes) {
        if (!el.checked) continue;
        if (plists[p.id]) { next[p.id] = plists[p.id]; continue; }
        status.textContent = `Importando «${p.name}»…`;
        const items = await spotify.playlistItems(p.id, (n, t) => { status.textContent = `Importando «${p.name}»… ${n}/${t}`; });
        next[p.id] = { name: p.name, at: Date.now(), tracks: R.parsePlaylistItems(items) };
      }
      plists = next; await savePlists();
      ctx.closeSheet(); ctx.toast('Playlists importadas'); redo();
    } catch (e) { status.textContent = ''; body.append(errorBlock(ctx, e)); go.disabled = false; }
  });
  body.replaceChildren(
    h('p', { class: 'muted' }, 'Marca las que quieras usar como fuente.'),
    ...boxes.map(({ p, el }) => h('label', { style: 'display:flex;align-items:center;margin:8px 0;color:var(--text);font-size:1rem' }, el, h('span', null, `${p.name} `, h('small', { class: 'muted' }, `${p.total} canciones`)))),
    status, h('div', { class: 'btns' }, go, h('button', { class: 'btn sec', onclick: ctx.closeSheet }, 'Cancelar')));
}

const errorBlock = (ctx, e) => h('div', null, h('p', { class: 'muted bad' }, e.message),
  e.code === 'scope' ? h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { ctx.closeSheet(); ctx.go('ajustes'); } }, 'Ir a Ajustes')) : null);

// ---------- crear una playlist con lo que se ve ----------
async function createPlaylistFlow(ctx, S, list, kind, plist) {
  if (!spotify.isConnected()) return ctx.toast('Conecta Spotify en Ajustes', true);
  const tracks = R.playlistTracks(S, list, { kind, plist });
  if (!tracks.length) return ctx.toast('No hay canciones para la playlist', true);
  const status = h('p', { class: 'muted', role: 'status' }, `Buscando ${tracks.length} canciones en Spotify…`);
  const body = h('div', null, status);
  ctx.showPanel(h('h2', null, 'Crear playlist'), body);
  try {
    const uris = [];
    for (let i = 0; i < tracks.length; i++) {
      status.textContent = `Buscando canciones en Spotify… ${i + 1}/${tracks.length}`;
      const t = tracks[i];
      const u = t.uri || await spotify.findTrackUri(t.artist, t.name).catch(() => null);
      if (u && !uris.includes(u)) uris.push(u);
    }
    if (!uris.length) throw new Error('No encontré ninguna de las canciones en Spotify.');
    status.textContent = 'Creando la playlist…';
    const name = `Redescubre · ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const pl = await spotify.createPlaylist(name, 'Lo que escuchabas mucho y hace tiempo que no suena. Creada con VinylTracker.');
    await spotify.addToPlaylist(pl.id, uris);
    const url = (pl.external_urls || {}).spotify || `https://open.spotify.com/playlist/${pl.id}`;
    body.replaceChildren(h('p', { class: 'own' }, `✓ Playlist creada con ${uris.length} canciones${uris.length < tracks.length ? ` (${tracks.length - uris.length} no se encontraron)` : ''}.`),
      h('div', { class: 'btns' }, h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Abrir en Spotify'), h('button', { class: 'btn sec', onclick: ctx.closeSheet }, 'Cerrar')));
  } catch (e) { body.replaceChildren(errorBlock(ctx, e), h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: ctx.closeSheet }, 'Cerrar'))); }
}
