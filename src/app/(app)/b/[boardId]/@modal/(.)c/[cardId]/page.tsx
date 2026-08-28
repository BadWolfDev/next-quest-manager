import { notFound } from "next/navigation";

import { CardModalShell } from "@/components/card/card-modal-shell";
import { AuthorizationError } from "@/lib/errors";
import { loadCardDetail } from "@/lib/card-detail-data";
import { uuidSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function InterceptedCardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { cardId } = await params;
  const parsed = uuidSchema.safeParse(cardId);
  if (!parsed.success) notFound();

  const data = await loadCardDetail(parsed.data).catch((error) => {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  });

  return <CardModalShell data={data} />;
}
