import { redirect } from "next/navigation";

import { EmptyWorkspaceState } from "@/components/app/empty-workspace-state";
import { getDefaultWorkspace } from "@/lib/queries";

export const metadata = { title: "Your boards" };

/**
 * Landing route for signed-in users: bounce to their first workspace, or offer
 * to create one if (somehow) they have none.
 */
export default async function AppIndexPage() {
  const workspace = await getDefaultWorkspace();
  if (workspace) redirect(`/w/${workspace.slug}`);

  return <EmptyWorkspaceState />;
}
