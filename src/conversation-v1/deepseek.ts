/**
 * conversation-v1/deepseek — Digital Glass Expert (konversasjonslag).
 * DeepSeek = KONVERSASJONS-motor med begrensede verktøy. Aldri fitment-avgjørende.
 * Secret: kun server-side (Worker secret-binding). Aldri i frontend, aldri committet, aldri logget.
 *
 * DeepSeek KAN: forstå naturlig språk, forklare terminologi, kalle begrensede verktøy,
 *   hente ACTIVE domene-kunnskap, tolke svar til strukturerte observasjoner, veilede foto.
 * DeepSeek KAN IKKE: sette EXACT, velge selectedGlass, finne på OE, finne på tilbehør,
 *   markere tilbehør nødvendig, omgå bekreftelse, endre resolver-tilstand direkte.
 */
export const DEEPSEEK_ALLOWED_TOOLS = [
  'identify_vehicle', 'resolve_applications', 'get_glass_candidates', 'get_fitment_state',
  'get_candidate_differences', 'get_next_evidence_request', 'submit_customer_observation',
  'submit_identifier_candidate', 'confirm_identifier', 'resolve_fitment',
  'get_applicable_accessories', 'get_order_configuration', 'request_manual_review',
] as const;
export type DeepSeekToolName = (typeof DEEPSEEK_ALLOWED_TOOLS)[number];

export const DEEPSEEK_PROHIBITIONS = [
  'set EXACT eller fitmentStatus direkte',
  'velge selectedGlass',
  'finne på OE-nummer',
  'finne på tilbehørs-applikabilitet',
  'markere tilbehør som nødvendig',
  'omgå identifikator-bekreftelse',
  'endre Evidence Resolver-tilstand direkte',
] as const;

/** Verktøy-svar-skjema: LLM-en får kun strukturert output, aldri fri tilgang til tilstand. */
export interface ToolResult {
  tool: DeepSeekToolName;
  ok: boolean;
  payload: Record<string, unknown>;
}

export interface DeepSeekExpertConfig {
  apiKey: string; // KUN fra env/secret-binding — aldri hardkodet/committet/logget
  model?: string;
  endpoint?: string;
}

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

/** System-prompt bygges deterministisk; inneholder ALDRI secrets. */
export function buildExpertSystemPrompt(sessionId: string): string {
  return [
    'Du er FinnBilGlass sin digitale glass-ekspert (kundeservice).',
    'Du forstår norsk og forklarer glass-terminologi for vanlige kunder.',
    'DU BESTEMMER ALDRI fitment. Fitment avgjøres utelukkende av deterministisk policy.',
    'Du har kun disse verktøyene: ' + DEEPSEEK_ALLOWED_TOOLS.join(', '),
    'Forbudt: ' + DEEPSEEK_PROHIBITIONS.join('; '),
    'Tilbehør: du svarer KUN basert på get_applicable_accessories()-resultatet. Du spør ALDRI om tilbehør som ikke står i resultatet. Hvis noe er inkludert i ruta sier du «dette følger med ruta».',
    `Sesjon: ${sessionId}`,
  ].join('\n');
}

export class DeepSeekExpert {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(cfg: DeepSeekExpertConfig) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model ?? 'deepseek-chat';
    this.endpoint = cfg.endpoint ?? 'https://api.deepseek.com/chat/completions';
  }

  /** Server-side kall. API-nøkkelen sendes kun i Authorization-header, aldri i prompt/logg. */
  async chat(messages: DeepSeekMessage[], tools: { name: DeepSeekToolName; description: string }[]): Promise<{ ok: boolean; content?: string; toolCalls?: { name: DeepSeekToolName; arguments: Record<string, unknown> }[]; error?: string }> {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages, tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: {} } } })), tool_choice: 'auto', temperature: 0.2 }),
      });
      if (!res.ok) return { ok: false, error: `DeepSeek HTTP ${res.status}` };
      const data = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
      const msg = data.choices?.[0]?.message;
      return {
        ok: true,
        content: msg?.content ?? undefined,
        toolCalls: msg?.tool_calls?.map((tc) => ({ name: tc.function.name as DeepSeekToolName, arguments: JSON.parse(tc.function.arguments || '{}') })),
      };
    } catch (e) {
      return { ok: false, error: `DeepSeek-feil: ${e instanceof Error ? e.message : 'ukjent'}` };
    }
  }
}
