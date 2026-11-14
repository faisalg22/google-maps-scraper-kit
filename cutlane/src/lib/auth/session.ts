import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { one, q } from "../db";
import { randomToken, sha256 } from "../crypto";
import { env } from "../env";

export const SESSION_COOKIE = "cl_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  whop_user_id: string;
  username: string | null;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
  is_demo: boolean;
  theme_preference: "light" | "dark" | "system" | null;
}

export async function upsertUser(u: {
  whopUserId: string;
  username?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  isDemo?: boolean;
}): Promise<User> {
  const row = await one<User>(
    `insert into users (whop_user_id, username, name, avatar_url, email, is_demo)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (whop_user_id) do update set
       username = excluded.username, name = excluded.name, avatar_url = excluded.avatar_url,
       email = excluded.email, updated_at = now()
     returning id, whop_user_id, username, name, avatar_url, email, is_demo, theme_preference`,
    [u.whopUserId, u.username ?? null, u.name ?? null, u.avatarUrl ?? null, u.email ?? null, u.isDemo ?? false],
  );
  return row!;
}

/** Creates a session row and sets the httpOnly cookie. Call from a route handler or server action. */
export async function startSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await q(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3::timestamptz)`, [
    sha256(token),
    userId,
    expires.toISOString(),
  ]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  let userId: string | null = null;
  if (token) {
    const row = await one<{ user_id: string }>(`delete from sessions where token_hash = $1 returning user_id`, [sha256(token)]);
    userId = row?.user_id ?? null;
  }
  jar.delete(SESSION_COOKIE);
  return userId;
}

/** Current user or null. Memoised per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  return one<User>(
    `select u.id, u.whop_user_id, u.username, u.name, u.avatar_url, u.email, u.is_demo, u.theme_preference
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/?signin=1");
  return user;
}
