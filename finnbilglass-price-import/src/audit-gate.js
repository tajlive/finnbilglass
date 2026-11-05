import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Strict parser for npm audit --json. Refuses to equate network errors with a clean scan. */
export function summarizeAudit(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
        throw new Error('Audit-rapporten er ikke et JSON-objekt.');
    }
    if (report.error) {
        const code = String(report.error.code || 'AUDIT_ERROR').slice(0, 80);
        throw new Error(`npm audit mislyktes: ${code}. Ingen opplasting.`);
    }
    const stats = report.metadata?.vulnerabilities;
    if (!stats || !Number.isInteger(stats.high) || !Number.isInteger(stats.critical)) {
        throw new Error('Audit-rapporten mangler gyldig HIGH/CRITICAL-opptelling. Ingen opplasting.');
    }
    const counts = {
        low: stats.low || 0,
        moderate: stats.moderate || 0,
        high: stats.high,
        critical: stats.critical
    };
    const vulnerabilities = Object.entries(report.vulnerabilities || {})
        .filter(([, v]) => v?.severity === 'high' || v?.severity === 'critical')
        .map(([name, v]) => ({
            name,
            severity: v.severity,
            direct: Boolean(v.isDirect),
            range: String(v.range ?? '').slice(0, 120),
            fix: v.fixAvailable === true ? 'compatible-fix'
                : v.fixAvailable === false ? 'manual-review' : 'possible-breaking-change',
            advisories: (v.via || []).filter(x => x && typeof x === 'object')
                .map(x => ({title: String(x.title || '').slice(0, 150), url: String(x.url || '').slice(0, 250)}))
                .slice(0, 5)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { counts, vulnerabilities, blocked: counts.high > 0 || counts.critical > 0 };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    try {
        const filename = process.argv[2];
        if (!filename) throw new Error('Oppgi JSON-rapportfil.');
        const report = JSON.parse(readFileSync(filename, 'utf8'));
        const result = summarizeAudit(report);
        const {low, moderate, high, critical} = result.counts;
        console.log(`NPM AUDIT: ${critical} kritiske, ${high} høye, ${moderate} moderate, ${low} lave funn.`);
        for (const v of result.vulnerabilities) {
            console.log(`- ${v.severity.toUpperCase()} ${v.name}: ${v.range} (${v.fix})`);
            for (const advisory of v.advisories) console.log(`  ${advisory.title}: ${advisory.url}`);
        }
        if (result.blocked && !process.argv.includes('--report-only')) {
            console.error('STOPP: HIGH/CRITICAL-funn gjenstår. Koden blir IKKE lastet opp.');
            process.exitCode = 1;
        }
    } catch (error) {
        console.error(`STOPP: ${error.message}`);
        process.exitCode = 2;
    }
}
