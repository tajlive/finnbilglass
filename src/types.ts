/** Worker-miljø — Finnbilglass frontrute-matcher */
export interface Env {
  FINNBILGLASS_DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  ENVIRONMENT: string;
  SVV_API_KEY?: string;
  IMAGE_RESOLVER_SECRET?: string;
}
