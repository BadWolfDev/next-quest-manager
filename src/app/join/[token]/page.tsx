import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
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
import {
  isClosedRegistration,
  resolveUserInvite,
  USER_INVITE_PROBLEM_MESSAGE,
} from "@/lib/registration";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join",
  // An invite link is a secret; keep it out of search indexes.
  robots: { index: false, follow: false },
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

function Problem({
  title,
  body,
  signedIn,
}: {
  title: string;
  body: string;
  signedIn: boolean;
}) {
  return (
    <Shell>
      <Card>
        <CardHeader>
          <div className="bg-destructive/10 text-destructive mb-2 grid size-10 place-items-center rounded-lg">
            <ShieldAlert className="size-5" />
          </div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href={signedIn ? "/app" : "/login"}>
              {signedIn ? "Back to your boards" : "Sign in"}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}

/**
 * Redeem an instance invite: create an account on a closed instance.
 *
 * Distinct from `/invite/<token>`, which adds an *existing* account to a
 * workspace. This one is the only route to an account at all when closed
 * registration is on.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getSessionUser();

  // On an open instance there is nothing to redeem — signup is public.
  if (!isClosedRegistration()) {
    return (
      <Problem
        signedIn={Boolean(user)}
        title="No invite needed"
        body="This instance has open registration — you can create an account directly."
      />
    );
  }

  if (user) {
    return (
      <Problem
        signedIn
        title="You already have an account"
        body={`You're signed in as ${user.email}. Instance invites are only for creating a new account.`}
      />
    );
  }

  const resolved = await resolveUserInvite(token);
  if (!resolved.ok) {
    return (
      <Problem
        signedIn={false}
        title="This invite isn't usable"
        body={USER_INVITE_PROBLEM_MESSAGE[resolved.problem]}
      />
    );
  }

  return (
    <Shell>
      <Card className="shadow-sm">
        <CardHeader>
          <CardDescription>You&rsquo;ve been invited to</CardDescription>
          <CardTitle className="text-xl">Next Quest Manager</CardTitle>
          <CardDescription>
            Create your account to get started. You&rsquo;ll get a personal
            workspace straight away.
            {resolved.invite.email ? (
              <>
                {" "}
                This invite is for{" "}
                <strong className="text-foreground">
                  {resolved.invite.email}
                </strong>
                .
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm mode="signup" inviteToken={token} allowSignupLink={false} />
        </CardContent>
      </Card>
    </Shell>
  );
}
