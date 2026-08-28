import { NextResponse } from "next/server";

import { AuthenticationError } from "@/lib/errors";
import { countMyUnread } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unread notification count for the signed-in user, for the header bell to
 * poll. Scoped to the session — there is no way to ask about another user.
 */
export async function GET() {
  try {
    return NextResponse.json(
      { unread: await countMyUnread() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    console.error("[notifications]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
