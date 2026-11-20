import test from 'node:test';
import assert from 'node:assert/strict';
import { pack, unpack, split, mergeWish } from '../js/cloud.js';

test('pack/unpack: ida y vuelta con tildes y datos grandes', async () => {
  const obj = { a: 'Rosalía – Motomami', n: Array.from({ length: 5000 }, (_, i) => ({ i, t: 'canción ' + i })) };
  const s = await pack(obj);
  assert.match(s, /^[A-Za-z0-9+/=]+$/);
  assert.deepEqual(await unpack(s), obj);
  assert.ok(s.length < JSON.stringify(obj).length / 3, 'debe comprimir');
});

test('split: trozos de tamaño máximo y vacío', () => {
  assert.deepEqual(split('abcdefg', 3), ['abc', 'def', 'g']);
  assert.deepEqual(split('', 3), ['']);
  assert.equal(split('x'.repeat(1500000)).join('').length, 1500000);
});

test('mergeWish: une, "comprado" gana y no duplica', () => {
  const a = { id: 'a|x', status: 'wanted', addedAt: 1, checkedAt: 5 }, b = { id: 'a|y', status: 'wanted', addedAt: 3, checkedAt: 0 };
  const aBought = { ...a, status: 'bought', checkedAt: 1 };
  const m = mergeWish([a], [aBought, b]);
  assert.deepEqual(m.map(w => w.id), ['a|y', 'a|x']);
  assert.equal(m.find(w => w.id === 'a|x').status, 'bought');
  assert.equal(mergeWish([{ ...a, checkedAt: 9 }], [a])[0].checkedAt, 9);
  assert.deepEqual(mergeWish(undefined, undefined), []);
});
