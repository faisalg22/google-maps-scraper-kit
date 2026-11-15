/**
 * Runs once when the server starts. In production, refuse to boot with missing configuration
 * (unless ALLOW_DEMO=true for a staging/review deploy), so a forgotten key fails loudly at
 * deploy time instead of silently falling back to demo behaviour.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { env, productionConfigErrors } = await import("./lib/env");
  const errors = productionConfigErrors();
  if (errors.length === 0) return;
  if (env.allowDemo) {
    console.warn(`[cutlane] ALLOW_DEMO=true: starting with demo fallbacks. Missing for production:\n  - ${errors.join("\n  - ")}`);
    return;
  }
  console.error(`[cutlane] Refusing to start: production configuration is incomplete.\n  - ${errors.join("\n  - ")}\nSet these variables (see .env.example), or ALLOW_DEMO=true for a staging/demo deploy.`);
  process.exit(1);
}
