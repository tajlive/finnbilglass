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
  /**
   * ALL_GLASS-kandidater i /api/glass/kandidater (dør/side/ventil/bak/tak).
   * Default AV: quote-piloten svarer MANUAL_REVIEW uten katalogtreff.
   * Kun eksplisitt "true" slår på — aldri implisitt, aldri i produksjon uten eier-OK.
   */
  ALL_GLASS_KANDIDATER_ENABLED?: string;
  /** Feature-flags for evidence-flyten (default false i production inntil staging-verifisert). */
  EVIDENCE_UPLOAD_ENABLED?: string;
  EVIDENCE_REVIEW_ENABLED?: string;
  EVIDENCE_STATUS_CHANGE_ENABLED?: string;
  RESEND_API_KEY?: string;
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
  /**
   * Kommaseparert liste over sosial innlogging som faktisk er slått på,
   * f.eks. «google». Secrets alene aktiverer ingenting.
   */
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
  /** inquiries_enabled: "true" aktiverer kundeforespørsler i staging. */
  inquiries_enabled?: string;
  KUSTOM_API_USERNAME?: string;
  KUSTOM_API_PASSWORD?: string;
  KUSTOM_ENABLED?: string;
  KUSTOM_OPS_ROUTE_ENABLED?: string;
  KUSTOM_PLAYGROUND_DIAGNOSTICS_ENABLED?: string;
  KUSTOM_MONEY_MOVEMENTS_ENABLED?: string;
  KUSTOM_RECONCILIATION_ENABLED?: string;
  KUSTOM_PRODUCTION_APPROVED?: string;
  KUSTOM_RETURN_ORIGIN?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_CHECKOUT_ENABLED?: string;
  STRIPE_RETURN_ORIGIN?: string;
  STRIPE_PAYMENT_METHOD_CONFIGURATION?: string;
}
