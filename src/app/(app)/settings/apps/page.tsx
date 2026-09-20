import type { Metadata } from "next";

import { listMyConnectedApps } from "@/actions/oauth";
import { ConnectedApps } from "@/components/settings/connected-apps";

export const metadata: Metadata = { title: "Connected apps" };

export default async function ConnectedAppsPage() {
  const apps = await listMyConnectedApps();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <ConnectedApps apps={apps} />
    </div>
  );
}
