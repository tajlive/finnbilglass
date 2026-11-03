-- 0043: Google-innlogging for kunder.
-- google_sub = Googles stabile bruker-ID (claim «sub»). Brukes til å koble en
-- Google-konto til en kunde uten å bruke e-post som identitet.
-- Rollen endres ALDRI av denne koblingen: Google-innlogging gir alltid CUSTOMER-sesjon.
ALTER TABLE auth_users ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_google_sub
  ON auth_users(google_sub) WHERE google_sub IS NOT NULL;
