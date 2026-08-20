#!/usr/bin/env node
/**
 * i18n-keys-audit.mjs — Verifiser at alle t()-kall i kildekoden har nøkler i ALLE språkfiler.
 * Feiler (exit 1) hvis nøkler mangler i ett eller flere språk.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';

const SRC_DIR = 'src';
const LOCALES_DIR = 'locales';  // hvis dere bruker next-intl struktur

// Finn alle TypeScript/TSX-filer under src/
function findSourceFiles(dir, files = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findSourceFiles(fullPath, files);
    } else if (['.ts', '.tsx'].includes(extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

// Ekstraher t()-kall fra kildekode
function extractTKeys(content) {
  const keys = new Set();
  // Match t('key'), t("key"), t(`key`), t('namespace.key'), etc.
  // Håndterer namespace prefix: t('common:title')
  const regex = /t\(['"`]([^'"`\)]+)['"`]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

// Last språkfiler (antatt JSON-struktur)
function loadLocaleFiles() {
  const locales = {};
  try {
    const entries = readdirSync(LOCALES_DIR);
    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        const locale = entry.replace('.json', '');
        const content = readFileSync(join(LOCALES_DIR, entry), 'utf8');
        locales[locale] = flattenKeys(JSON.parse(content));
      }
    }
  } catch {
    // Hvis locales-mappen ikke eksisterer, prøv public/locales eller lignende
  }
  return locales;
}

// Flatten nested JSON keys til dot-notation
function flattenKeys(obj, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flattenKeys(value, fullKey, result);
    } else {
      result[fullKey] = true;
    }
  }
  return result;
}

function main() {
  console.log('🔍 i18n-keys audit starter...\n');

  // 1. Finn alle t()-kall i kildekoden
  const sourceFiles = findSourceFiles(SRC_DIR);
  const allKeys = new Set();
  
  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8');
    const keys = extractTKeys(content);
    for (const key of keys) {
      allKeys.add(key);
    }
  }

  console.log(`Fant ${allKeys.size} unike t()-nøkler i ${sourceFiles.length} kildefiler`);

  // 2. Last språkfiler
  const locales = loadLocaleFiles();
  const localeNames = Object.keys(locales);
  
  if (localeNames.length === 0) {
    console.log('⚠️  Ingen språkfiler funnet i locales/ — hopper over nøkkel-sjekk');
    console.log('ℹ️  Forventet struktur: locales/no.json, locales/en.json, etc.');
    return 0;
  }

  console.log(`Språkfiler funnet: ${localeNames.join(', ')}\n`);

  // 3. Sjekk hver nøkkel mot alle språk
  let hasErrors = false;
  
  for (const key of Array.from(allKeys).sort()) {
    const missing = [];
    for (const locale of localeNames) {
      if (!locales[locale][key]) {
        missing.push(locale);
      }
    }
    
    if (missing.length > 0) {
      console.log(`❌ MANGLENDE: "${key}" i ${missing.join(', ')}`);
      hasErrors = true;
    }
  }

  // 4. Sjekk også om språkfiler har ekstra nøkler som ikke brukes (advarsel)
  for (const locale of localeNames) {
    const localeKeys = Object.keys(locales[locale]);
    const unused = localeKeys.filter(k => !allKeys.has(k));
    if (unused.length > 0) {
      console.log(`⚠️  ${locale}: ${unused.length} ubrukte nøkler (f.eks. ${unused.slice(0, 5).join(', ')}${unused.length > 5 ? '...' : ''})`);
    }
  }

  console.log('\n' + '='.repeat(50));
  if (hasErrors) {
    console.log('❌ AUDIT FEILET: Nøkler mangler i ett eller flere språk');
    return 1;
  } else {
    console.log('✅ AUDIT OK: Alle t()-nøkler finnes i alle språkfiler');
    return 0;
  }
}

process.exit(main());