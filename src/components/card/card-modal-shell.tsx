"use client";

import { useRouter } from "next/navigation";

import { CardDetail, type CardDetailData } from "@/components/card/card-detail";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Modal wrapper for the intercepted card route.
 *
 * Closing goes `router.back()`, which unwinds the intercepted segment and
 * leaves the board exactly as it was. Radix already handles Esc and a backdrop
 * click, routing both through `onOpenChange`.
 *
 * The entry animation is a CSS variable (`--skin-modal-anim`) so each skin
 * supplies its own — instant in Pixel Quest, 120ms fade-scale in Grid Protocol,
 * 140ms slide-up in Miami Deadline — and all of them collapse to instant under
 * `prefers-reduced-motion`.
 */
export function CardModalShell({ data }: { data: CardDetailData }) {
  const router = useRouter();
  const close = () => router.back();

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="nqm-skin-modal w-[calc(100vw-2rem)] max-w-[760px] gap-0 p-0 sm:max-w-[760px]"
      >
        <DialogTitle className="sr-only">{data.card.title}</DialogTitle>
        <CardDetail data={data} onClose={close} />
      </DialogContent>
    </Dialog>
  );
}
