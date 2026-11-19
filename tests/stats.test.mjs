process.env.TZ = 'UTC';                      // fechas deterministas
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/core.js';
import * as S from '../js/stats.js';

const NOW = new Date('2026-11-19T12:00:00Z');   // jueves
const e = (ts, artist, album, track, ms = 200000, extra = {}) => ({
  ts, ms_played: ms, master_metadata_album_artist_name: artist, master_metadata_album_album_name: album,
  master_metadata_track_name: track, spotify_track_uri: 'spotify:track:' + track, platform: 'iOS 17.1 (iPhone15,2)', ...extra });

const ENTRIES = [
  // hoy (jueves 19), de noche: 3 veces la misma canción de A + 1 de B
  e('2026-11-19T22:00:00Z', 'A', 'Disco A', 'a1'), e('2026-11-19T22:10:00Z', 'A', 'Disco A', 'a1'),
  e('2026-11-19T22:20:00Z', 'A', 'Disco A', 'a1', 200000, { skipped: true }), e('2026-11-19T23:50:00Z', 'B', 'Disco B', 'b1', 100000, { shuffle: true }),
  e('2026-11-18T22:00:00Z', 'A', 'Disco A', 'a2'), e('2026-11-18T22:05:00Z', 'A', 'Disco A', 'a2'),
  e('2026-11-17T23:00:00Z', 'D', 'Disco D', 'd1'),                       // D: artista nuevo de noviembre
  e('2026-10-10T23:00:00Z', 'B', 'Disco B', 'b1'), e('2026-10-10T23:05:00Z', 'B', 'Disco B', 'b2'),
  e('2026-05-05T23:00:00Z', 'C', 'Disco C', 'c1', 60000),
  e('2025-02-02T23:00:00Z', 'A', 'Disco A', 'a1', 120000, { platform: 'Android OS 14 API 34' }),
  { ts: '2026-11-19T10:00:00Z', ms_played: 999999 }                         // podcast: se ignora
];
const st = S.buildStats(ENTRIES);

test('buildStats: totales, días, heatmap y plataformas', () => {
  assert.equal(st.total.rows, 11);
  assert.equal(st.total.first, '2025-02-02'); assert.equal(st.total.last, '2026-11-19');
  assert.equal(st.days['2026-11-19'], 700000);
  assert.equal(st.heat[3 * 24 + 22], 600000);                                 // jueves 22 h: 3 × 200 s de A
  assert.equal(st.heat[3 * 24 + 23], 100000);
  assert.equal(st.platforms['iPhone / iPad'] > st.platforms['Android'], true);
  assert.equal(st.months['2026-11'].skipped, 1); assert.equal(st.months['2026-11'].shuffle, 1);
  assert.equal(st.months['2026-05'].plays, 1);                              // 60 s cuenta (>= 30 s)
});

test('periodTotals: hoy, 7 días, 30 días, año y total', () => {
  const p = S.periodTotals(st, NOW);
  assert.equal(p.today.ms, 700000);
  assert.equal(p.today.prevMs, 400000);                                     // ayer
  assert.equal(p.today.delta, 75);
  assert.equal(p.d7.ms, 700000 + 400000 + 200000);
  assert.equal(p.d30.ms, 1300000);
  assert.equal(p.year.ms, 1300000 + 400000 + 60000);                        // + oct + mayo
  assert.equal(p.all.ms, st.total.ms);
  assert.ok(Math.abs(p.d7.perDay - 1300000 / 7) < 1);
});

test('windowTotals por meses y comparación con el periodo anterior', () => {
  const w = S.windowTotals(st, 1, NOW);
  assert.equal(w.ms, 1300000); assert.equal(w.prevMs, 400000);               // noviembre vs octubre
  assert.equal(S.windowTotals(st, 0, NOW).prevMs, null);
  assert.equal(S.windowTotals(st, 12, NOW).ms, 1300000 + 400000 + 60000);
});

test('series de meses y días, y años', () => {
  const m = S.monthSeries(st, 12, NOW);
  assert.equal(m.length, 12); assert.equal(m[11].key, '2026-11'); assert.equal(m[11].ms, 1300000); assert.equal(m[0].key, '2025-12');
  const d = S.daySeries(st, 30, NOW);
  assert.equal(d.length, 30); assert.equal(d[29].ms, 700000); assert.equal(d[28].ms, 400000);
  assert.deepEqual(S.yearTotals(st).map(y => y.year), ['2025', '2026']);
});

test('topArtists / topTracks con ventana', () => {
  const a = S.topArtists(st, 1, NOW);
  assert.equal(a[0].name, 'A'); assert.equal(a[0].ms, 1000000);                // 5 pistas de 200 s en noviembre
  assert.ok(Math.abs(a.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  const t = S.topTracks(st, 12, NOW);
  assert.equal(t[0].name, 'a1'); assert.equal(t[0].plays, 3);
  assert.equal(S.topArtists(st, 0, NOW).find(x => x.name === 'A').plays, 6);
});

test('descubrimientos: solo artistas cuya primera escucha cae en la ventana', () => {
  const d = S.discoveries(st, 1, NOW);
  assert.equal(d.count, 1); assert.equal(d.top[0].name, 'D');
  assert.equal(S.discoveries(st, 0, NOW), null);
});

test('rachas, récords y sesiones', () => {
  const r = S.streaks(st, NOW);
  assert.equal(r.longest.days, 3); assert.equal(r.longest.from, '2026-11-17'); assert.equal(r.current, 3);
  const rec = S.records(st);
  assert.equal(rec.bestDay.day, '2026-11-19');
  assert.equal(rec.repeat.count, 3); assert.equal(rec.repeat.name, 'a1');
  assert.ok(rec.longestSession.ms >= 600000);                               // las tres de A de la noche + B (< 30 min entre ellas)
});

test('persona: noctámbulo y día favorito', () => {
  const p = S.persona(st);
  assert.equal(p.key, 'noctambulo'); assert.equal(p.favDay, 'jueves'); assert.equal(p.peakHour, 22);
});

test('habits: saltos, aleatorio y plataformas', () => {
  const h = S.habits(st, 1, NOW);
  assert.ok(Math.abs(h.skipRate - 1 / 7) < 1e-9);                           // 1 salto de 7 pistas en noviembre
  assert.ok(Math.abs(h.shuffleRate - 1 / 7) < 1e-9);
  assert.equal(h.platforms[0].name, 'iPhone / iPad');
});

test('vinylStats: parte de tu escucha que ya tienes en vinilo, olvidados y artistas sin vinilo', () => {
  const { into } = C.aggregateHistory(ENTRIES, {});
  const collection = [{ artist: 'A', name: 'Disco A' }, { artist: 'Z', name: 'Disco Olvidado' }];
  const v = S.vinylStats({ history: into, collection, stats: st, months: 12, now: NOW });
  assert.ok(v.share > 0.5 && v.share < 1);                                  // A es la mayor parte
  assert.equal(v.topOwned[0].name, 'Disco A');
  assert.deepEqual(v.forgotten.map(a => a.name), ['Disco Olvidado']);
  assert.ok(v.withoutVinyl.map(a => a.name).includes('B') && !v.withoutVinyl.map(a => a.name).includes('A'));
});

test('collectionStyles', () => {
  const s = S.collectionStyles([{ tags: ['rap', 'pop'] }, { tags: ['rap'] }, { tags: [] }], 5);
  assert.deepEqual(s[0], { tag: 'rap', count: 2 });
});

test('formatos: fmtDur, niceCeil, fmtAxis, funFacts', () => {
  assert.equal(S.fmtDur(42 * 60000), '42 min');
  assert.equal(S.fmtDur(20000), '< 1 min'); assert.equal(S.fmtDur(0), '0 min');
  assert.equal(S.fmtDur(192 * 60000), '3 h 12 min');
  assert.equal(S.fmtDur(180 * 60000), '3 h');
  assert.equal(S.fmtDur((50 * 60 + 5) * 60000), '2 d 2 h');
  assert.equal(S.niceCeil(37), 50); assert.equal(S.niceCeil(100), 100); assert.equal(S.niceCeil(101), 200); assert.equal(S.niceCeil(0), 1);
  assert.equal(S.fmtAxis(90 * 60000), '90 min'); assert.equal(S.fmtAxis(300 * 60000), '5 h');
  const f = S.funFacts(90 * 60000);
  assert.equal(f.lps, 2); assert.equal(f.revolutions, 3000);               // 90 min × 33⅓ rpm
});

test('buildStats poda las canciones sueltas cuando hay demasiadas', () => {
  const many = Array.from({ length: 25100 }, (_, i) => e('2026-11-01T10:00:00Z', 'X', 'Y', 't' + i, 40000));
  many.push(e('2026-11-01T11:00:00Z', 'X', 'Y', 't0', 40000));
  const s = S.buildStats(many);
  assert.ok(Object.keys(s.tracks).length < 25100);
  assert.ok(s.tracks['X\u0001t0']);                                         // la repetida se conserva
});

test('export básico ("Datos de la cuenta"): se normaliza y alimenta las estadísticas', () => {
  const basic = [
    { endTime: '2026-11-19 22:10', artistName: 'A', trackName: 'a1', msPlayed: 200000 },
    { endTime: '2026-11-19 22:20', artistName: 'A', trackName: 'a1', msPlayed: 200000 },
    { endTime: '2026-11-18 09:00', artistName: 'B', trackName: 'b1', msPlayed: 15000 }
  ];
  const norm = C.normalizeEntries(basic);
  assert.equal(norm[0].ts, '2026-11-19T22:10:00Z'); assert.equal(norm[0].master_metadata_album_artist_name, 'A');
  const s2 = S.buildStats(norm);
  assert.equal(s2.total.rows, 3); assert.equal(s2.total.plays, 2);          // 15 s no cuenta como reproducción
  assert.equal(S.topArtists(s2, 1, NOW)[0].name, 'A');
  assert.equal(S.persona(s2).peakHour, 22);
  assert.deepEqual(C.aggregateHistory(norm, {}).into, {});                    // sin álbumes: no hay ranking de álbumes
  assert.deepEqual(C.normalizeEntries([ENTRIES[0]])[0], ENTRIES[0]);          // el ampliado pasa sin tocar
});
