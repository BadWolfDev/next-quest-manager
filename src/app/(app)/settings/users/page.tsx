import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  listInstanceUsers,
  listUserInvites,
} from "@/actions/user-invites";
import { UserInviteManager } from "@/components/settings/user-invite-manager";
import { requireUser } from "@/lib/authorize";
import { getAdminConfig, isEnvAdmin } from "@/lib/registration";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

/**
 * Instance administration. Visible only to the ADMIN_EMAIL identity — anyone
 * else gets a 404, which does not disclose that the page exists.
 */
export default async function UsersSettingsPage() {
  const user = await requireUser();
  const config = getAdminConfig();
  if (!config || !isEnvAdmin(user.email)) notFound();

  const [invites, people] = await Promise.all([
    listUserInvites(),
    listInstanceUsers(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <UserInviteManager
        invites={invites}
        people={people}
        adminEmail={config.email}
      />
    </div>
  );
}
