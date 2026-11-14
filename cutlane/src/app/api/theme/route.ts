import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Read-only: the signed-in user's saved theme, so other devices pick up a change on focus. */
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ theme: user?.theme_preference ?? null }, { headers: { "Cache-Control": "no-store" } });
}
