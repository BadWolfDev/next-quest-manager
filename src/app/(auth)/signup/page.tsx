import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({
  searchParams,
}: PageProps<"/signup">) {
  const params = await searchParams;
  const raw = params.next;
  const next = typeof raw === "string" && raw.startsWith("/") ? raw : undefined;

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
