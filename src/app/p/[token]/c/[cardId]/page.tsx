import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getPublicCard } from "@/lib/core/public-board";
import { uuidSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string; cardId: string }>;
}): Promise<Metadata> {
  const { token, cardId } = await params;
  const parsed = uuidSchema.safeParse(cardId);
  const card = parsed.success ? await getPublicCard(token, parsed.data) : null;
  return {
    title: card ? card.title : "Card",
    robots: { index: false, follow: false },
  };
}

/**
 * Read-only card detail for the public board. No edit affordances exist at all
 * — there is nothing to disable, because nothing mutable is rendered.
 */
export default async function PublicCardPage({
  params,
}: {
  params: Promise<{ token: string; cardId: string }>;
}) {
  const { token, cardId } = await params;
  const parsed = uuidSchema.safeParse(cardId);
  if (!parsed.success) notFound();

  const card = await getPublicCard(token, parsed.data);
  if (!card) notFound();

  const items = card.checklists.flatMap((c) => c.items);
  const done = items.filter((i) => i.completed).length;
  const progress = items.length ? Math.round((done / items.length) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-[760px] flex-1 px-5 py-8">
      <Link
        href={`/p/${token}`}
        className="text-muted-foreground hover:text-foreground mb-4 inline-block text-xs uppercase tracking-wide"
      >
        ← {card.boardName}
      </Link>

      <div className="nqm-skin-modal bg-card border p-6">
        <h1 className="nqm-skin-modal-title text-xl font-semibold tracking-tight">
          {card.title}
        </h1>
        <p className="nqm-skin-kicker text-muted-foreground mt-2 text-xs uppercase tracking-wide">
          In list · {card.listName}
        </p>

        {card.labels.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2.5">
            {card.labels.map((l) => (
              <span
                key={l.id}
                className="px-2 py-1 text-xs font-medium"
                style={{
                  background: `color-mix(in oklab, ${l.color} 22%, transparent)`,
                  color: l.color,
                  border: `1px solid ${l.color}`,
                }}
              >
                {l.name || "Label"}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-6 sm:flex-row">
          <div className="min-w-0 flex-1">
            <h2 className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
              Description
            </h2>
            {card.description ? (
              /* react-markdown, no rehype-raw: user content never becomes markup. */
              <div className="nqm-prose space-y-2 text-sm leading-relaxed">
                <Markdown>{card.description}</Markdown>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No description.</p>
            )}
          </div>

          <aside className="w-full shrink-0 sm:w-[190px]">
            {card.assignees.length > 0 ? (
              <>
                <h2 className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
                  Members
                </h2>
                <div className="flex -space-x-1.5">
                  {card.assignees.map((a, i) => (
                    <Avatar
                      key={`${a.name}-${i}`}
                      className="ring-card size-8 ring-2"
                      title={a.name}
                    >
                      {a.image ? <AvatarImage src={a.image} alt="" /> : null}
                      <AvatarFallback className="text-xs">
                        {a.name.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
              </>
            ) : null}

            {items.length > 0 ? (
              <>
                <h2 className="text-muted-foreground mb-2 mt-5 text-xs uppercase tracking-wide">
                  Progress
                </h2>
                <div
                  className="bg-muted h-2 w-full overflow-hidden border"
                  role="progressbar"
                  aria-valuenow={done}
                  aria-valuemin={0}
                  aria-valuemax={items.length}
                  aria-label="Checklist progress"
                >
                  <div className="bg-primary h-full" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-muted-foreground mt-1.5 text-xs tabular-nums">
                  {done} / {items.length}
                </p>
              </>
            ) : null}
          </aside>
        </div>

        {card.checklists.map((cl) => (
          <section key={cl.id} className="mt-7">
            <h2 className="mb-3 text-sm font-medium">{cl.title}</h2>
            <ul className="space-y-3">
              {cl.items.map((item) => (
                <li key={item.id} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled
                    readOnly
                    aria-label={item.content}
                    className="accent-primary mt-0.5 size-4 shrink-0"
                  />
                  <span
                    className={
                      item.completed
                        ? "text-muted-foreground min-w-0 flex-1 text-sm line-through opacity-60"
                        : "min-w-0 flex-1 text-sm"
                    }
                  >
                    {item.content}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
