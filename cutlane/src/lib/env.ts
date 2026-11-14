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
  stripe: {
    secretKey: v("STRIPE_SECRET_KEY"),
    webhookSecret: v("STRIPE_WEBHOOK_SECRET"),
    prices: {
      beginner: v("STRIPE_PRICE_BEGINNER"),
      clipper: v("STRIPE_PRICE_CLIPPER"),
      beginnerAnnual: v("STRIPE_PRICE_BEGINNER_ANNUAL"),
      clipperAnnual: v("STRIPE_PRICE_CLIPPER_ANNUAL"),
    },
  },
  flags: {
    /** Annual billing (2 months free). Also needs the *_ANNUAL price IDs when Stripe is live. */
    annualBilling: v("BILLING_ANNUAL_ENABLED") === "true",
    /** Clipper checkout + V2 features (editor, AI cuts, auto-post). Off until V2 ships. */
    clipperAvailable: v("CLIPPER_AVAILABLE") === "true",
  },
  email: {
    resendApiKey: v("RESEND_API_KEY"),
    salesNotify: v("SALES_NOTIFY_EMAIL"),
    from: v("SALES_FROM_EMAIL") ?? "CutLane <no-reply@cutlane.io>",
  },
  adminWhopUserIds: (v("ADMIN_WHOP_USER_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
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
  /** Real Stripe Checkout/Portal/webhooks. Without it: test mode with mock plans. */
  get stripe() {
    return Boolean(env.stripe.secretKey && env.stripe.prices.beginner);
  },
  get email() {
    return Boolean(env.email.resendApiKey && env.email.salesNotify);
  },
  get anyDemo() {
    return !this.whop || !this.youtube || !this.database || !this.storage || !this.stripe;
  },
};

export type PublicModes = {
  stripe: boolean;
  whop: boolean;
  youtube: boolean;
  database: boolean;
  storage: boolean;
  anyDemo: boolean;
};

/** Safe to pass to client components: booleans only. */
export function publicModes(): PublicModes {
  return {
    stripe: modes.stripe,
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
  if (env.stripe.secretKey && !env.stripe.prices.beginner) {
    w.push("STRIPE_SECRET_KEY is set but STRIPE_PRICE_BEGINNER is missing, so billing stays in test mode.");
  }
  if (modes.stripe && !env.stripe.webhookSecret) {
    w.push("Stripe is live but STRIPE_WEBHOOK_SECRET is missing. Subscriptions won't update until webhooks are configured.");
  }
  if (modes.stripe && env.flags.annualBilling && !env.stripe.prices.beginnerAnnual) {
    w.push("Annual billing is enabled but STRIPE_PRICE_BEGINNER_ANNUAL is missing; the annual option is hidden.");
  }
  if (modes.stripe && env.stripe.secretKey?.startsWith("sk_live") && !modes.whop) {
    w.push("Live Stripe keys are set while Whop is in demo mode.");
  }
  if (env.isProd && !env.appUrl.startsWith("https://")) {
    w.push("APP_URL should be https:// in production.");
  }
  return w;
}
