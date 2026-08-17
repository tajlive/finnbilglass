/**
 * Workers AI VisionProvider (KLA-301 + ECE R43).
 *
 * Leser av ECE R43-approval-nummer, eurocode, OEM-nummer og utstyrs-features
 * fra kundebilder av glassmerking (corner_marking). Returnerer alltid en
 * ImageObservation — ALDRI et produktvalg. Evidens-laget (evidence-fusion)
 * bestemmer utfallet.
 *
 * Modell: @cf/meta/llama-3.2-11b-vision-instruct (Workers AI, konto 80d5b1d5).
 */
import type {
  ImageInput,
  ImageObservation,
  VisionFeature,
  VisionIdentity,
  VisionProvider,
  VisionRequest,
} from './image-resolver';
import { normalizeR43 } from './evidence-fusion';

export const WORKERS_AI_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const WORKERS_AI_VISION_VERSION = 'workers-ai-llama-3.2-11b-vision-0.1';

const FEATURE_NAVN = 'camera|rain_sensor|heated|hud|antenna|acoustic|solar_coated|mirror_bracket|vin_window|panoramic';

function visjonPrompt(image: ImageInput): string {
  return JSON.stringify({
    task: 'Read the approval mark and all visible text on the car glass in the image.',
    imageRole: image.role,
    instructions: [
      'Respond with ONLY a single JSON object. No markdown, no explanations, no step-by-step text, no code fences.',
      'FIRST classify the image: bildetType must be "naerbilde_merking" ONLY IF the image is a CLOSE-UP of a small stamped/etched label on glass (a corner of a windshield). If the image shows a whole car, a whole windshield, a workshop, a room, a person, or anything that is NOT a close-up of the glass marking — set bildetType to "annet".',
      'Schema: {"bildetType":"naerbilde_merking|annet","r43":{"value":"43R-004592","confidence":0..1,"explanation":"short"},"eurocodes":[{"value":"string","confidence":0..1,"explanation":"short"}],"oemNumbers":[{"value":"string","confidence":0..1,"explanation":"short"}],"produsent":"string|null","glasstype":"string|null","dotNummer":"string|null","features":[{"name":"camera|rain_sensor|heated|hud|antenna|acoustic|solar_coated|mirror_bracket|vin_window|panoramic","value":true|false|null,"confidence":0..1}],"warnings":["string"]}',
      'Set r43.value to null if no 43R number is clearly readable. Never invent numbers.',
      'CRITICAL: if bildetType is "annet", you MUST set r43.value to null, eurocodes to [], oemNumbers to [] and add a warning "bildet er ikke et nærbilde av merkingen". You cannot read a tiny stamp from a picture of a whole car.',
      'The 43R approval number sits under/next to a circle with E and a country code (E1, E2...).',
      '0/O, 1/I, 5/S are easily confused in stamps — lower confidence when unsure.',
    ],
  });
}

/** Modellen kan legge ekstra tekst rundt JSON — klipp ut første komplett JSON-objekt. */
function stripJson(s: string): string {
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : s;
}

function parseIdentities(x: unknown): VisionIdentity[] {
  if (!Array.isArray(x)) return [];
  const out: VisionIdentity[] = [];
  for (const item of x) {
    if (item && typeof item === 'object') {
      const v = (item as Record<string, unknown>).value;
      if (typeof v === 'string' && v.trim()) {
        out.push({
          value: v.trim(),
          confidence: clampNum((item as Record<string, unknown>).confidence),
          explanation: typeof (item as Record<string, unknown>).explanation === 'string'
            ? (item as Record<string, unknown>).explanation as string
            : undefined,
        });
      }
    }
  }
  return out;
}

function parseFeatures(x: unknown): VisionFeature[] {
  if (!Array.isArray(x)) return [];
  const out: VisionFeature[] = [];
  for (const item of x) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      if (typeof rec.name === 'string' && rec.name.trim()) {
        out.push({
          name: rec.name.trim(),
          value: rec.value === true || rec.value === false ? rec.value : null,
          confidence: clampNum(rec.confidence),
          explanation: typeof rec.explanation === 'string' ? rec.explanation as string : undefined,
        });
      }
    }
  }
  return out;
}

function clampNum(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export class WorkersAIVisionProvider implements VisionProvider {
  modelVersion = WORKERS_AI_VISION_VERSION;

  constructor(private ai: Ai) {}

  async observe(request: VisionRequest): Promise<ImageObservation> {
    const { image } = request;
    let rawText = '';
    try {
      const out = await this.ai.run(WORKERS_AI_VISION_MODEL, {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: image.imageRef } },
              { type: 'text', text: visjonPrompt(image) },
            ],
          },
        ],
      });
      rawText = typeof out === 'string' ? out : JSON.stringify(out);
    } catch (e) {
      return {
        imageId: image.id,
        role: image.role,
        modelVersion: this.modelVersion,
        warnings: [`Workers AI-feil: ${e instanceof Error ? e.message : 'ukjent feil'}`],
        eurocodes: [],
        oemNumbers: [],
        r43Numbers: [],
        features: [],
        similarities: [],
      };
    }

    return this.parseObservation(rawText, image);
  }

  private parseObservation(rawText: string, image: ImageInput): ImageObservation {
    let j: Record<string, unknown> | null = null;
    try {
      j = JSON.parse(stripJson(rawText)) as Record<string, unknown>;
      // Workers AI wrapper svaret noen ganger i {"response":"{...}"} — pakk ut innerste JSON.
      if (j && typeof j.response === 'string' && j.response.trim().startsWith('{')) {
        const inner = JSON.parse(j.response) as Record<string, unknown>;
        if (inner && typeof inner === 'object') j = inner;
      }
    } catch {
      // Fallback til regex under.
    }

    const base: ImageObservation = {
      imageId: image.id,
      role: image.role,
      modelVersion: this.modelVersion,
      rawText: rawText.slice(0, 4000),
      eurocodes: [],
      oemNumbers: [],
      r43Numbers: [],
      features: [],
      similarities: [],
      warnings: [],
    };

    // Klassifiserings-gate: «annet» = ikke et nærbilde av glassmerkingen
    // (hel bil, hel frontrute, verksted, rom, person…). Da er ALL tekst-
    // lesing upålitelig — r43/eurocode/OEM forkastes (hallusinasjonsvern,
    // bevist av bilde av hel Peugeot som «leste» 43R-004592).
    let erNaerbilde = true;
    if (j && typeof j === 'object') {
      if (Array.isArray(j.warnings)) {
        base.warnings = j.warnings.filter((w): w is string => typeof w === 'string').slice(0, 10);
      }
      // Klassifiserings-gate: «annet» = ikke et nærbilde av glassmerkingen
      // (hel bil, hel frontrute, verksted, rom, person…). Da er ALL tekst-
      // lesing upålitelig — r43/eurocode/OEM forkastes (hallusinasjonsvern,
      // bevist av bilde av hel Peugeot som «leste» 43R-004592).
      const bildetType = typeof j.bildetType === 'string' ? j.bildetType.trim().toLowerCase() : '';
      erNaerbilde = bildetType === 'naerbilde_merking' || (bildetType === '' && !base.warnings.some((w) => /ikke et nærbilde|not a close/i.test(w)));
      if (erNaerbilde) {
        base.eurocodes = parseIdentities(j.eurocodes);
        base.oemNumbers = parseIdentities(j.oemNumbers);
        base.features = parseFeatures(j.features);
        const r43Field = j.r43;
        if (r43Field && typeof r43Field === 'object') {
          const rec = r43Field as Record<string, unknown>;
          if (typeof rec.value === 'string' && normalizeR43(rec.value)) {
            base.r43Numbers = [
              {
                value: rec.value,
                confidence: clampNum(rec.confidence),
                explanation: typeof rec.explanation === 'string' ? rec.explanation as string : undefined,
              },
            ];
          }
        } else if (typeof r43Field === 'string' && normalizeR43(r43Field)) {
          base.r43Numbers = [{ value: r43Field, confidence: 0.9 }];
        }
      } else {
        base.warnings.push('bildet er ikke et nærbilde av glassmerkingen — tekstlesing avvist');
      }
    }

    // Fallback: regex-søk i råteksten hvis JSON-tolkning mangler r43.
    // Modellen er en instruct-modell som ofte svarer i tekst — nummeret står da
    // i teksten. Men den HALLUSINERER også (hele-bil-bildet «leste» 43R-004592),
    // så fallback får LAV confidence (0.55): aldri alene PINPOINT-verdig, og
    // kun når modellen selv hevder nærbilde (ikke «annet»-svar).
    if ((!base.r43Numbers || base.r43Numbers.length === 0) && erNaerbilde) {
      const m = /43R\s*[-–—]?\s*\d{4,7}/i.exec(rawText);
      if (m) base.r43Numbers = [{ value: m[0], confidence: 0.55, explanation: 'AI-tekst-tolkning (regex) — lav tillit, må bekreftes av kunden' }];
    }

    return base;
  }
}
