// Regresjonstest: inquiry-16 (Porsche 996 1998 feilmatchet til 993-rute «95-97-»)
import { describe, it, expect } from 'vitest';

describe('L2 Pilkington år-slack', () => {
  // Direkte enhetstest av logikken: modellstreng «95-97-» + bilår
  // Før fiks: ±1-slack på år-hint gjorde 95-97+1=98 → 1998 matchet feil generasjon.
  it('modellAarIntervall(«95-97-») gir strengt intervall uten slack i matcher', async () => {
    const { parseAar, matcherAar } = await import('../src/aar-parser');
    const iv = parseAar('911 993 CARRERA CPE CABRIO 95-97-');
    expect(iv).toEqual({ start: 1995, slutt: 1997 });
    // 1998 må ALDRI matche 95-97 (generasjonsskifte til 996)
    expect(matcherAar({ start: iv!.start - 0, slutt: iv!.slutt }, 1998)).toBe(false);
    // men med gammel +1-slack ville den: dokumenterer bugen
    expect(matcherAar({ start: iv!.start - 1, slutt: iv!.slutt + 1 }, 1998)).toBe(true);
  });
});
