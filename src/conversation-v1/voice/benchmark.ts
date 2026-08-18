/**
 * conversation-v1/voice/benchmark — leverandør-nøytral tale-benchmark-harness (fra C1-designet).
 * Kjøper INGENTING automatisk. Hvis autoriserte kredentialer ikke finnes → ACCESS_REQUIRED.
 * Primærmetrikker: registreringsnummer-exact-match, identifikator-exact-match,
 * false-confirmation-rate, korreksjonshåndtering, latency. Ordinær WER er sekundær.
 */
import type { SpeechToTextProvider, TranscriptResult } from '../providers.js';

export interface BenchmarkUtterance {
  id: string;
  category: 'conversation' | 'registration' | 'make_model' | 'eurocode' | 'oe' | 'mixed' | 'noisy' | 'telephone' | 'correction';
  text: string;            // gull-transkript
  expectedIdentifiers?: { type: 'registrationNumber' | 'OE' | 'eurocode'; value: string }[];
}

export interface BenchmarkResult {
  providerId: string;
  timestamp: string;
  totals: {
    utterances: number;
    wer: number;
    registrationExactMatch: number;   // andel 0..1
    identifierExactMatch: number;     // andel 0..1
    falseConfirmationRate: number;    // andel feil transkript som pipelinen ville bekreftet
    correctionHandled: number;        // andel korreksjonsytringer som bevarer siste verdi
    latencyP50Ms: number;
    latencyP95Ms: number;
  };
  perCategory: Record<string, { wer: number; identifierExactMatch: number }>;
  access: 'ACCESS_REQUIRED' | 'BENCHMARKED';
  notes: string[];
}

const GOLD: BenchmarkUtterance[] = [
  { id: 'b1', category: 'registration', text: 'SU 18018', expectedIdentifiers: [{ type: 'registrationNumber', value: 'SU18018' }] },
  { id: 'b2', category: 'registration', text: 'SU atten null atten', expectedIdentifiers: [{ type: 'registrationNumber', value: 'SU18018' }] },
  { id: 'b3', category: 'registration', text: 'KE fire to en en null', expectedIdentifiers: [{ type: 'registrationNumber', value: 'KE42110' }] },
  { id: 'b4', category: 'oe', text: 'sju H null åtte fire fem en null en H', expectedIdentifiers: [{ type: 'OE', value: '7H0845101H' }] },
  { id: 'b5', category: 'oe', text: 'sju H null åtte fire fem en null en F', expectedIdentifiers: [{ type: 'OE', value: '7H0845101F' }] },
  { id: 'b6', category: 'oe', text: 'sju E null åtte fire fem null ni ni H', expectedIdentifiers: [{ type: 'OE', value: '7E0845099H' }] },
  { id: 'b7', category: 'eurocode', text: 'åtte fem syv ni A G S G Y A V Z en B', expectedIdentifiers: [{ type: 'eurocode', value: '8579AGSGYAVZ1B' }] },
  { id: 'b8', category: 'eurocode', text: 'fem tre åtte en A G A C M V W en T', expectedIdentifiers: [{ type: 'eurocode', value: '5381AGACMVW1T' }] },
  { id: 'b9', category: 'conversation', text: 'Jeg trenger ny frontrute til bilen min' },
  { id: 'b10', category: 'make_model', text: 'Volkswagen Transporter T5' },
  { id: 'b11', category: 'make_model', text: 'Mercedes CLA' },
  { id: 'b12', category: 'mixed', text: 'syv E null åtte fire fem null ni ni A A N V B' },
  { id: 'b13', category: 'correction', text: 'Nei, ikke H. F. sju H null åtte fire fem en null en F' },
  { id: 'b14', category: 'noisy', text: 'Hallo? Jeg ringer angående frontruta. SU 18018, Transporter' },
  { id: 'b15', category: 'telephone', text: 'Jeg skal lese nummeret. sju H null åtte fire fem en null en H' },
];

/**
 * Kjør benchmark mot en gitt provider. Uten autorisert provider-kredential → ACCESS_REQUIRED.
 * `transcriber` injiseres; hvis ingen er konfigurert rapporteres ACCESS_REQUIRED (ingen kjøp).
 */
export async function runBenchmark(
  provider: SpeechToTextProvider | null,
  opts: { gold?: BenchmarkUtterance[]; sampleRate?: number } = {},
): Promise<BenchmarkResult> {
  const gold = opts.gold ?? GOLD;
  const base: BenchmarkResult = {
    providerId: provider?.providerId ?? 'none',
    timestamp: new Date().toISOString(),
    totals: { utterances: gold.length, wer: 0, registrationExactMatch: 0, identifierExactMatch: 0, falseConfirmationRate: 0, correctionHandled: 0, latencyP50Ms: 0, latencyP95Ms: 0 },
    perCategory: {},
    access: 'ACCESS_REQUIRED',
    notes: [],
  };
  if (!provider) {
    base.notes.push('Ingen autoriserte tale-leverandør-kredentialer funnet. INGEN tjeneste kjøpt. Rapporter ACCESS_REQUIRED.');
    return base;
  }
  // (Implementert når kredentialer finnes og arkitekt godkjenner kjøring.)
  base.notes.push('Provider til stede — benchmark-kjøring krever arkitekt-godkjenning og autorisert tilgang.');
  return base;
}
