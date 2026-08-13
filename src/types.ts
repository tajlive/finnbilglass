/** Worker-miljø — Finnbilglass frontrute-matcher */
export interface Env {
  FINNBILGLASS_DB: D1Database;
  ENVIRONMENT: string;
  SVV_API_KEY?: string;
}
