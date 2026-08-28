import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CardDetailStandalone } from "@/components/card/card-detail-standalone";
import { AuthorizationError } from "@/lib/errors";
import { loadCardDetail } from "@/lib/card-detail-data";
import { uuidSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ cardId: string }>;
}): Promise<Metadata> {
  const { cardId } = await params;
  const parsed = uuidSchema.safeParse(cardId);
  if (!parsed.success) return { title: "Card" };
  try {
    const data = await loadCardDetail(parsed.data);
    return { title: data.card.title };
  } catch {
    return { title: "Card" };
  }
}

/**
 * The card at its own URL — what a shared link, a refresh or a new tab hits.
 * Same component as the modal, rendered on a page instead of over the board.
 */
export default async function CardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const parsed = uuidSchema.safeParse(cardId);
  if (!parsed.success) notFound();

  const data = await loadCardDetail(parsed.data).catch((error) => {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  });

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8">
      <Link
        href={`/b/${boardId}`}
        className="text-muted-foreground hover:text-foreground mb-4 inline-block text-xs uppercase tracking-wide"
      >
        ← {data.board.name}
      </Link>
      <div className="nqm-skin-modal border">
        <CardDetailStandalone data={data} boardId={boardId} />
      </div>
    </div>
  );
}
