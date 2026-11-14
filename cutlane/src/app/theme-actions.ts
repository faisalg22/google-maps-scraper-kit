"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { q } from "@/lib/db";
import { isThemePref, type ThemePref } from "@/lib/theme";

/** Save the signed-in user's theme. Signed-out visitors keep theirs in localStorage only. */
export async function saveThemePreference(pref: ThemePref): Promise<{ ok: boolean }> {
  if (!isThemePref(pref)) return { ok: false };
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  await q(`update users set theme_preference = $2, updated_at = now() where id = $1`, [user.id, pref]);
  return { ok: true };
}
