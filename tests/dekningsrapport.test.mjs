// Dekningsrapporten (Oppgave 5) kjører på repo-data uten eksterne API-kall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('dekningsrapport: kjører lokalt, exit 0, inneholder metrikker', () => {
  const out = execFileSync('node', ['scripts/dekningsrapport.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /DEKNINGSRAPPORT/);
  assert.match(out, /approved uten manuell behandling/);
  assert.match(out, /needs_verification/);
  assert.match(out, /Fasit-saker \(verifisert grunnlag\): \d+/);
});

test('dekningsrapport: 118 fasit-saker gir godkjennings-andeler som summerer', () => {
  const out = execFileSync('node', ['scripts/dekningsrapport.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const m = out.match(/Fasit-saker \(verifisert grunnlag\): (\d+)/);
  assert.ok(m, 'mangler fasit-total');
  const total = Number(m[1]);
  const approved = Number((out.match(/approved uten manuell behandling: (\d+)/) ?? [])[1] ?? 0);
  const nv = Number((out.match(/needs_verification:\s+(\d+)/) ?? [])[1] ?? 0);
  assert.equal(approved + nv, total, 'approved + needs_verification må summere til total');
});
