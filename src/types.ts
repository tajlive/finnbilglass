/** Worker-miljø — Finnbilglass frontrute-matcher */
export interface Env {
  FINNBILGLASS_DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  ENVIRONMENT: string;
  /** Paused categories; disabled unless explicitly enabled for development. */
  MULTI_GLASS_ENABLED?: string;
  SVV_API_KEY?: string;
  IMAGE_RESOLVER_SECRET?: string;
  OPPLAERING_BUCKET: R2Bucket;
  SUPPORT_EVIDENCE_TOKEN?: string;
  /** STAGING: konversasjonell assistent (fitment-v1/conversation-v1). Prod default: AV. */
  ASSISTANT_ENABLED?: string;
  /** Feature-flags for evidence-flyten (default false i production inntil staging-verifisert). */
  EVIDENCE_UPLOAD_ENABLED?: string;
  EVIDENCE_REVIEW_ENABLED?: string;
  EVIDENCE_STATUS_CHANGE_ENABLED?: string;
  /** Utgående e-post-svar til kunder (Brevo v3 SMTP). Uten nøkkel er /reply 503 «ikke konfigurert». */
  BREVO_API_KEY?: string;
  SUPPORT_FROM_EMAIL?: string;
  /** Utgående SMS til kunder som bare oppga telefonnummer (Brevo v3 transactionalSMS). Uten nøkkel/credits: /sms-reply 503. */
  BREVO_SMS_SENDER?: string;
  /** OpenAI Realtime brukes bare av den token-beskyttede stemmelaben. */
  OPENAI_API_KEY?: string;
  OPENAI_REALTIME_MODEL?: string;
  VOICE_LAB_ENABLED?: string;
}
