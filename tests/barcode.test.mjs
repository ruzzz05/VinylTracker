import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBarcode, barcodeVariants } from '../js/barcode.js';

test('normalizeBarcode: valida longitud y dígito de control', () => {
  assert.equal(normalizeBarcode('5901234123457'), '5901234123457');      // EAN-13
  assert.equal(normalizeBarcode('5 901234-123457'), '5901234123457');    // con espacios y guiones
  assert.equal(normalizeBarcode('036000291452'), '036000291452');        // UPC-A
  assert.equal(normalizeBarcode('96385074'), '96385074');                // EAN-8
  assert.equal(normalizeBarcode('5901234123458'), null);                 // dígito de control mal
  assert.equal(normalizeBarcode('12345'), null);
  assert.equal(normalizeBarcode('abc'), null);
  assert.equal(normalizeBarcode(''), null);
  assert.equal(normalizeBarcode(null), null);
});

test('barcodeVariants: UPC <-> EAN con 0 delante', () => {
  assert.deepEqual(barcodeVariants('036000291452'), ['036000291452', '0036000291452']);
  assert.deepEqual(barcodeVariants('0036000291452'), ['0036000291452', '036000291452']);
  assert.deepEqual(barcodeVariants('5901234123457'), ['5901234123457']);
  assert.deepEqual(barcodeVariants('mal'), []);
});
