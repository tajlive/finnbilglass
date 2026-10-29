import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supplierLdw } from '../src/supplier-sku-evidence.ts';
import { skillendeSporsmaal, filtrerPaaProfil } from '../src/vin-resolver.ts';

test('supplier LDW fact stays with its SKU, never leaks through shared Eurocode', () => {
  const code = '5179AGACIMW5V';
  assert.equal(supplierLdw('3151GNCM', code), false);
  assert.equal(supplierLdw('3151GNCM2', code), true);
  assert.equal(supplierLdw('UNKNOWN', code), undefined);
  assert.equal(supplierLdw('3151GNCM', '5179AGACIMW3V'), undefined);
  const rows = ['3151GNCM', '3151GNCM2', 'UNKNOWN'].map(varenr => ({
    varenr, attributter: { ldw: supplierLdw(varenr, code) ?? null },
  }));
  assert.deepEqual(skillendeSporsmaal(rows), ['ldw']);
  assert.deepEqual(filtrerPaaProfil(rows, { ldw: true }).map(x => x.varenr), ['3151GNCM2', 'UNKNOWN']);
  assert.deepEqual(filtrerPaaProfil(rows, { ldw: false }).map(x => x.varenr), ['3151GNCM', 'UNKNOWN']);
  assert.equal(filtrerPaaProfil(rows, {}).length, 3);
});
