import { ArrowRight, Database, GitBranch, Lock, Server } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/authorize";

const FEATURES = [
  {
    Icon: Database,
    title: "Postgres, full stop",
    body: "One DATABASE_URL is the entire data layer. No Redis, no queue, no object store to babysit.",
  },
  {
    Icon: Server,
    title: "Deploy anywhere",
    body: "Vercel's free tier or a single Docker host. Two environment variables and it runs.",
  },
  {
    Icon: Lock,
    title: "Locked down by default",
    body: "argon2id passwords, throttled sign-ins, and a central policy every query has to pass.",
  },
  {
    Icon: GitBranch,
    title: "Yours to fork",
    body: "MIT licensed. Read the schema, change the rules, run it on your own hardware.",
  },
];

export default async function LandingPage() {
  // Signed-in visitors go straight to their boards.
  const user = await getSessionUser();
  if (user) redirect("/app");

  return (
    <div className="nqm-surface flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-8">
        <section className="grid items-center gap-12 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <p className="text-primary mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium">
              Open source · self-hostable
            </p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
              A kanban board that lives on{" "}
              <span className="text-primary">your</span> Postgres.
            </h1>
            <p className="text-muted-foreground mt-5 max-w-xl text-pretty text-base leading-relaxed sm:text-lg">
              Next Quest Manager is a Trello-shaped board for teams who would
              rather own the database than rent one. Workspaces, boards, lists,
              cards — backed by a schema you can read in one sitting.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/signup">
                  Create your first board
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">I already have an account</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-4 text-xs">
              The first account created on a fresh instance becomes its
              administrator.
            </p>
          </div>

          {/* A static, decorative sketch of the board UI. */}
          <div
            aria-hidden="true"
            className="bg-card/70 relative overflow-hidden rounded-2xl border p-4 shadow-xl backdrop-blur-sm"
          >
            <div className="nqm-grid absolute inset-0 opacity-60" />
            <div className="relative flex gap-3">
              {[
                { name: "Backlog", cards: ["Design the schema", "Pick an ORM", "Sketch the shell"] },
                { name: "In Progress", cards: ["Credentials auth", "Board grid"] },
                { name: "Done", cards: ["Set up Postgres"] },
              ].map((column, ci) => (
                <div
                  key={column.name}
                  className="bg-background/80 flex-1 rounded-xl border p-2.5"
                >
                  <p className="text-muted-foreground mb-2 px-1 text-[0.7rem] font-medium uppercase tracking-wide">
                    {column.name}
                  </p>
                  <div className="space-y-2">
                    {column.cards.map((card, i) => (
                      <div
                        key={card}
                        className="bg-card rounded-lg border px-2.5 py-2 text-xs shadow-sm"
                      >
                        <span
                          className="mb-1.5 block h-1 w-8 rounded-full"
                          style={{
                            background: `var(--chart-${((ci + i) % 5) + 1})`,
                          }}
                        />
                        {card}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="bg-card/60 rounded-xl border p-5 backdrop-blur-sm"
            >
              <Icon className="text-primary size-5" />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                {body}
              </p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-xs sm:flex-row sm:px-8">
          <p>Next Quest Manager — MIT licensed.</p>
          <ThemeToggle className="sm:hidden" />
        </div>
      </footer>
    </div>
  );
}
