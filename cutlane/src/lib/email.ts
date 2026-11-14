import "server-only";
import { env, modes } from "./env";

/**
 * Transactional email via Resend's HTTP API. Configure RESEND_API_KEY + SALES_NOTIFY_EMAIL.
 * Without them, nothing is sent and the caller records "skipped" (the lead is still saved).
 */
export async function sendEmail(msg: { to: string; subject: string; text: string; replyTo?: string }): Promise<"sent" | "skipped" | "failed"> {
  if (!env.email.resendApiKey) return "skipped";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.email.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.email.from, to: [msg.to], subject: msg.subject, text: msg.text, reply_to: msg.replyTo }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export function salesInbox(): string | null {
  return modes.email ? env.email.salesNotify! : null;
}
