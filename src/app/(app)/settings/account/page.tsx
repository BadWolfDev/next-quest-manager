import type { Metadata } from "next";

import { AccountSettings } from "@/components/settings/account-settings";
import { requireUser } from "@/lib/authorize";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  // Core data for this page: if the session cannot be resolved there is
  // nothing honest to render, so this one is deliberately unguarded.
  const user = await requireUser();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <AccountSettings name={user.name} email={user.email} />
    </div>
  );
}
