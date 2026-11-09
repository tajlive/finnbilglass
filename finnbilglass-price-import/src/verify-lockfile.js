import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SAFE_FTP_VERSION = '6.2.3';

/** Fail closed when the package override is missing or lockfile uses an older FTP dependency. */
export function checkLockedFtp(project, lock) {
    if (project?.overrides?.['basic-ftp'] !== SAFE_FTP_VERSION) {
        throw new Error(`package.json må overstyre basic-ftp til eksakt ${SAFE_FTP_VERSION}.`);
    }
    if (!lock || typeof lock !== 'object' || !lock.packages || ![2, 3].includes(lock.lockfileVersion)) {
        throw new Error('package-lock.json mangler eller bruker ukjent format.');
    }
    if (lock.packages['']?.version !== project.version) {
        throw new Error('package-lock.json er ikke synkronisert med prosjektets versjon.');
    }
    const entries = Object.entries(lock.packages).filter(([path]) =>
        path === 'node_modules/basic-ftp' || path.endsWith('/node_modules/basic-ftp'));
    if (entries.length === 0) {
        throw new Error('Finner ikke basic-ftp i package-lock.json. Avhengighetstreet må undersøkes.');
    }
    for (const [path, info] of entries) {
        if (info?.version !== SAFE_FTP_VERSION) {
            throw new Error(`Utrygg basic-ftp-versjon i ${path}: ${info?.version || 'UKJENT'}.`);
        }
    }
    return entries.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const project = JSON.parse(readFileSync('package.json', 'utf8'));
        const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
        const count = checkLockedFtp(project, lock);
        console.log(`PASS: basic-ftp@${SAFE_FTP_VERSION} er låst i ${count} oppføring(er).`);
    } catch (e) {
        console.error(`STOPP: ${e.message} Ingen opplasting.`);
        process.exitCode = 2;
    }
}
