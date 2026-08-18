/**
 * conversation-v1/providers — tale-leverandør-abstraksjon.
 * Arkitekturen er IKKE hardwired til én leverandør. Bekreftelsessemantikk ligger OVER provider-laget.
 * Skifte fra OpenAI til Deepgram/Google osv. endrer ALDRI fitment-policy.
 */

/** Taletranskripsjon → tekst. Returnerer ALDRI autoritative identifikatorer — kun tekst. */
export interface SpeechToTextProvider {
  readonly providerId: string;
  transcribe(audio: AudioRef, opts?: { language?: string }): Promise<TranscriptResult>;
}

/** Tekst → tale (echo-back og spørsmål). */
export interface TextToSpeechProvider {
  readonly providerId: string;
  synthesize(text: string, opts?: { voice?: string }): Promise<{ audioRef: AudioRef }>;
}

/** Sanntids-toveis-tale (mikrofon-strøm, avbrudd). */
export interface RealtimeVoiceProvider {
  readonly providerId: string;
  openSession(opts?: Record<string, never>): Promise<RealtimeSessionHandle>;
}

export interface RealtimeSessionHandle {
  sendText(text: string): Promise<void>;
  onPartialTranscript(cb: (partial: string) => void): void;
  close(): Promise<void>;
}

export interface AudioRef {
  mediaType: string;          // f.eks. 'audio/webm' | 'audio/wav' | 'audio/ogg'
  data: ArrayBuffer | Uint8Array;
  durationMs?: number | null;
  sampleRate?: number | null;
  channelCount?: number | null;
}

export interface TranscriptResult {
  text: string;
  confidence: number | null;   // leverandørens egen skår — brukes ALDRI som fitment-evidens
  language: string | null;
  durationMs: number | null;
  provider: string;
  latencyMs: number;
  error?: string | null;
}

// ── Eksempel-abstraksjoner (ingen faktisk leverandør hardkodet; kredentialer kreves per provider) ──
export class NoopSpeechToTextProvider implements SpeechToTextProvider {
  readonly providerId = 'noop';
  async transcribe(): Promise<TranscriptResult> {
    throw new Error('SPEECH_PROVIDER_NOT_CONFIGURED');
  }
}

export class NoopTextToSpeechProvider implements TextToSpeechProvider {
  readonly providerId = 'noop';
  async synthesize(): Promise<{ audioRef: AudioRef }> {
    throw new Error('SPEECH_PROVIDER_NOT_CONFIGURED');
  }
}

export class NoopRealtimeVoiceProvider implements RealtimeVoiceProvider {
  readonly providerId = 'noop';
  async openSession(): Promise<RealtimeSessionHandle> {
    throw new Error('SPEECH_PROVIDER_NOT_CONFIGURED');
  }
}
