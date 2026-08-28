"use client";

import { useRouter } from "next/navigation";

import { CardDetail, type CardDetailData } from "@/components/card/card-detail";

/** The detail on its own page; "close" returns to the board. */
export function CardDetailStandalone({
  data,
  boardId,
}: {
  data: CardDetailData;
  boardId: string;
}) {
  const router = useRouter();
  return (
    <CardDetail data={data} onClose={() => router.push(`/b/${boardId}`)} />
  );
}
