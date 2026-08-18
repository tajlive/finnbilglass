/**
 * conversation-v1/identifiers — identifikator-pipeline (norsk).
 * Tale/bilde → PARSED → ECHO-BACK/CONFIRMATION → ACCEPTED.
 * Tale alene er ALDRI bekreftelse; VIN kommer fra troverdig kjøretøy-data, ikke fra kunden.
 */
import type { FitmentSession, IdentifierObservation } from './session.js';

const LETTERS: Record<string, string> = {
  a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', h: 'H', i: 'I', j: 'J', k: 'K', l: 'L', m: 'M', n: 'N', o: 'O', p: 'P', q: 'Q', r: 'R', s: 'S', t: 'T', u: 'U', v: 'V', w: 'W', x: 'X', y: 'Y', z: 'Z',
  æ: 'Æ', ø: 'Ø', å: 'Å',
  ess: 'S', eks: 'X', 'dobbelt-u': 'W', 'dobbel-u': 'W', 'dobbelt-ve': 'W', 'dobbel v': 'W',
};

const NUMBERS: Record<string, string> = {
  null: '0', en: '1', et: '1', to: '2', tre: '3', fire: '4', fem: '5', seks: '6', sju: '7', syv: '7', åtte: '8', ni: '9',
  ti: '10', elleve: '11', tolv: '12', tretten: '13', fjorten: '14', femten: '15', seksten: '16', sytten: '17', atten: '18', nitten: '19',
  tjue: '20', tretti: '30', førti: '40', femti: '50', seksti: '60', sytti: '70', åtti: '80', nitti: '90',
};

export const REGNR_RE = /^[A-ZÆØÅ]{2}\d{5}$/;

export function tokenize(text: string): string[] {
  const cleaned = String(text).toLowerCase().replace(/[.,;:!?]/g, ' ').replace(/-/g, ' ');
  return cleaned.split(/\s+/).filter(Boolean);
}

/** Parse norsk tale → kanonisk identifikator (rekkefølge bevart; interleaved OE støttes). */
export function parseSpokenIdentifier(text: string): { ok: boolean; parsed?: string; raw?: string; error?: string } {
  const tokens = tokenize(text);
  const sequence: string[] = [];
  const consumed: string[] = [];
  for (const tok of tokens) {
    if (/^[a-zæøå]$/.test(tok)) { sequence.push(LETTERS[tok]); consumed.push(tok); continue; }
    if (LETTERS[tok]) { sequence.push(LETTERS[tok]); consumed.push(tok); continue; }
    if (NUMBERS[tok]) { sequence.push(...NUMBERS[tok].split('')); consumed.push(tok); continue; }
    if (/^\d+$/.test(tok)) { sequence.push(...tok.split('')); consumed.push(tok); continue; }
    if (/^[a-zæøå]{2,3}$/.test(tok) && !NUMBERS[tok]) {
      for (const ch of tok) sequence.push(LETTERS[ch] ?? ch.toUpperCase());
      consumed.push(tok);
      continue;
    }
    if (/^[a-zæøå0-9]+$/.test(tok) && /\d/.test(tok) && /[a-z]/.test(tok)) {
      for (const ch of tok) sequence.push(/[a-zæøå]/.test(ch) ? LETTERS[ch] : ch);
      consumed.push(tok);
      continue;
    }
  }
  if (consumed.length === 0) return { ok: false, error: 'ingen gjenkjennelige tegn' };
  return { ok: true, parsed: sequence.join(''), raw: tokens.join(' ') };
}

/** Echo-back: "SU18018" → "S-U, 1-8-0-1-8". */
export function formatEchoBack(identifier: string): string {
  const letters = (identifier.match(/^[A-ZÆØÅ]{1,3}/) ?? [''])[0];
  const rest = identifier.slice(letters.length);
  return `${letters.split('').join('-')}${letters && rest ? ', ' : ''}${rest.split('').join('-')}`;
}

export function isValidRegnr(parsed: string): boolean {
  return REGNR_RE.test(parsed);
}

/** Pipeline-steg 1–2: tale → parset identifikator i CONFIRMATION_REQUIRED. */
export function submitSpokenIdentifier(session: FitmentSession, rawText: string, identifierType: IdentifierObservation['identifierType']): { ok: boolean; identifier?: IdentifierObservation; echoBack?: string; error?: string } {
  const parsedRes = parseSpokenIdentifier(rawText);
  if (!parsedRes.ok || !parsedRes.parsed) return { ok: false, error: `kunne ikke parse identifikator: ${rawText}` };
  if (identifierType === 'registrationNumber' && !isValidRegnr(parsedRes.parsed)) {
    session.audit({ actor: 'stt', action: 'identifier_parse_failed', channel: session.channel, raw: rawText, normalized: parsedRes.parsed, notes: 'ugyldig regnr-format' });
    return { ok: false, error: `'${formatEchoBack(parsedRes.parsed)}' ser ikke ut som et norsk registreringsnummer` };
  }
  const entry: IdentifierObservation = {
    identifierId: `id-${session.auditEvents.length}-${Date.now()}`,
    identifierType, rawText, parsed: parsedRes.parsed, echoBack: formatEchoBack(parsedRes.parsed),
    state: 'CONFIRMATION_REQUIRED', modality: 'SPEECH', recordedAt: new Date().toISOString(),
  };
  session.identifierObservations.push(entry);
  session.pendingConfirmations.push(entry);
  session.audit({ actor: 'stt', action: 'identifier_parsed', channel: session.channel, tool: 'submit_identifier_candidate', raw: rawText, normalized: entry.parsed, confirmationStatus: 'CONFIRMATION_REQUIRED' });
  return { ok: true, identifier: entry, echoBack: entry.echoBack };
}

/** Skrevet regnr (WEB_CHAT): kunden tastet tegnene = eksplisitt handling → CONFIRMED. */
export function submitTypedRegistration(session: FitmentSession, rawText: string): { ok: boolean; identifier?: IdentifierObservation; error?: string } {
  const parsed = rawText.toUpperCase().replace(/\s+/g, '');
  if (!isValidRegnr(parsed)) return { ok: false, error: 'ugyldig registreringsnummer' };
  const entry: IdentifierObservation = {
    identifierId: `id-${session.auditEvents.length}-${Date.now()}`,
    identifierType: 'registrationNumber', rawText, parsed, echoBack: parsed,
    state: 'CONFIRMED', modality: 'TYPED', confirmedAt: new Date().toISOString(), recordedAt: new Date().toISOString(),
  };
  session.identifierObservations.push(entry);
  session.audit({ actor: 'customer', action: 'identifier_typed_confirmed', channel: session.channel, tool: 'submit_identifier_candidate', raw: rawText, normalized: parsed, confirmationStatus: 'CONFIRMED' });
  return { ok: true, identifier: entry };
}

/** Skrevet OE/partnr: høy-risiko også skrevet → CONFIRMATION_REQUIRED. */
export function submitTypedIdentifier(session: FitmentSession, rawText: string, identifierType: 'OE' | 'partNumber'): { ok: boolean; identifier?: IdentifierObservation; echoBack?: string; error?: string } {
  const parsedRes = parseSpokenIdentifier(rawText);
  if (!parsedRes.ok || !parsedRes.parsed) return { ok: false, error: 'kunne ikke parse identifikator' };
  const entry: IdentifierObservation = {
    identifierId: `id-${session.auditEvents.length}-${Date.now()}`,
    identifierType, rawText, parsed: parsedRes.parsed, echoBack: parsedRes.parsed,
    state: 'CONFIRMATION_REQUIRED', modality: 'TYPED', recordedAt: new Date().toISOString(),
  };
  session.identifierObservations.push(entry);
  session.pendingConfirmations.push(entry);
  session.audit({ actor: 'customer', action: 'identifier_parsed', channel: session.channel, tool: 'submit_identifier_candidate', raw: rawText, normalized: entry.parsed, confirmationStatus: 'CONFIRMATION_REQUIRED' });
  return { ok: true, identifier: entry, echoBack: entry.echoBack };
}

/** Pipeline-steg 3: kundebekreftelse av echo-back. Kun CONFIRMED når kunden sier ja. */
export function confirmIdentifier(session: FitmentSession, parsedValue: string, { confirmed = true, channel = session.channel } = {}): { ok: boolean; identifier?: IdentifierObservation; error?: string } {
  const entry = session.pendingConfirmations.find((e) => e.parsed === parsedValue);
  if (!entry) return { ok: false, error: `ingen ventende identifikator '${parsedValue}'` };
  entry.state = confirmed ? 'CONFIRMED' : 'REJECTED';
  entry.confirmedAt = new Date().toISOString();
  session.pendingConfirmations = session.pendingConfirmations.filter((e) => e !== entry);
  session.audit({
    actor: 'customer', action: confirmed ? 'identifier_confirmed' : 'identifier_rejected', channel,
    tool: 'confirm_identifier', raw: entry.rawText, normalized: entry.parsed, confirmationStatus: entry.state, notes: entry.echoBack,
  });
  return { ok: true, identifier: entry };
}

/** Samle CONFIRMED-identifikatorer av en type. */
export function confirmedIdentifiers(session: FitmentSession, identifierType: IdentifierObservation['identifierType']): string[] {
  return session.identifierObservations
    .filter((e) => e.state === 'CONFIRMED' && e.identifierType === identifierType)
    .map((e) => e.parsed);
}
