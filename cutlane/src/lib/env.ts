import "server-only";

/**
 * Central config + mode detection. Every integration flips from DEMO to LIVE
 * independently, as soon as its variables are present. Nothing here is ever
 * sent to the browser except the boolean flags returned by `publicModes()`.
 */

function v(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export const env = {
  appUrl: v("APP_URL") ?? "http://localhost:3000",
  whop: {
    clientId: v("WHOP_CLIENT_ID"),
    clientSecret: v("WHOP_CLIENT_SECRET"),
    redirectUri: v("WHOP_REDIRECT_URI"),
    scopes: v("WHOP_OAUTH_SCOPES") ?? "openid profile email",
    apiVersionDate: v("WHOP_API_VERSION_DATE") ?? "2026-11-13",
    apiBase: "https://api.whop.com/api/v1",
    oauthBase: "https://api.whop.com/oauth",
  },
  youtube: {
    apiKey: v("YOUTUBE_API_KEY"),
  },
  supabase: {
    url: v("SUPABASE_URL"),
    anonKey: v("SUPABASE_ANON_KEY"),
    serviceRoleKey: v("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: v("SUPABASE_CLIPS_BUCKET") ?? "clips",
  },
  databaseUrl: v("DATABASE_URL"),
  tokenEncryptionKey: v("TOKEN_ENCRYPTION_KEY"),
  isProd: process.env.NODE_ENV === "production",
};

export const modes = {
  /** Real Whop OAuth + bounties + submissions. */
  get whop() {
    return Boolean(env.whop.clientId && env.whop.clientSecret && env.whop.redirectUri);
  },
  /** Real YouTube Data API. */
  get youtube() {
    return Boolean(env.youtube.apiKey);
  },
  /** Real Postgres (Supabase) instead of the local embedded database. */
  get database() {
    return Boolean(env.databaseUrl);
  },
  /** Supabase Storage for clip files instead of local disk. */
  get storage() {
    return Boolean(env.supabase.url && env.supabase.serviceRoleKey);
  },
  get anyDemo() {
    return !this.whop || !this.youtube || !this.database || !this.storage;
  },
};

export type PublicModes = {
  whop: boolean;
  youtube: boolean;
  database: boolean;
  storage: boolean;
  anyDemo: boolean;
};

/** Safe to pass to client components: booleans only. */
export function publicModes(): PublicModes {
  return {
    whop: modes.whop,
    youtube: modes.youtube,
    database: modes.database,
    storage: modes.storage,
    anyDemo: modes.anyDemo,
  };
}

/** Problems that would make live mode unsafe; shown on /status. */
export function configWarnings(): string[] {
  const w: string[] = [];
  if (modes.whop && !env.tokenEncryptionKey) {
    w.push("Whop is configured but TOKEN_ENCRYPTION_KEY is missing. Sign-in is disabled until it is set.");
  }
  const anyWhop = env.whop.clientId || env.whop.clientSecret || env.whop.redirectUri;
  if (anyWhop && !modes.whop) {
    w.push("Whop is partly configured. Set WHOP_CLIENT_ID, WHOP_CLIENT_SECRET and WHOP_REDIRECT_URI together.");
  }
  if ((env.supabase.url || env.supabase.serviceRoleKey) && !modes.storage) {
    w.push("Supabase Storage needs both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (modes.whop && !modes.database) {
    w.push("Whop is live but the database is the local demo database. Set DATABASE_URL before real users sign in.");
  }
  if (modes.whop && !modes.storage) {
    w.push("Whop is live but clips are stored on local disk. Set Supabase Storage variables for production.");
  }
  if (env.isProd && !env.appUrl.startsWith("https://")) {
    w.push("APP_URL should be https:// in production.");
  }
  return w;
}
