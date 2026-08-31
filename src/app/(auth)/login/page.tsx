import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { isClosedRegistration } from "@/lib/registration";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = params.next;
  const next = typeof raw === "string" && raw.startsWith("/") ? raw : undefined;
  const expired = params.expired === "1";

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>
          {expired
            ? "Your session is no longer valid. Please sign in again."
            : "Sign in to pick up where your board left off."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm
          mode="signin"
          next={next}
          allowSignupLink={!isClosedRegistration()}
        />
      </CardContent>
    </Card>
  );
}
