import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {checkLockedFtp, SAFE_FTP_VERSION} from '../src/verify-lockfile.js';
const project = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = (v, version=project.version) => ({lockfileVersion:3, packages:{'':{version},'node_modules/basic-ftp':{version:v}}});
test('sårbar FTP-transitivavhengighet er overstyrt til dokumentert sikker versjon', () => {
    assert.equal(SAFE_FTP_VERSION, '6.2.3');
    assert.equal(project.overrides['basic-ftp'], SAFE_FTP_VERSION);
    assert.equal(checkLockedFtp(project, lock(SAFE_FTP_VERSION)), 1);
});
test('gammel sårbar FTP-avhengighet fører til sikkerhetsstopp', () => {
    assert.throws(()=>checkLockedFtp(project, lock('5.3.1')), /Utrygg basic-ftp-versjon/);
});
test('låst fil kan ikke inneholde en skjult nestet sårbar kopi', () => {
    const l=lock('6.2.3'); l.packages['node_modules/get-uri/node_modules/basic-ftp']={version:'5.3.1'};
    assert.throws(()=>checkLockedFtp(project,l),/Utrygg basic-ftp-versjon/);
});
test('manglende eller gammel låsfil blokkeres', () => {
    assert.throws(()=>checkLockedFtp(project,{lockfileVersion:3,packages:{'':{version:project.version}}}), /Finner ikke basic-ftp/);
    assert.throws(()=>checkLockedFtp(project,lock('6.2.3','1.0.11')), /ikke synkronisert/);
});
