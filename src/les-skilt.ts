/**
 * LES SKILT — Workers AI-lesing av norsk kjennemerke (KLA-301 + Tom-korreksjon 2026-08-16).
 *
 * Kunden fotograferer bilens kjennemerke (nummerplaten) → AI leser skiltet →
 * regex-normalisering (2 bokstaver + 5 siffer) → SVV-oppslag gir hele bilen.
 *
 * Erstatter «Fyll inn bilen manuelt» — privatkunder skal ikke lete manuelt
 * etter merke/modell/år; bilde av skiltet er lavest friksjon og null gjetting.
 *
 * Norsk format: AB12345 (2 bokstaver + 5 siffer). EU-stripe, høy kontrast.
 */

export const LES_SKILT_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const LES_SKILT_VERSION = 'les-skilt-0.1';

/** AI-prompt: be om KUN skilt-tegnene. */
function skiltPrompt(): string {
  return JSON.stringify({
    task: 'Read the Norwegian license plate in this image.',
    instructions: [
      'The plate has exactly 2 letters and 5 digits, e.g. SU18018 or AB12345.',
      'Respond with ONLY the plate characters, e.g. SU18018. No quotes, no explanation, no JSON.',
      'If no plate is visible, respond with exactly: NONE',
    ],
  });
}

/** Regex-normalisering: 2 bokstaver + 5 siffer (tåler mellomrom, bindestrek, små bokstaver). */
export function normaliserSkilt(raw: string): { regnr: string; confidence: number } | null {
  if (!raw) return null;
  const m = raw.toUpperCase().match(/[A-ZÆØÅ]{2}\s*[-–—]?\s*\d{5}/);
  if (!m) return null;
  const regnr = m[0].replace(/[\s\-–—]/g, '');
  // AI leste det eksplisitt i svaret — høy tillit, men 0/O-forveksling er mulig i bokstaver.
  return { regnr, confidence: 0.9 };
}

export interface SkiltLesing {
  regnr: string | null;
  confidence: number;
  raatekst: string;
}

/**
 * Les kjennemerke fra et bilde (dataURL). Returnerer alltid en lesing —
 * regnr er null hvis AI-en ikke fant noe gyldig skilt.
 */
export async function lesSkilt(ai: Ai, imageDataUrl: string): Promise<SkiltLesing> {
  const prompt = skiltPrompt();
  try {
    const out = (await ai.run(LES_SKILT_MODEL, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    })) as { response?: string } | string;

    const raatekst = typeof out === 'string' ? out : (out?.response ?? '');
    if (raatekst.trim().toUpperCase() === 'NONE') {
      return { regnr: null, confidence: 0, raatekst };
    }
    const norm = normaliserSkilt(raatekst);
    return { regnr: norm?.regnr ?? null, confidence: norm?.confidence ?? 0, raatekst };
  } catch (e) {
    console.error('lesSkilt feilet:', e);
    return { regnr: null, confidence: 0, raatekst: '' };
  }
}
