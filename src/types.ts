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
  /** Cloudflare Access staff sign-in for protected manual-order actions. Fail closed when unset. */
  OPS_ACCESS_TEAM_DOMAIN?: string;
  OPS_ACCESS_AUD?: string;
  /** Enable invited-employee panel after staging Access/D1 are ready (default off). */
  OPS_STAFF_PORTAL_ENABLED?: string;
  /** Explicit switch; no order routes are active by default. */
  OPS_MANUAL_ORDERS_ENABLED?: string;
  /** STAGING: konversasjonell assistent (fitment-v1/conversation-v1). Prod default: AV. */
  ASSISTANT_ENABLED?: string;
  MULTI_GLASS_ENABLED?: string;
  /** Feature-flags for evidence-flyten (default false i production inntil staging-verifisert). */
  EVIDENCE_UPLOAD_ENABLED?: string;
  EVIDENCE_REVIEW_ENABLED?: string;
  EVIDENCE_STATUS_CHANGE_ENABLED?: string;
  /** Utgående e-post via Resend. Uten nøkkel er /reply 503 «ikke konfigurert». */
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  SUPPORT_FROM_EMAIL?: string;
  OPS_INBOUND_ADDRESS?: string;
  SUPPORT_EPOST?: string;
  OPS_WORKBENCH_ENABLED?: string;
  GMAIL_SYNC_ENABLED?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GMAIL_PUBSUB_TOPIC?: string;
  /** Apify-katalog-import (staging). Uten APIFY_SYNC_TOKEN er admin-endepunktene 401. */
  APIFY_TOKEN?: string;
  APIFY_DATASET_ID?: string;
  APIFY_PROBE_ID?: string;
  APIFY_SYNC_TOKEN?: string;
}
