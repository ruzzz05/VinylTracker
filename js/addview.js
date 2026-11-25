// «Añadir disco» a la colección: con enlace de Spotify (coge toda la info posible), con código de barras (Discogs) o a mano.
// Siempre se enseña un formulario editable (nombre, artista, año, estilos, portada) ANTES de guardar.
// Destino: con enlace de Spotify válido, portada https y sesión de dueño → documento de mi-app (como siempre);
// en cualquier otro caso → lista propia de VinylTracker (en el dispositivo y en la copia de la nube), que también cuenta como colección.
import { h, safeUrl } from './dom.js';
import * as C from './core.js';
import * as spotify from './spotify.js';
import * as fb from './firebase.js';
import * as wv from './wishview.js';
import * as A from './albuminfo.js';
import * as covers from './covers.js';
import { cachedImg } from './imgcache.js';

export function openAdd(ctx, { prefill = null, editing = null } = {}) {
  const st = ctx.state;
  let src = { spotifyId: '', source: '' };
  const field = (label, input) => [h('label', null, label), input];
  const link = h('input', { type: 'url', inputmode: 'url', placeholder: 'Opcional: enlace del álbum en Spotify', autocomplete: 'off', autocapitalize: 'none' });
  const name = h('input', { type: 'text', maxlength: '120', autocomplete: 'off', placeholder: 'Nombre del álbum' });
  const artist = h('input', { type: 'text', maxlength: '80', list: 'artist-list', autocomplete: 'off', placeholder: 'Artista' });
  const year = h('input', { type: 'text', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', placeholder: 'Año (opcional)' });
  const tags = h('input', { type: 'text', autocomplete: 'off', placeholder: 'rap, trap' });
  const image = h('input', { type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', placeholder: 'Portada (dirección https, opcional)' });
  const list = h('datalist', { id: 'artist-list' }, [...new Set(st.collection.map(a => a.artist))].sort((x, y) => x.localeCompare(y, 'es')).map(a => h('option', { value: a })));
  const preview = h('div', { class: 'head', hidden: true });
  const suggest = h('div', { class: 'suggest' });
  const status = h('p', { class: 'muted', role: 'status' });
  const dest = h('p', { class: 'muted' });
  const save = h('button', { class: 'btn' }, editing ? 'Guardar cambios' : 'Guardar disco');
  const say = (m, err) => { status.textContent = m || ''; status.className = 'muted' + (err ? ' bad' : ''); };
  const addTag = t => { tags.value = C.normalizeTags(tags.value + ',' + t).join(', '); };
  const tagChips = h('div', { class: 'chips' });
  const paintChips = (extra = []) => tagChips.replaceChildren(...[...new Set([...extra, ...C.allTags(st.collection)])].slice(0, 40).map(t => h('button', { class: 'chip', type: 'button', onclick: () => addTag(t) }, t)));
  paintChips();

  const owner = () => fb.isOwner();
  const toMiApp = () => !editing && owner() && !!C.parseSpotifyAlbum(link.value) && /^https:\/\/\S+$/.test(image.value.trim());
  const paintDest = () => { dest.textContent = editing ? 'Se actualizará en este dispositivo.' : toMiApp() ? 'Se guardará en tu colección de mi-app (nube).' : 'Se guardará en este dispositivo (y en tu copia de la nube). Para mi-app: enlace de Spotify y portada https.'; };
  const paintPreview = () => {
    const u = image.value.trim();
    if (!/^https:\/\/\S+$/.test(u)) { preview.hidden = true; return; }
    preview.replaceChildren(cachedImg(u, { cls: 'cover', onFail: () => { preview.hidden = true; } }), h('div', null, h('b', null, name.value || '—'), h('p', { class: 'muted' }, artist.value || '')));
    preview.hidden = false;
  };

  // Rellena el formulario con lo que se sepa (sin pisar lo que ya escribiste, salvo que `force`)
  function apply(info, { force = false } = {}) {
    const put = (el, v) => { if (v && (force || !el.value.trim())) el.value = v; };
    put(name, info.name); put(artist, info.artist); put(year, info.year ? String(info.year) : ''); put(image, info.image);
    if (info.tags && info.tags.length) tags.value = C.normalizeTags(tags.value + ',' + info.tags.join(',')).join(', ');
    paintChips(info.tags || []); paintPreview(); paintDest();
  }

  // Enlace de Spotify: con Spotify conectado, la API da nombre, artista, año, portada grande, sello y estilos del artista;
  // sin conexión, el oEmbed público da nombre y portada y iTunes sugiere artista, año y estilo.
  link.addEventListener('input', async () => {
    const sp = C.parseSpotifyAlbum(link.value);
    suggest.replaceChildren(); paintDest();
    if (!sp) return say(link.value.trim() ? 'Eso no parece un enlace de álbum de Spotify.' : '', !!link.value.trim());
    if (!editing && st.collection.some(a => a.id === sp.id || (a.url && a.url.includes(sp.id)))) return say('Ese disco ya está en tu colección.', true);
    say('Buscando el álbum…');
    try {
      let info = null;
      if (spotify.isConnected()) {
        try {
          const album = await spotify.fetchAlbum(sp.id);
          const art = await spotify.fetchArtist(((album.artists || [])[0] || {}).id).catch(() => null);
          info = A.spotifyInfo(album, art);
        } catch (e) { info = null; }
      }
      if (!link.value.includes(sp.id)) return;          // el enlace cambió mientras buscaba
      if (info) {
        apply(info, { force: true });
        say(`Datos de Spotify: ${[info.year, info.label, info.tracks ? info.tracks + ' canciones' : ''].filter(Boolean).join(' · ')}.`);
        return;
      }
      const res = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(sp.url));
      if (!res.ok) throw new Error('Spotify respondió ' + res.status);
      const o = await res.json();
      if (!link.value.includes(sp.id)) return;
      apply({ name: o.title || '', image: o.thumbnail_url || '' }, { force: true });
      say('Rellena artista y estilos. Conecta Spotify para más datos.');
      itunes(o.title);
    } catch (e) { say('No se pudo leer el álbum de Spotify: ' + e.message, true); }
  });

  async function itunes(title) {
    try {
      const res = await fetch('https://itunes.apple.com/search?entity=album&limit=5&country=ES&term=' + encodeURIComponent(title));
      const found = (await res.json()).results || [];
      suggest.replaceChildren(...found.map(r => h('button', { class: 'sug', type: 'button', onclick: () => {
        artist.value = r.artistName; year.value = (r.releaseDate || '').slice(0, 4);
        if (r.primaryGenreName) addTag(r.primaryGenreName);
        paintPreview();
      } }, r.artistName, h('small', null, `${r.collectionName} · ${(r.releaseDate || '').slice(0, 4)} · ${r.primaryGenreName || ''}`))));
    } catch (e) { /* las sugerencias son opcionales */ }
  }

  // Sin portada: se busca sola (Spotify / iTunes) con el nombre y el artista
  const findCover = async () => {
    if (!name.value.trim() || !artist.value.trim()) return say('Escribe el nombre y el artista para buscar la portada.', true);
    say('Buscando la portada…');
    const u = await covers.albumImage({ artist: artist.value.trim(), name: name.value.trim() }, {}).catch(() => '');
    if (u) { image.value = u; paintPreview(); paintDest(); say('Portada encontrada.'); } else say('Portada no encontrada.', true);
  };

  image.addEventListener('input', () => { paintPreview(); paintDest(); });
  for (const el of [name, artist]) el.addEventListener('input', () => { if (!preview.hidden) paintPreview(); });

  save.addEventListener('click', async () => {
    const base = { name: name.value, artist: artist.value, year: year.value, tags: tags.value, image: image.value.trim(), spotifyUrl: link.value.trim() };
    save.disabled = true;
    try {
      if (editing) {
        const r = C.makeManual({ ...base, id: editing.id, now: editing.addedAt });
        if (!r.ok) { say(r.error, true); return; }
        ctx.updateManual(r.album); ctx.closeSheet(); ctx.toast('Disco actualizado: ' + r.album.name); return;
      }
      if (toMiApp()) {
        const r = C.newAlbum({ spotifyUrl: base.spotifyUrl, name: base.name, artist: base.artist, image: base.image, tags: base.tags, year: base.year });
        if (!r.ok) { say(r.error, true); return; }
        say('Guardando…');
        await ctx.addToMiApp(r.album);
        ctx.closeSheet(); ctx.toast('Disco añadido a mi-app: ' + r.album.name); return;
      }
      let img = base.image;
      if (!img && name.value.trim() && artist.value.trim()) {                      // sin portada: se intenta encontrar antes de guardar
        say('Buscando la portada…');
        img = await covers.albumImage({ artist: artist.value.trim(), name: name.value.trim() }, {}).catch(() => '') || '';
      }
      const r = C.makeManual({ ...base, image: img });
      if (!r.ok) { say(r.error, true); return; }
      if (st.collection.some(a => C.albumKey(a.artist, a.name) === C.albumKey(r.album.artist, r.album.name)) && !confirm('Ya tienes un disco con ese nombre y artista. ¿Añadirlo igualmente?')) { say(''); return; }
      ctx.addManual(r.album); ctx.closeSheet(); ctx.toast('Disco añadido: ' + r.album.name);
    } catch (e) { say('No se pudo guardar: ' + e.message, true); }
    finally { save.disabled = false; }
  });

  if (editing) { name.value = editing.name; artist.value = editing.artist; year.value = editing.year || ''; tags.value = (editing.tags || []).join(', '); image.value = editing.image || ''; link.value = editing.url || ''; }
  if (prefill) apply(prefill, { force: true });
  paintPreview(); paintDest();

  ctx.showPanel(h('h2', null, editing ? 'Editar disco' : 'Añadir disco'),
    editing ? null : h('div', { class: 'btns', style: 'margin-top:0' },
      h('button', { class: 'btn sec', type: 'button', onclick: () => wv.scanSheet(ctx, { onPick: r => openAdd(ctx, { prefill: A.discogsInfo(r) }) }) }, 'Escanear código de barras')),
    field('Enlace de Spotify', link), preview,
    field('Nombre del álbum', name), field('Artista', artist), list, suggest,
    field('Año', year),
    field('Estilos (separados por comas)', tags), tagChips,
    field('Portada', image),
    h('div', { class: 'btns', style: 'margin-top:0' }, h('button', { class: 'btn sec sm', type: 'button', onclick: findCover }, 'Buscar portada')),
    status, dest,
    h('div', { class: 'btns' }, save, h('button', { class: 'btn sec', onclick: ctx.closeSheet }, 'Cancelar')));
}
