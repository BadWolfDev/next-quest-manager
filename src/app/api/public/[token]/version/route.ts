import { NextResponse } from "next/server";

import { getPublicBoardVersion } from "@/lib/core/public-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Freshness probe for a public board, keyed only by the share token.
 *
 * A single indexed select. No session is consulted and no board id is accepted,
 * so this endpoint cannot be used to probe private boards.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const version = await getPublicBoardVersion(token);
  if (version === null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
