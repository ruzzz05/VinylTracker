import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../js/wishlist.js';
import { indexStores } from '../js/core.js';

const store = indexStores({ stores: { Apparell: { base: 'https://apparell.example', items: [
  ['Nirvana - Nevermind (LP Vinyl)', 'Nirvana', 25, 0, 'nirvana-nevermind', 0, ''],
  ['Rosalía - Motomami (Vinyl)', 'Rosalía', 30, 1, 'rosalia-motomami', 0, ''],
  ['Radiohead - OK Computer (Vinyl)', 'Radiohead', 28, 0, 'radiohead-ok', 1, '2026-12-01']
] } } });
const mk = (artist, name, extra = {}) => W.makeWish({ artist, name, now: 1000, ...extra });

test('makeWish: valida y calcula el id (álbum por clave, edición por Discogs)', () => {
  assert.equal(mk('', 'X'), null);
  assert.equal(mk('Nirvana', 'Nevermind').id, mk('NIRVANA', 'Nevermind (Remastered)').id);
  const r = mk('Nirvana', 'Nevermind', { kind: 'release', discogsId: 123 });
  assert.equal(r.id, 'r123'); assert.equal(r.kind, 'release');
  assert.equal(mk('A', 'B', { kind: 'release' }).kind, 'album');          // sin id de Discogs: es un álbum
});

test('addWish no duplica; removeWish quita', () => {
  const a = mk('Nirvana', 'Nevermind');
  let r = W.addWish([], a); assert.equal(r.list.length, 1);
  r = W.addWish(r.list, mk('Nirvana', 'Nevermind')); assert.equal(r.dup, true); assert.equal(r.list.length, 1);
  assert.deepEqual(W.removeWish(r.list, a.id), []);
});

test('markBought: anota como comprado (con o sin estar en la lista) y se puede deshacer', () => {
  const a = mk('Nirvana', 'Nevermind');
  let list = W.markBought([a], a, { price: '24,5'.replace(',', '.'), now: 5 });
  assert.equal(list[0].status, 'bought'); assert.equal(list[0].price, 24.5); assert.equal(list[0].boughtAt, 5);
  list = W.markBought([], mk('Rosalía', 'Motomami'), { price: '', now: 6 });
  assert.equal(list.length, 1); assert.equal(list[0].price, null);
  assert.equal(W.markBought([], mk('X', 'Y'), { price: 'abc' })[0].price, null);
  list = W.unbuy(list, list[0].id); assert.equal(list[0].status, 'wanted');
});

test('boughtKeys / wantedKeys: sirven para ocultar sugerencias', () => {
  const a = W.markBought([], mk('Nirvana', 'Nevermind'));
  const list = [...a, mk('Radiohead', 'OK Computer')];
  assert.ok(W.boughtKeys(list).has('nirvana|nevermind'));
  assert.ok(!W.boughtKeys(list).has('radiohead|ok computer'));
  assert.ok(W.wantedKeys(list).has('radiohead|ok computer'));
});

test('avisos: la primera comprobación no avisa; lo que aparece después, sí; si desaparece y vuelve, avisa otra vez', () => {
  let w = mk('Rosalía', 'Motomami');                         // en stock ya en la primera comprobación
  let r = W.checkItem(w, { storeIndex: store, now: 2 });
  assert.deepEqual(r.fresh, []); assert.equal(r.item.notified.length, 1);
  w = r.item;
  assert.deepEqual(W.checkItem(w, { storeIndex: store }).fresh, []);   // sigue igual: nada nuevo

  let n = W.checkItem(mk('Nirvana', 'Nevermind'), { storeIndex: store }).item;      // agotado: sin ofertas vivas
  assert.deepEqual(n.notified, []);
  const restock = indexStores({ stores: { Apparell: { base: 'https://apparell.example', items: [['Nirvana - Nevermind (LP Vinyl)', 'Nirvana', 25, 1, 'nirvana-nevermind', 0, '']] } } });
  r = W.checkItem(n, { storeIndex: restock });
  assert.equal(r.fresh.length, 1); assert.match(r.fresh[0], /^store:/);
  n = r.item;
  assert.deepEqual(W.checkItem(n, { storeIndex: restock }).fresh, []);              // ya avisado
  n = W.checkItem(n, { storeIndex: store }).item;                                    // vuelve a agotarse
  assert.equal(W.checkItem(n, { storeIndex: restock }).fresh.length, 1);             // y al reponer, avisa otra vez
});

test('avisos: la preventa cuenta como disponible', () => {
  const w = { ...mk('Radiohead', 'OK Computer'), notified: [] };
  const r = W.checkItem(w, { storeIndex: store });
  assert.equal(r.fresh.length, 1);
  assert.match(W.alertText({ item: w, fresh: r.fresh, offers: r.offers }), /preventa/);
});

test('avisos: Discogs (copias a la venta) y conserva lo último si no se consulta', () => {
  let w = { ...mk('Nada', 'Raro', { kind: 'release', discogsId: 9 }), notified: [] };
  let r = W.checkItem(w, { storeIndex: [], dg: { forSale: 3, lowest: 20, at: 1 } });
  assert.deepEqual(r.fresh, []);                           // primera consulta a Discogs: ya estaba a la venta, no avisa
  w = { ...w, dg: { forSale: 0, lowest: null, at: 1 } };
  r = W.checkItem(w, { storeIndex: [], dg: { forSale: 3, lowest: 20, at: 2 } });
  assert.deepEqual(r.fresh, ['discogs']);
  w = r.item;
  r = W.checkItem(w, { storeIndex: [] });                  // dg undefined: no se consultó
  assert.deepEqual(r.fresh, []); assert.equal(r.item.dg.forSale, 3);
  assert.match(W.alertText({ item: w, fresh: ['discogs'], offers: [] }), /Discogs/);
});

test('checkAll: solo mira lo deseado y devuelve los avisos', () => {
  const a = { ...mk('Radiohead', 'OK Computer'), notified: [] };
  const b = W.markBought([], mk('Rosalía', 'Motomami'))[0];
  const { list, alerts } = W.checkAll([a, b], { storeIndex: store, now: 7 });
  assert.equal(alerts.length, 1); assert.equal(alerts[0].item.name, 'OK Computer');
  assert.equal(list[1], b);                                  // lo comprado no se toca
  assert.equal(list[0].checkedAt, 7);
});

test('needsDiscogs: cada 6 h y solo lo deseado', () => {
  const w = mk('A', 'B');
  assert.equal(W.needsDiscogs(w, 10), true);
  assert.equal(W.needsDiscogs({ ...w, dg: { at: 10 } }, 20), false);
  assert.equal(W.needsDiscogs({ ...w, dg: { at: 10 } }, 10 + W.DG_TTL + 1), true);
  assert.equal(W.needsDiscogs({ ...w, status: 'bought' }, 10), false);
});

test('parseDiscogsResult / sortResults', () => {
  const raw = [
    { id: 1, title: 'Nirvana (2) - Nevermind', year: '1991', country: 'US', label: ['DGC'], format: ['CD', 'Album'], community: { have: 9000 }, thumb: 'https://i/t.jpg' },
    { id: 2, title: 'Nirvana - Nevermind', year: '2011', country: 'EU', label: ['Geffen', 'x'], format: ['Vinyl', 'LP', 'Album', 'Reissue'], community: { have: 100 }, cover_image: 'https://i/spacer.gif', thumb: 'https://i/ok.jpg', barcode: ['602537 1 2 3', '1'] },
    { id: 3, title: 'Sin separador' }, { title: 'Sin id - X' }
  ];
  const p = W.parseDiscogsResult(raw[1]);
  assert.equal(p.artist, 'Nirvana'); assert.equal(p.name, 'Nevermind'); assert.equal(p.isVinyl, true);
  assert.equal(p.image, 'https://i/ok.jpg'); assert.equal(p.detail, '2011 · EU · Geffen · LP, Reissue');
  assert.equal(W.parseDiscogsResult(raw[0]).artist, 'Nirvana');           // quita el "(2)"
  const sorted = W.sortResults(raw);
  assert.deepEqual(sorted.map(r => r.discogsId), [2, 1, 3]);              // vinilo primero; sin id fuera
});
