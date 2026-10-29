import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REALTIME_MODEL, realtimeSession, voiceTool, VOICE_INSTRUCTIONS, VOICE_NAME, VOICE_NAMES, VOICE_PROMPT_VERSION } from '../src/voice-lab';
import { voiceLabUi } from '../src/voice-lab-ui';

test('stemmelaben bruker norsk Marin-stemme med avgrensede verktøy', () => {
  const session = realtimeSession();
  assert.equal(VOICE_NAME, 'marin');
  assert.equal(session.model, DEFAULT_REALTIME_MODEL);
  assert.equal(session.audio.output.voice, 'marin');
  assert.match(session.instructions, new RegExp(VOICE_PROMPT_VERSION));
  assert.match(VOICE_INSTRUCTIONS, /norsk bokmål/i);
  assert.match(VOICE_INSTRUCTIONS, /kvinnelig stemme/i);
  assert.match(VOICE_INSTRUCTIONS, /tilbyr ikke timebestilling/i);
  assert.match(VOICE_INSTRUCTIONS, /to bokstaver og fem tall/i);
  assert.match(VOICE_INSTRUCTIONS, /special_plate satt til true/i);
  assert.match(VOICE_INSTRUCTIONS, /selger ikke montering/i);
  assert.match(VOICE_INSTRUCTIONS, /Klarna eller betalingskort/i);
  assert.doesNotMatch(VOICE_INSTRUCTIONS, /glass alene eller glass med montering/i);
  assert.doesNotMatch(JSON.stringify(session.tools), /onsket_tid/);
  assert.deepEqual(session.tools.map((tool) => tool.name), ['lookup_vehicle', 'draft_inquiry']);
});

test('stemmelaben støtter avgrenset A/B-valg av stemme', () => {
  assert.deepEqual(VOICE_NAMES, ['marin', 'coral', 'shimmer', 'sage']);
  assert.equal(realtimeSession(DEFAULT_REALTIME_MODEL, 'ny_frontrute', 'varm', 'coral').audio.output.voice, 'coral');
});

test('stemmelab-siden har mikrofon og tydelige grenser', async () => {
  const response = voiceLabUi(), html = await response.text();
  assert.match(html, /Arch aXN stemmelab/);
  assert.match(html, /Marin · varm og tydelig/);
  assert.match(html, /Coral · vennlig kundeservice/);
  assert.match(html, /X-Voice-Name/);
  assert.match(html, /Ny frontrute/);
  assert.match(html, /Nytt panoramaglass/i);
  assert.match(html, /Finnbilglass utfører eller selger ikke montering/i);
  assert.match(html, /Kort og effektiv/);
  assert.match(html, /getUserMedia/);
  assert.doesNotMatch(html, /glass med montering/i);
  assert.equal(response.headers.get('Permissions-Policy'), 'microphone=(self)');
});

test('stemmelab avviser uklart registreringsnummer før oppslag', async () => {
  const request = new Request('https://finnbilglass.no/api/ops/voice/tool', {
    method: 'POST',
    body: JSON.stringify({ name: 'lookup_vehicle', arguments: { regnr: 'ABC123', confirmed: true } }),
  });
  const response = await voiceTool(request, {} as never);
  const data = await response.json() as { error?: string };

  assert.equal(response.status, 422);
  assert.match(data.error ?? '', /to bokstaver og fem tall/i);
});

test('stemmelab tillater uttrykkelig bekreftet spesialskilt', async () => {
  const request = new Request('https://finnbilglass.no/api/ops/voice/tool', {
    method: 'POST',
    body: JSON.stringify({ name: 'lookup_vehicle', arguments: { regnr: 'TOMARNE', confirmed: true, special_plate: true } }),
  });
  const response = await voiceTool(request, { SVV_API_KEY: undefined } as never);
  const data = await response.json() as { ok?: boolean; regnr?: string; found?: boolean };

  assert.equal(response.status, 200);
  assert.deepEqual(data, { ok: true, regnr: 'TOMARNE', found: false, vehicle: null });
});
