import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listPendingInvites, type PendingInvite } from "@/actions/invites";
import { listWorkspaceMembers } from "@/actions/members";
import { MembersManager } from "@/components/settings/members-manager";
import { requireWorkspaceMemberBySlug, READ_MIN_ROLE } from "@/lib/authorize";
import { AuthorizationError } from "@/lib/errors";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const ctx = await requireWorkspaceMemberBySlug(
    workspaceSlug,
    READ_MIN_ROLE,
  ).catch((error) => {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  });

  const members = await listWorkspaceMembers(ctx.workspace.id);

  // Invite management is admin-only; a member or viewer simply sees no invites.
  let invites: PendingInvite[] = [];
  if (ctx.role === "owner" || ctx.role === "admin") {
    invites = await listPendingInvites(ctx.workspace.id);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <MembersManager
        workspaceId={ctx.workspace.id}
        workspaceName={ctx.workspace.name}
        myRole={ctx.role}
        members={members}
        invites={invites}
      />
    </div>
  );
}
