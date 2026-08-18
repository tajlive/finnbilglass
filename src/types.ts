/** Worker-miljø — Finnbilglass frontrute-matcher */
export interface Env {
  FINNBILGLASS_DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  ENVIRONMENT: string;
  SVV_API_KEY?: string;
  IMAGE_RESOLVER_SECRET?: string;
  OPPLAERING_BUCKET?: R2Bucket;
  SUPPORT_EVIDENCE_TOKEN?: string;
  /** STAGING: konversasjonell assistent (fitment-v1/conversation-v1). Prod default: AV. */
  ASSISTANT_ENABLED?: string;
}
