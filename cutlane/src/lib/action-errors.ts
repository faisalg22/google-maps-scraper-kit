import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AccessBlockedError, FeatureUnavailableError, LimitReachedError } from "./billing/entitlements";
import { WhopAuthRequired } from "./whop/client";
import type { Metric } from "@/config/plans";

/** What server actions return to forms. `upgrade` makes the UI show an upgrade prompt. */
export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  upgrade?: { kind: "limit"; metric: Metric; limit: number; used: number } | { kind: "access"; reason: string } | { kind: "feature" };
} | null;

export function toActionState(err: unknown): NonNullable<ActionState> {
  unstable_rethrow(err); // let redirect()/notFound() propagate
  if (err instanceof LimitReachedError) return { error: err.message, upgrade: { kind: "limit", metric: err.metric, limit: err.limit, used: err.used } };
  if (err instanceof AccessBlockedError) return { error: err.message, upgrade: { kind: "access", reason: err.reason } };
  if (err instanceof FeatureUnavailableError) return { error: err.message, upgrade: { kind: "feature" } };
  if (err instanceof WhopAuthRequired) return { error: err.message };
  if (err instanceof z.ZodError) return { error: err.issues[0]?.message ?? "Invalid input" };
  return { error: err instanceof Error ? err.message : "Something went wrong" };
}
