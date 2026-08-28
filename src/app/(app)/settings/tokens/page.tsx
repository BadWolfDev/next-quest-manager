import type { Metadata } from "next";

import { listMyTokens } from "@/actions/tokens";
import { TokenManager } from "@/components/settings/token-manager";

export const metadata: Metadata = { title: "Access tokens" };

export default async function TokensPage() {
  const tokens = await listMyTokens();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <TokenManager tokens={tokens} />
    </div>
  );
}
