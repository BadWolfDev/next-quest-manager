import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { toast } from "sonner";

import { MAX_ATTACHMENTS_PER_CARD, formatBytes } from "@/lib/attachments";

/**
 * Uploading files to a card from the browser — shared by the card detail
 * (button, paste, drop anywhere on the card) and by card faces on the board
 * (drop onto a card).
 *
 * Every file is a multipart POST to `/api/attachments?cardId=`, whichever
 * backend stores it. Files go one at a time, so a burst never trips the rate
 * limit harder than it has to and progress is honest. Every check here is a
 * courtesy to save a round trip; the server re-checks all of it.
 */

/**
 * The board's per-file upload cap, for card faces — from the server, never
 * from the environment. Null for viewers, who get no drop targets.
 */
export const AttachmentUploadContext = createContext<number | null>(null);

export function useBoardAttachmentMaxBytes() {
  return useContext(AttachmentUploadContext);
}

/** A native drag carrying files from the OS — not a dnd-kit card drag, not a text or link drag. */
export function isFileDrag(event: { dataTransfer: DataTransfer | null }) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Stop a file dropped *outside* a drop zone from making the browser navigate
 * away to it. Zones call `preventDefault` themselves, so this only acts on
 * drags nobody handled.
 */
export function usePreventFileDropNavigation() {
  useEffect(() => {
    function guard(event: DragEvent) {
      if (event.defaultPrevented || !isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    }
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
}

type Outcome = { ok: true } | { ok: false; message: string };

async function uploadOne(cardId: string, file: File): Promise<Outcome> {
  const body = new FormData();
  body.set("file", file, file.name || "pasted-file");
  try {
    const response = await fetch(
      `/api/attachments?cardId=${encodeURIComponent(cardId)}`,
      { method: "POST", body },
    );
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    return {
      ok: false,
      message:
        payload?.message ??
        (response.status === 404
          ? "This card is no longer available."
          : "That upload didn't work."),
    };
  } catch {
    return { ok: false, message: "Upload failed — check your connection." };
  }
}

export type UploadProgress = {
  /** 1-based index of the file in flight. */
  current: number;
  total: number;
  filename: string;
};

/**
 * Upload a batch of files to one card, with per-file error toasts and a
 * progress state to render. `existingCount` is the card's current attachment
 * count, for the courtesy room check.
 */
export function useAttachmentUploader({
  cardId,
  existingCount,
  maxBytes,
}: {
  cardId: string;
  existingCount: number;
  /** Per-file cap from the server; null disables uploading (viewers). */
  maxBytes: number | null;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const busy = useRef(false);

  const upload = useCallback(
    async (files: File[]) => {
      if (maxBytes === null || files.length === 0) return;
      if (busy.current) {
        toast.error("Wait for the current upload to finish.");
        return;
      }

      const room = MAX_ATTACHMENTS_PER_CARD - existingCount;
      if (room <= 0) {
        toast.error(
          `A card can hold at most ${MAX_ATTACHMENTS_PER_CARD} attachments.`,
        );
        return;
      }

      const accepted: File[] = [];
      for (const file of files) {
        const label = file.name || "That file";
        if (file.size === 0) {
          toast.error(`${label} is empty.`);
        } else if (file.size > maxBytes) {
          toast.error(`${label} is over the ${formatBytes(maxBytes)} limit.`);
        } else {
          accepted.push(file);
        }
      }
      if (accepted.length > room) {
        toast.error(
          `Only ${room} more ${room === 1 ? "file fits" : "files fit"} on this card.`,
        );
        accepted.length = room;
      }
      if (accepted.length === 0) return;

      busy.current = true;
      let succeeded = 0;
      try {
        for (const [index, file] of accepted.entries()) {
          setProgress({
            current: index + 1,
            total: accepted.length,
            filename: file.name || "file",
          });
          const outcome = await uploadOne(cardId, file);
          if (outcome.ok) succeeded += 1;
          else toast.error(`${file.name || "File"}: ${outcome.message}`);
        }
      } finally {
        busy.current = false;
        setProgress(null);
      }

      if (succeeded > 0) router.refresh();
    },
    [cardId, existingCount, maxBytes, router],
  );

  return { upload, progress, uploading: progress !== null };
}

export type AttachmentUploader = ReturnType<typeof useAttachmentUploader>;

/**
 * "Uploading 2/3 · report.pdf", or "Uploading 2/3…" with `withFilename: false`
 * where there is no room for a name (a card face).
 */
export function describeProgress(
  progress: UploadProgress,
  { withFilename = true }: { withFilename?: boolean } = {},
): string {
  const count =
    progress.total > 1 ? ` ${progress.current}/${progress.total}` : "";
  return withFilename
    ? `Uploading${count} · ${progress.filename}`
    : `Uploading${count}…`;
}

/**
 * Drag-and-drop wiring for a file drop target: whether files are being held
 * over it, and the four handlers to spread onto its element.
 *
 * Only native *file* drags are acted on. dnd-kit moves cards with pointer
 * events, which never produce these events; a dragged link or text selection
 * does, but carries no "Files" type and is left alone. `dragenter`/`dragleave`
 * fire for every child crossed, so a depth counter decides when the pointer
 * has really left. When disabled (viewers) no handlers are attached at all.
 */
export function useFileDropTarget(
  enabled: boolean,
  onFiles: (files: File[]) => void,
) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  if (!enabled) return { over: false, handlers: {} };

  const handlers = {
    onDragEnter(event: ReactDragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver(event: ReactDragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave(event: ReactDragEvent) {
      if (!isFileDrag(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop(event: ReactDragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      // A drop on a card face must not also count as a drop on whatever
      // encloses it.
      event.stopPropagation();
      depth.current = 0;
      setOver(false);
      onFiles(Array.from(event.dataTransfer.files));
    },
  };

  return { over, handlers };
}
