import { ArrowRight, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AcceptInviteForm } from "@/components/invites/accept-invite-form";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionUser } from "@/lib/authorize";
import { INVITE_PROBLEM_MESSAGE, resolveInvite } from "@/lib/invites";
import { isClosedRegistration } from "@/lib/registration";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Workspace invite",
  // An invite link is a secret; keep it out of search indexes.
  robots: { index: false, follow: false },
};

const ROLE_BLURB: Record<string, string> = {
  admin: "You'll be able to manage boards, members and invites.",
  member: "You'll be able to create and edit boards, lists and cards.",
  viewer: "You'll be able to read boards, but not change anything.",
  owner: "You'll have full control of this workspace.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="nqm-surface flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" aria-label="Next Quest Manager home">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveInvite(token);
  const user = await getSessionUser();

  if (!resolved.ok) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <div className="bg-destructive/10 text-destructive mb-2 grid size-10 place-items-center rounded-lg">
              <ShieldAlert className="size-5" />
            </div>
            <CardTitle className="text-xl">This invite isn&rsquo;t usable</CardTitle>
            <CardDescription>
              {INVITE_PROBLEM_MESSAGE[resolved.problem]}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href={user ? "/app" : "/"}>
                {user ? "Back to your boards" : "Go to Next Quest Manager"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const { invite } = resolved;
  const boundMismatch =
    user &&
    invite.email &&
    invite.email.toLowerCase() !== user.email.toLowerCase();

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardDescription>
            {invite.inviterName
              ? `${invite.inviterName} invited you to`
              : "You've been invited to"}
          </CardDescription>
          <CardTitle className="text-xl">{invite.workspaceName}</CardTitle>
          <CardDescription>
            Joining as <strong className="text-foreground">{invite.role}</strong>.{" "}
            {ROLE_BLURB[invite.role]}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {boundMismatch ? (
            <div className="space-y-4">
              <p
                role="alert"
                className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
              >
                This invite was issued for {invite.email}, but you&rsquo;re
                signed in as {user.email}.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/app">Back to your boards</Link>
              </Button>
            </div>
          ) : user ? (
            <AcceptInviteForm
              token={token}
              workspaceName={invite.workspaceName}
            />
          ) : isClosedRegistration() ? (
            /*
              Closed instance: a workspace invite grants membership, never an
              account. Offering "create an account" here would turn every
              workspace invite into a signup back door — signUpAction refuses
              regardless, but the UI must not dangle the option either.
            */
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                This instance is invite-only — ask your administrator for an
                account, then use this link to join the workspace.
              </p>
              <Button asChild className="w-full">
                <Link href={`/login?next=/invite/${encodeURIComponent(token)}`}>
                  Sign in to join
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Sign in or create an account to join. We&rsquo;ll bring you
                straight back here.
              </p>
              <Button asChild className="w-full">
                <Link href={`/signup?next=/invite/${encodeURIComponent(token)}`}>
                  Create an account
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/login?next=/invite/${encodeURIComponent(token)}`}>
                  I already have an account
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
