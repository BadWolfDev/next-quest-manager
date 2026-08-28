import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { requireWorkspaceMemberBySlug, READ_MIN_ROLE } from "@/lib/authorize";
import { AuthorizationError } from "@/lib/errors";

export const metadata: Metadata = { title: "Workspace settings" };

export default async function WorkspaceSettingsPage({
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

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <WorkspaceSettings
        workspaceId={ctx.workspace.id}
        workspaceName={ctx.workspace.name}
        myRole={ctx.role}
      />
    </div>
  );
}
