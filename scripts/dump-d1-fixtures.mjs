#!/usr/bin/env node
/**
 * Export the two approved catalog tables from FinnBilGlass staging D1 only.
 * Wrangler uses the existing local Cloudflare OAuth context; this script never
 * reads secrets from environment files or invokes the Cloudflare REST API.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPageQuery, buildWranglerArgs, parseReadOnlyD1Result } from './lib/staging-catalog-fixtures.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'data', 'fixtures');
const PAGE_SIZE = 10000;

function runSelect(sql) {
  let stdout;
  try {
    stdout = execFileSync('npx', ['wrangler', ...buildWranglerArgs(sql)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    throw new Error('FinnBilGlass staging D1 SELECT feilet; sjekk Wrangler-innlogging og staging-binding. Ingen feildetaljer logges.');
  }
  return parseReadOnlyD1Result(stdout);
}

function readTable(table) {
  const totalRows = Number(runSelect(`SELECT COUNT(*) AS n FROM ${table}`)[0]?.n);
  if (!Number.isSafeInteger(totalRows) || totalRows < 0) throw new Error(`ugyldig radantall for ${table}`);
  const rows = [];
  for (let offset = 0; offset < totalRows; offset += PAGE_SIZE) {
    rows.push(...runSelect(buildPageQuery(table, PAGE_SIZE, offset)));
  }
  if (rows.length !== totalRows) throw new Error(`radantall stemmer ikke for ${table}: ${rows.length} av ${totalRows}`);
  return rows;
}

function encode(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function writePrivate(path, content) {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function main() {
  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  chmodSync(OUT, 0o700);

  const gt = encode(readTable('ground_truth'));
  const priceList = encode(readTable('glass_prisliste'));
  const gtPath = join(OUT, 'ground-truth.jsonl');
  const pricePath = join(OUT, 'glass-prisliste.jsonl');
  writePrivate(gtPath, gt);
  writePrivate(pricePath, priceList);

  const manifest = {
    dumpet: new Date().toISOString(),
    source: 'FinnBilGlass staging D1 via Wrangler OAuth',
    ground_truth: {
      dumpet: gt.trimEnd().split('\n').length,
      sha256: createHash('sha256').update(gt).digest('hex'),
    },
    glass_prisliste: {
      dumpet: priceList.trimEnd().split('\n').length,
      sha256: createHash('sha256').update(priceList).digest('hex'),
    },
  };
  writePrivate(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Staging-fixtures oppdatert: ground_truth=${manifest.ground_truth.dumpet}, glass_prisliste=${manifest.glass_prisliste.dumpet}; SHA-256 skrevet i lokal gitignored manifest.`);
}

try { main(); } catch (error) {
  console.error(`FEIL: ${error.message}`);
  process.exitCode = 1;
}
