import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isClosedRegistration } from "@/lib/registration";

export const metadata: Metadata = { title: "Create an account" };

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: PageProps<"/signup">) {
  const params = await searchParams;
  const raw = params.next;
  const next = typeof raw === "string" && raw.startsWith("/") ? raw : undefined;

  /*
    Closed instances have no public signup form. This is presentation only —
    `signUpAction` refuses on its own, because hiding a form is not access
    control and the action is a public endpoint.
  */
  if (isClosedRegistration()) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <div className="bg-primary/10 text-primary mb-2 grid size-10 place-items-center rounded-lg">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle className="text-xl">This instance is invite-only</CardTitle>
          <CardDescription>
            New accounts are created by an administrator. Ask them for an invite
            link, then open it to set up your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>
          You get a personal workspace straight away. Invite people to it later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm mode="signup" next={next} />
      </CardContent>
    </Card>
  );
}
