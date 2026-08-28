import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
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

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>
          Sign in to pick up where your board left off.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm mode="signin" next={next} />
      </CardContent>
    </Card>
  );
}
