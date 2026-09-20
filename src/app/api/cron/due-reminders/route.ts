import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { sendDueReminders } from "@/lib/core/due-reminders";
import { logError } from "@/lib/log-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Due-date reminder sweep.
 *
 * Runs from Vercel Cron (see `vercel.json`) or from any scheduler a
 * self-hoster prefers — it is a plain authenticated GET, so `curl` in a
 * systemd timer or a Kubernetes CronJob works identically. Nothing about the
 * feature depends on Vercel.
 *
 * Authenticated by a shared secret rather than a session: there is no user
 * here, and the endpoint returns counts only, never board data.
 *
 * With `CRON_SECRET` unset the route refuses to run at all (503) instead of
 * running unauthenticated. An open endpoint that writes notification rows is a
 * spam amplifier, and "the reminder feature is off" is a far better failure
 * than "anyone on the internet can fire it".
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    console.warn(
      "[cron/due-reminders] CRON_SECRET is not set; refusing to run. " +
        "Set it to enable due-date reminders.",
    );
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  if (!matchesBearer(header, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await sendDueReminders();
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logError("[cron/due-reminders]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * Constant-time `Authorization: Bearer <secret>` comparison.
 *
 * Lengths are compared first because `timingSafeEqual` throws on a mismatch;
 * the length of a secret is not itself a useful thing to learn.
 */
function matchesBearer(header: string, secret: string): boolean {
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
