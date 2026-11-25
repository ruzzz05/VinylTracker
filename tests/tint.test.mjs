import test from 'node:test';
import assert from 'node:assert/strict';
import { dominant, normalizeTint, hashTint, rgbToHsl, hslToRgb, toHex } from '../js/tint.js';

const px = (...rgbs) => new Uint8ClampedArray(rgbs.flatMap(c => [...c, 255]));

test('toHex / hsl: ida y vuelta', () => {
  assert.equal(toHex([42, 111, 219]), '#2a6fdb');
  const back = hslToRgb(rgbToHsl([42, 111, 219])).map(Math.round);
  assert.deepEqual(back, [42, 111, 219]);
});

test('dominant: elige el tono más presente y vivo, ignorando negro, blanco y gris', () => {
  const data = px(...Array(30).fill([42, 111, 219]), ...Array(8).fill([244, 211, 94]), ...Array(40).fill([0, 0, 0]), ...Array(40).fill([255, 255, 255]), ...Array(40).fill([128, 128, 128]));
  const [r, g, b] = dominant(data);
  assert.ok(b > r && b > g, 'debe salir el azul: ' + [r, g, b]);
  assert.equal(dominant(px([0, 0, 0], [255, 255, 255], [120, 120, 120])), null);
  assert.equal(dominant(new Uint8ClampedArray(0)), null);
  assert.equal(dominant(new Uint8ClampedArray([200, 50, 50, 10])), null);          // transparente
});

test('normalizeTint: ni gris ni quemado, valido como ambiente', () => {
  for (const c of [[250, 250, 150], [10, 10, 80], [128, 120, 125], [255, 0, 0]]) {
    const hex = normalizeTint(c);
    assert.match(hex, /^#[0-9a-f]{6}$/);
    const [, s, l] = rgbToHsl(hex.slice(1).match(/../g).map(x => parseInt(x, 16)));
    assert.ok(s >= 0.45 && s <= 0.9, `saturación ${s} de ${hex}`);
    assert.ok(l >= 0.38 && l <= 0.6, `luminosidad ${l} de ${hex}`);
  }
});

test('hashTint: estable y distinto según el texto', () => {
  assert.equal(hashTint('Nirvana|Nevermind'), hashTint('Nirvana|Nevermind'));
  assert.notEqual(hashTint('Nirvana|Nevermind'), hashTint('Radiohead|OK Computer'));
  assert.match(hashTint(''), /^#[0-9a-f]{6}$/);
});
