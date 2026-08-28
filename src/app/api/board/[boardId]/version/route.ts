import { NextResponse } from "next/server";

import { requireBoardAccess, READ_MIN_ROLE } from "@/lib/authorize";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { uuidSchema } from "@/lib/validation";
import { logError } from "@/lib/log-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Board freshness probe.
 *
 * Returns the board's `updated_at`, which every board mutation bumps inside its
 * own transaction. Clients poll this and reconcile when the value changes —
 * far cheaper than refetching the board.
 *
 * Authorised at the read floor, so a viewer may poll but an outsider gets a
 * 404. The response is deliberately indistinguishable from "no such board":
 * polling must not become a way to discover which board ids exist.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;

  const parsed = uuidSchema.safeParse(boardId);
  if (!parsed.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const ctx = await requireBoardAccess(parsed.data, READ_MIN_ROLE);
    return NextResponse.json(
      { version: ctx.board.updatedAt.getTime() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof AuthorizationError ||
      error instanceof AuthenticationError
    ) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    logError("[board-version]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
