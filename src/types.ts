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
  MULTI_GLASS_ENABLED?: string;
  /** ALL_GLASS-kandidater i /api/glass/kandidater (dør/side/ventil/bak/tak). */
  /** Default AV: quote-piloten svarer MANUAL_REVIEW uten katalogtreff. */
  /** Kun eksplisitt \"true\" slår på — aldri implisitt, aldri i produksjon uten eier-OK. */
  ALL_GLASS_KANDIDATER_ENABLED?: string;
  /** Feature-flags for evidence-flyten (default false i production inntil staging-verifisert). */
  EVIDENCE_UPLOAD_ENABLED?: string;
  EVIDENCE_REVIEW_ENABLED?: string;
  EVIDENCE_STATUS_CHANGE_ENABLED?: string;
  RESEND_API_KEY?: string;
  OPS_WORKBENCH_ENABLED?: string;
  OPS_LINK_SECRET?: string;
  RESEND_WEBHOOK_SECRET?: string;
  OPS_PUBLIC_ORIGIN?: string;
  SUPPORT_FROM_EMAIL?: string;
  /** Adressen kunden kan svare på: Reply-To, bunntekst og manuelle svar. */
  SUPPORT_EPOST?: string;
  SUPPORT_NOTIFY_EMAIL?: string;
  /** Google Identity Services (kundeinnlogging). client_id er offentlig; secret brukes ikke i denne flyten. */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** Microsoft Entra (personlige + jobb-/skolekontoer via «common»). */
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  /** Meta/Facebook Login. */
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  /** Kommaseparert liste over sosial innlogging som faktisk er slått på, f.eks. «google». Secrets alene aktiverer ingenting. */
  OAUTH_ENABLED_PROVIDERS?: string;
  /** Cloudflare Access: team-domene (f.eks. tomarnejensen.cloudflareaccess.com) og appens AUD-tag. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Kommaseparert liste over Access-e-poster som får administratortilgang. */
  ADMIN_EMAILS?: string;
  /** Apify-katalog-import (staging). Uten APIFY_SYNC_TOKEN er admin-endepunktene 401. */
  APIFY_TOKEN?: string;
  APIFY_DATASET_ID?: string;
  APIFY_PROBE_ID?: string;
  APIFY_SYNC_TOKEN?: string;
  /** Lokal D1 for autentiseringslagring (KUN wrangler --local, aldri fjern/prod). */
  FINNBILGLASS_LOCAL_AUTH?: D1Database;
  /** Staging D1 for autentiseringslagring (KUN staging). */
  FINNBILGLASS_STAGING_AUTH?: D1Database;
  /** E-postsynkronisering og driftsenter-meldingshistorikk. */
  /** inquiries_enabled: \"true\" aktiverer kundeforespørsler i staging. */
  inquiries_enabled?: string;
  /** Ops dashboard and inbox address for support. */
  OPS_INBOUND_ADDRESS?: string;
  /** Resend webhook signing secret (from Resend dashboard → Webhooks → Signing Secret). */
  /** Gmail OAuth refresh token for syncing sent/received emails. */
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SYNC_ENABLED?: string;
  /** Google Cloud Pub/Sub topic name for Gmail push notifications (e.g., projects/xxx/topics/yyy). */
  GMAIL_PUBSUB_TOPIC?: string;
  /** Stripe secret key for Checkout and webhook verification */
  STRIPE_SECRET_KEY?: string;
  /** Stripe webhook secret */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Explicit kill switch; defaults off and production stays disabled until reviewed. */
  STRIPE_CHECKOUT_ENABLED?: string;
  /** Customer-facing return origin for hosted Checkout, never the Operations hostname. */
  STRIPE_RETURN_ORIGIN?: string;
  /** Optional Stripe Dashboard payment-method configuration for Checkout. */
  STRIPE_PAYMENT_METHOD_CONFIGURATION?: string;
}
