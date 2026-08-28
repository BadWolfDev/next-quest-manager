import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { users, workspaceMembers } from "@/db/schema";
import { requireWorkspaceMember, READ_MIN_ROLE, type Actor } from "@/lib/authorize";

/**
 * Members of a workspace who can be assigned work.
 *
 * This lives in `lib`, not in a `"use server"` module, precisely because it
 * takes an `actor`. Every export of a `"use server"` file is a publicly
 * callable endpoint, so an actor parameter there would let any caller name an
 * arbitrary user and read that user's workspaces — impersonation by argument.
 * The server action wrapper calls this with no actor (session-resolved); MCP
 * calls it with the actor its bearer token resolved to.
 */
export async function listAssignableMembersFor(
  workspaceId: string,
  actor?: Actor,
) {
  await requireWorkspaceMember(workspaceId, READ_MIN_ROLE, actor);

  return db
    .select({
      userId: users.id,
      name: users.name,
      image: users.image,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        // Viewers cannot own work.
        ne(workspaceMembers.role, "viewer"),
      ),
    )
    .orderBy(asc(users.name));
}
