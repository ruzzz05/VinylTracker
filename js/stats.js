// Estadísticas de escucha (lógica pura, sin red ni DOM). Se prueba con `node --test tests/`.
//
// buildStats(entries) reduce el export de Spotify a un resumen compacto (guardable en el móvil):
// minutos por día, por hora y día de la semana, artistas, canciones, sesiones, saltos, plataformas…
// Todas las fechas se calculan en la hora LOCAL del dispositivo.
import { albumKey, tokens, windowStats, ownedIndex } from './core.js';

export const STATS_VERSION = 1;
const MIN_MS = 30000;                 // Spotify cuenta una reproducción a partir de 30 s
const SESSION_GAP = 30 * 60000;       // más de 30 min parado = otra sesión
const DAY_MS = 86400000;
const pad = n => String(n).padStart(2, '0');
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayToUtc = k => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const daysBetween = (a, b) => Math.round((dayToUtc(b) - dayToUtc(a)) / DAY_MS);
const addDays = (k, n) => dayKey(new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n));
const monthKeyOf = (now, back) => { const d = new Date(now.getFullYear(), now.getMonth() - back, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const windowKeys = (months, now, offset = 0) => Array.from({ length: months }, (_, i) => monthKeyOf(now, offset + i));

function platformName(p) {
  p = String(p || '').toLowerCase();
  if (/web_player|webplayer/.test(p)) return 'Web';
  if (/ios|iphone|ipad/.test(p)) return 'iPhone / iPad';
  if (/android/.test(p)) return 'Android';
  if (/partner|cast|speaker|echo|sonos|tv|ps4|ps5|xbox|alexa/.test(p)) return 'Altavoz / TV / consola';
  if (/os x|osx|mac/.test(p)) return 'Mac';
  if (/windows/.test(p)) return 'Windows';
  if (/linux/.test(p)) return 'Linux';
  return 'Otro';
}

// ---------------------------------------------------------------------------------------------
export function buildStats(entries) {
  const rows = [];
  for (const e of entries) {
    const artist = e.master_metadata_album_artist_name, name = e.master_metadata_track_name;
    if (!artist || !name || !e.ts) continue;                    // podcasts, vídeos…
    const end = new Date(e.ts);
    if (isNaN(end)) continue;
    rows.push({ end, ms: Math.max(0, e.ms_played || 0), artist, name, album: e.master_metadata_album_album_name || '',
      skipped: e.skipped === true, shuffle: e.shuffle === true, platform: e.platform ? platformName(e.platform) : '' });
  }
  rows.sort((a, b) => a.end - b.end);

  const S = { v: STATS_VERSION, days: {}, heat: new Array(168).fill(0), months: {}, artists: {}, tracks: {}, platforms: {},
    repeats: [], sessions: [], total: { ms: 0, plays: 0, rows: 0, first: '', last: '', lastTs: 0 } };
  const perDayTrack = new Map();
  let ses = null;

  for (const r of rows) {
    const day = dayKey(r.end), month = day.slice(0, 7);
    const counted = r.ms >= MIN_MS;
    S.days[day] = (S.days[day] || 0) + r.ms;
    S.heat[((r.end.getDay() + 6) % 7) * 24 + r.end.getHours()] += r.ms;
    const m = S.months[month] || (S.months[month] = { ms: 0, plays: 0, rows: 0, skipped: 0, shuffle: 0 });
    m.ms += r.ms; m.rows++; if (counted) m.plays++; if (r.skipped) m.skipped++; if (r.shuffle) m.shuffle++;
    if (r.platform) S.platforms[r.platform] = (S.platforms[r.platform] || 0) + r.ms;     // el registro en vivo y el export básico no traen plataforma
    S.total.ms += r.ms; S.total.rows++; if (counted) S.total.plays++;
    if (!S.total.first) S.total.first = day;
    S.total.last = day; S.total.lastTs = r.end.getTime();

    const a = S.artists[r.artist] || (S.artists[r.artist] = { ms: 0, plays: 0, first: day, months: {} });
    a.ms += r.ms; if (counted) a.plays++;
    const am = a.months[month] || (a.months[month] = [0, 0]);
    am[0] += r.ms; if (counted) am[1]++;

    const tk = r.artist + '\u0001' + r.name;
    const t = S.tracks[tk] || (S.tracks[tk] = { a: r.artist, n: r.name, al: r.album, ms: 0, plays: 0, months: {} });
    t.ms += r.ms; if (counted) t.plays++;
    const tm = t.months[month] || (t.months[month] = [0, 0]);
    tm[0] += r.ms; if (counted) tm[1]++;
    if (counted) { const k = day + '\u0001' + tk; perDayTrack.set(k, (perDayTrack.get(k) || 0) + 1); }

    const start = r.end.getTime() - r.ms;
    if (ses && start - ses.endTs <= SESSION_GAP) { ses.ms += r.ms; ses.plays += counted ? 1 : 0; ses.endTs = r.end.getTime(); }
    else { if (ses) S.sessions.push({ start: ses.start, ms: ses.ms, plays: ses.plays }); ses = { start, endTs: r.end.getTime(), ms: r.ms, plays: counted ? 1 : 0 }; }
  }
  if (ses) S.sessions.push({ start: ses.start, ms: ses.ms, plays: ses.plays });
  S.sessions = S.sessions.sort((x, y) => y.ms - x.ms).slice(0, 10);

  const reps = [];
  for (const [k, count] of perDayTrack) if (count >= 3) { const [day, a, n] = k.split('\u0001'); reps.push({ day, artist: a, name: n, count }); }
  S.repeats = reps.sort((x, y) => y.count - x.count).slice(0, 10);

  // Para no guardar decenas de miles de canciones sueltas: se descartan las escuchadas una sola vez y poco rato
  if (Object.keys(S.tracks).length > 25000) for (const k of Object.keys(S.tracks)) { const t = S.tracks[k]; if (t.plays < 2 && t.ms < 60000) delete S.tracks[k]; }
  return S;
}

// ------------------------------------------------------------------------------------ periodos
const sumDays = (S, from, to) => { let ms = 0; for (const [d, v] of Object.entries(S.days)) if (d >= from && d <= to) ms += v; return ms; };
const pct = (cur, prev) => (prev > 0 ? Math.round((cur - prev) / prev * 100) : null);

// Hoy, 7 días, 30 días, este año y total, con media diaria y comparación con el periodo anterior equivalente
export function periodTotals(S, now = new Date()) {
  const today = dayKey(now);
  const span = n => ({ from: addDays(today, -(n - 1)), prevFrom: addDays(today, -(2 * n - 1)), prevTo: addDays(today, -n), n });
  const mk = (label, from, to, n, prevMs) => { const ms = sumDays(S, from, to); return { label, ms, perDay: ms / n, prevMs, delta: prevMs == null ? null : pct(ms, prevMs) }; };
  const d7 = span(7), d30 = span(30);
  const yStart = `${now.getFullYear()}-01-01`;
  const yDays = daysBetween(yStart, today) + 1;
  const prevYStart = `${now.getFullYear() - 1}-01-01`, prevYEnd = `${now.getFullYear() - 1}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const first = S.total.first || today;
  return {
    today: mk('Hoy', today, today, 1, sumDays(S, addDays(today, -1), addDays(today, -1))),
    d7: mk('7 días', d7.from, today, 7, sumDays(S, d7.prevFrom, d7.prevTo)),
    d30: mk('30 días', d30.from, today, 30, sumDays(S, d30.prevFrom, d30.prevTo)),
    year: mk(String(now.getFullYear()), yStart, today, yDays, sumDays(S, prevYStart, prevYEnd)),
    all: mk('Total', '0000-00-00', '9999-99-99', Math.max(1, daysBetween(first, today) + 1), null)
  };
}

// Totales dentro de la ventana de meses (0 = todo) y del periodo anterior de la misma longitud
export function windowTotals(S, months, now = new Date()) {
  const keys = months ? windowKeys(months, now) : Object.keys(S.months);
  const t = { ms: 0, plays: 0, rows: 0, skipped: 0, shuffle: 0 };
  for (const k of keys) { const m = S.months[k]; if (m) for (const f of Object.keys(t)) t[f] += m[f]; }
  const today = dayKey(now);
  const startDay = months ? `${keys[keys.length - 1]}-01` : (S.total.first || today);
  const eff = S.total.first && startDay < S.total.first ? S.total.first : startDay;
  t.days = Math.max(1, daysBetween(eff, today) + 1);
  t.perDay = t.ms / t.days;
  t.startDay = eff;
  if (months) { let prev = 0; for (const k of windowKeys(months, now, months)) prev += (S.months[k] || { ms: 0 }).ms; t.prevMs = prev; t.delta = pct(t.ms, prev); }
  else { t.prevMs = null; t.delta = null; }
  return t;
}

export function monthSeries(S, n = 12, now = new Date()) {
  return Array.from({ length: n }, (_, i) => { const key = monthKeyOf(now, n - 1 - i); return { key, ms: (S.months[key] || { ms: 0 }).ms }; });
}
export function daySeries(S, n = 30, now = new Date()) {
  const today = dayKey(now);
  return Array.from({ length: n }, (_, i) => { const key = addDays(today, -(n - 1 - i)); return { key, ms: S.days[key] || 0 }; });
}
export function yearTotals(S) {
  const y = {};
  for (const [k, m] of Object.entries(S.months)) { const yr = k.slice(0, 4); const o = y[yr] || (y[yr] = { year: yr, ms: 0, plays: 0 }); o.ms += m.ms; o.plays += m.plays; }
  return Object.values(y).sort((a, b) => a.year.localeCompare(b.year));
}

// ------------------------------------------------------------------------------- rankings
function windowOf(entry, keys) {
  if (!keys) return { ms: entry.ms, plays: entry.plays };
  let ms = 0, plays = 0;
  for (const k of keys) { const c = entry.months[k]; if (c) { ms += c[0]; plays += c[1]; } }
  return { ms, plays };
}
export function topArtists(S, months, now = new Date(), limit = 50) {
  const keys = months ? windowKeys(months, now) : null;
  const total = windowTotals(S, months, now).ms || 1;
  return Object.entries(S.artists).map(([name, a]) => ({ name, ...windowOf(a, keys), first: a.first }))
    .filter(a => a.ms > 0).sort((x, y) => y.ms - x.ms).slice(0, limit).map(a => ({ ...a, share: a.ms / total }));
}
export function topTracks(S, months, now = new Date(), limit = 50) {
  const keys = months ? windowKeys(months, now) : null;
  return Object.values(S.tracks).map(t => ({ name: t.n, artist: t.a, album: t.al, ...windowOf(t, keys) }))
    .filter(t => t.ms > 0).sort((x, y) => y.ms - x.ms).slice(0, limit);
}

// Artistas cuya primera escucha cae dentro de la ventana (no tiene sentido con "Todo")
export function discoveries(S, months, now = new Date()) {
  if (!months) return null;
  const startDay = `${windowKeys(months, now).pop()}-01`;
  const keys = windowKeys(months, now);
  const list = Object.entries(S.artists).filter(([, a]) => a.first >= startDay && S.total.first < startDay)
    .map(([name, a]) => ({ name, ms: windowOf(a, keys).ms })).filter(a => a.ms > 0).sort((x, y) => y.ms - x.ms);
  return { count: list.length, top: list.slice(0, 3) };
}

// ----------------------------------------------------------------------------------- hábitos
export function persona(S) {
  const byHour = new Array(24).fill(0), byDay = new Array(7).fill(0);
  S.heat.forEach((v, i) => { byHour[i % 24] += v; byDay[Math.floor(i / 24)] += v; });
  const total = byHour.reduce((a, b) => a + b, 0) || 1;
  const sum = (...h) => h.reduce((s, x) => s + byHour[x], 0) / total;
  const share = { noche: sum(22, 23, 0, 1, 2, 3, 4), manana: sum(5, 6, 7, 8, 9, 10, 11), tarde: sum(12, 13, 14, 15, 16, 17), anochecer: sum(18, 19, 20, 21) };
  let key = 'todoterreno', label = 'Todoterreno', text = 'Escuchas a todas horas, sin un momento claro.';
  if (share.noche >= 0.3) { key = 'noctambulo'; label = 'Noctámbulo'; text = `El ${Math.round(share.noche * 100)} % de tu música suena entre las 22:00 y las 05:00.`; }
  else if (share.manana >= 0.4) { key = 'madrugador'; label = 'Madrugador'; text = `El ${Math.round(share.manana * 100)} % de tu música suena por la mañana.`; }
  else if (share.tarde >= 0.4) { key = 'sobremesa'; label = 'De sobremesa'; text = `El ${Math.round(share.tarde * 100)} % de tu música suena entre las 12:00 y las 18:00.`; }
  else if (share.anochecer >= 0.4) { key = 'anochecer'; label = 'De tarde-noche'; text = `El ${Math.round(share.anochecer * 100)} % de tu música suena entre las 18:00 y las 22:00.`; }
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const dayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const favDay = dayNames[byDay.indexOf(Math.max(...byDay))];
  const weekend = (byDay[5] + byDay[6]) / 2, week = (byDay[0] + byDay[1] + byDay[2] + byDay[3] + byDay[4]) / 5;
  return { key, label, text, share, peakHour, favDay, weekendRatio: week ? weekend / week : 1, byHour, byDay };
}

export function streaks(S, now = new Date()) {
  const days = Object.keys(S.days).filter(d => S.days[d] >= 60000).sort();
  let best = { days: 0, from: '', to: '' }, run = 0, runFrom = '';
  days.forEach((d, i) => {
    if (i > 0 && daysBetween(days[i - 1], d) === 1) run++; else { run = 1; runFrom = d; }
    if (run > best.days) best = { days: run, from: runFrom, to: d };
  });
  const today = dayKey(now), set = new Set(days);
  let cur = 0, d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) { cur++; d = addDays(d, -1); }
  return { longest: best, current: cur };
}

export function records(S) {
  const best = Object.entries(S.days).sort((a, b) => b[1] - a[1])[0];
  return {
    bestDay: best ? { day: best[0], ms: best[1] } : null,
    longestSession: S.sessions[0] || null,
    repeat: S.repeats[0] || null
  };
}

export function habits(S, months, now = new Date()) {
  const w = windowTotals(S, months, now);
  const platTotal = Object.values(S.platforms).reduce((a, b) => a + b, 0) || 1;
  return {
    skipRate: w.rows ? w.skipped / w.rows : 0,
    shuffleRate: w.rows ? w.shuffle / w.rows : 0,
    platforms: Object.entries(S.platforms).map(([name, ms]) => ({ name, ms, share: ms / platTotal })).sort((a, b) => b.ms - a.ms)
  };
}

// Curiosidades con sabor a vinilo
export function funFacts(ms) {
  const minutes = ms / 60000;
  return { lps: minutes / 45, revolutions: Math.round(minutes * 100 / 3), days: ms / DAY_MS, hours: minutes / 60 };
}

// ------------------------------------------------------------------------ tu vinilo vs Spotify
// history: { key: {artist, name, months} } (por álbum) · collection: lista de vinilos que tienes
export function vinylStats({ history, collection, stats, months = 12, now = new Date() }) {
  const idx = ownedIndex(collection);
  let total = 0, owned = 0;
  const played = collection.map(a => {
    const h = history[albumKey(a.artist, a.name)];
    return { ...a, minutes: h ? windowStats(h, months, now).minutes : 0 };
  });
  for (const h of Object.values(history)) total += windowStats(h, months, now).minutes;
  for (const a of played) owned += a.minutes;
  const ownedArtists = new Set(collection.map(a => tokens(a.artist).join(' ')));
  const withoutVinyl = stats ? topArtists(stats, months, now, 60).filter(a => !ownedArtists.has(tokens(a.name).join(' '))).slice(0, 5) : [];
  const year = collection.map(a => { const h = history[albumKey(a.artist, a.name)]; return { ...a, minutes: h ? windowStats(h, 12, now).minutes : 0 }; });
  return {
    share: total ? owned / total : 0, ownedMinutes: owned, totalMinutes: total,
    topOwned: played.filter(a => a.minutes > 0).sort((x, y) => y.minutes - x.minutes).slice(0, 5),
    forgotten: year.filter(a => a.minutes === 0).sort((x, y) => x.artist.localeCompare(y.artist, 'es')),
    withoutVinyl, ownedCount: idx.keys.size
  };
}

export function collectionStyles(collection, limit = 8) {
  const c = {};
  for (const a of collection) for (const t of a.tags || []) c[t] = (c[t] || 0) + 1;
  return Object.entries(c).map(([tag, count]) => ({ tag, count })).sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag)).slice(0, limit);
}

// ----------------------------------------------------------------------------------- formatos
export function fmtDur(ms) {
  const min = Math.round(ms / 60000);
  if (ms > 0 && min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24), hr = h % 24;
  return hr ? `${d} d ${hr} h` : `${d} d`;
}
export const fmtNum = n => new Intl.NumberFormat('es-ES').format(Math.round(n));
export const fmtPct = r => `${Math.round(r * 100)} %`;
export const fmtDay = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fmtMonth = k => `${MONTHS_ES[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
export const monthInitial = k => MONTHS_ES[+k.slice(5, 7) - 1].slice(0, 3);

// Techo "redondo" para el eje (1, 2, 5 × 10^n)
export function niceCeil(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
export const fmtAxis = ms => { const m = ms / 60000; return m < 120 ? `${Math.round(m)} min` : `${Math.round(m / 60)} h`; };

// ------------------------------------------------------------------------- fusionar resúmenes
// Une el historial importado con el registro en vivo sin recalcular todo (equivale a buildStats de la unión).
// Las sesiones y las repeticiones de un solo día se unen de forma aproximada.
export function mergeStats(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = { v: a.v, days: { ...a.days }, heat: a.heat.map((v, i) => v + b.heat[i]), months: { ...a.months },
    artists: { ...a.artists }, tracks: { ...a.tracks }, platforms: { ...a.platforms }, total: { ...a.total } };
  for (const [d, v] of Object.entries(b.days)) out.days[d] = (out.days[d] || 0) + v;
  for (const [m, c] of Object.entries(b.months)) {
    const o = out.months[m];
    out.months[m] = o ? { ms: o.ms + c.ms, plays: o.plays + c.plays, rows: o.rows + c.rows, skipped: o.skipped + c.skipped, shuffle: o.shuffle + c.shuffle } : { ...c };
  }
  const mergeEntity = (map, key, e) => {
    const o = map[key];
    if (!o) { map[key] = e; return; }
    const n = { ...o, ms: o.ms + e.ms, plays: o.plays + e.plays, months: { ...o.months } };
    if (e.first && (!o.first || e.first < o.first)) n.first = e.first;
    for (const [m, c] of Object.entries(e.months)) n.months[m] = n.months[m] ? [n.months[m][0] + c[0], n.months[m][1] + c[1]] : c;
    map[key] = n;
  };
  for (const [k, e] of Object.entries(b.artists)) mergeEntity(out.artists, k, e);
  for (const [k, e] of Object.entries(b.tracks)) mergeEntity(out.tracks, k, e);
  for (const [k, v] of Object.entries(b.platforms)) out.platforms[k] = (out.platforms[k] || 0) + v;
  const reps = {};
  for (const r of [...a.repeats, ...b.repeats]) { const k = r.day + '\u0001' + r.artist + '\u0001' + r.name; reps[k] = reps[k] ? { ...r, count: reps[k].count + r.count } : { ...r }; }
  out.repeats = Object.values(reps).sort((x, y) => y.count - x.count).slice(0, 10);
  out.sessions = [...a.sessions, ...b.sessions].sort((x, y) => y.ms - x.ms).slice(0, 10);
  const t = out.total, u = b.total;
  t.ms += u.ms; t.plays += u.plays; t.rows += u.rows;
  if (u.first && (!t.first || u.first < t.first)) t.first = u.first;
  if (u.last && u.last > t.last) t.last = u.last;
  t.lastTs = Math.max(t.lastTs || 0, u.lastTs || 0);
  return out;
}
