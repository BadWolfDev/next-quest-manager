"use client";

import { ImagePlus, Loader2, Paperclip, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { deleteAttachmentAction } from "@/actions/attachments";
import { RelativeTime, useQuickAction } from "@/components/card/card-hooks";
import type { CardDetailAttachment } from "@/components/card/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_CARD,
  formatBytes,
} from "@/lib/attachments";

/**
 * The card's image attachments.
 *
 * Thumbnails and the full-size view are plain `<img>` tags pointed at
 * `/api/attachments/<id>`, which re-authorises every request with the session
 * cookie. `next/image` is deliberately not used: its optimiser fetches the
 * source server-side *without* the viewer's cookie, so it would only ever see
 * the 404 an anonymous caller gets.
 *
 * Uploads (button, or pasting an image anywhere while the card is open) POST
 * one file per request to `/api/attachments`, sequentially, so each request
 * stays under the platform's body limit. The type and size checks here only
 * save a pointless round trip; the server sniffs and caps regardless.
 */

const src = (id: string) => `/api/attachments/${id}`;

/**
 * A loose pre-filter, not a type check. Browsers report an empty or odd MIME
 * type for perfectly good images (some OS pickers, some paste sources), and the
 * server sniffs magic bytes anyway — so only reject what is clearly not a
 * raster image. SVG is named because it *is* `image/*` but will never pass.
 */
function plausiblyImage(file: File): boolean {
  if (file.type === "") return true;
  return file.type.startsWith("image/") && file.type !== "image/svg+xml";
}

/** An input, textarea or contenteditable that a text paste would land in. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  if (target instanceof HTMLInputElement) {
    return !target.readOnly && !NON_TEXT_INPUTS.has(target.type);
  }
  return false;
}

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

async function uploadOne(cardId: string, file: File): Promise<string | null> {
  const body = new FormData();
  body.set("file", file, file.name || "pasted-image");
  try {
    const response = await fetch(
      `/api/attachments?cardId=${encodeURIComponent(cardId)}`,
      { method: "POST", body },
    );
    if (response.ok) return null;
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    return payload?.message ?? "That upload didn't work.";
  } catch {
    return "Upload failed — check your connection.";
  }
}

export function CardAttachments({
  cardId,
  attachments,
  maxBytes,
  canWrite,
}: {
  cardId: string;
  attachments: CardDetailAttachment[];
  maxBytes: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // The id outlives `open` so the dialog keeps its content (and its title)
  // through the close animation.
  const [viewer, setViewer] = useState<{ id: string; open: boolean } | null>(
    null,
  );
  const viewed = attachments.find((a) => a.id === viewer?.id) ?? null;

  const uploading = progress !== null;
  const full = attachments.length >= MAX_ATTACHMENTS_PER_CARD;

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const room = MAX_ATTACHMENTS_PER_CARD - attachments.length;
      if (room <= 0) {
        toast.error(
          `A card can hold at most ${MAX_ATTACHMENTS_PER_CARD} attachments.`,
        );
        return;
      }

      const accepted: File[] = [];
      for (const file of files) {
        if (!plausiblyImage(file)) {
          toast.error(
            `${file.name || "That file"}: only PNG, JPEG, GIF and WebP images.`,
          );
        } else if (file.size > maxBytes) {
          toast.error(
            `${file.name || "That image"} is over ${formatBytes(maxBytes)}.`,
          );
        } else {
          accepted.push(file);
        }
      }
      if (accepted.length > room) {
        toast.error(
          `Only ${room} more ${room === 1 ? "image fits" : "images fit"} on this card.`,
        );
        accepted.length = room;
      }
      if (accepted.length === 0) return;

      let succeeded = 0;
      setProgress({ done: 0, total: accepted.length });
      for (const [index, file] of accepted.entries()) {
        const error = await uploadOne(cardId, file);
        if (error) toast.error(`${file.name || "Image"}: ${error}`);
        else succeeded += 1;
        setProgress({ done: index + 1, total: accepted.length });
      }
      setProgress(null);

      if (succeeded > 0) router.refresh();
    },
    [attachments.length, cardId, maxBytes, router],
  );

  // Pasting an image anywhere while the card is open attaches it. Text pastes
  // carry no files and fall straight through to whatever field has focus.
  //
  // A paste into a text field that carries text *as well as* an image is left
  // alone: copying cells from a spreadsheet or a paragraph from a word
  // processor puts both on the clipboard, and the user meant the text.
  useEffect(() => {
    if (!canWrite) return;
    function onPaste(event: ClipboardEvent) {
      const data = event.clipboardData;
      if (!data) return;
      const files = [...data.files].filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      const hasText = data.types.some(
        (t) => t === "text/plain" || t === "text/html",
      );
      if (hasText && isEditableTarget(event.target)) return;
      event.preventDefault();
      if (uploading) {
        toast.error("Wait for the current upload to finish.");
        return;
      }
      void upload(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canWrite, upload, uploading]);

  return (
    <section className="mt-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="nqm-skin-kicker text-muted-foreground text-xs uppercase tracking-wide">
          Attachments {attachments.length > 0 ? `· ${attachments.length}` : ""}
        </h2>

        {canWrite ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = "";
                void upload(files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={uploading || full}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus className="size-3.5" aria-hidden="true" />
              )}
              {uploading
                ? `Uploading ${Math.min(progress.done + 1, progress.total)}/${progress.total}…`
                : "Add image"}
            </Button>
          </>
        ) : null}
      </div>

      {attachments.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {canWrite
            ? "No images yet. Add one, or paste a screenshot while this card is open."
            : "No attachments."}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <button
                type="button"
                onClick={() => setViewer({ id: attachment.id, open: true })}
                className="nqm-skin-card bg-muted focus-visible:ring-ring/70 group block aspect-[4/3] w-full overflow-hidden rounded-md border focus-visible:outline-none focus-visible:ring-2"
                aria-label={`Open ${attachment.filename}`}
                title={attachment.filename}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- see the component comment: the optimiser cannot carry the session. */}
                <img
                  src={src(attachment.id)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-opacity group-hover:opacity-90"
                />
              </button>
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {attachment.filename}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canWrite && attachments.length > 0 ? (
        <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
          <Paperclip className="size-3.5" aria-hidden="true" />
          Paste an image to attach it · up to {formatBytes(maxBytes)} each.
        </p>
      ) : null}

      <AttachmentViewer
        attachment={viewed}
        open={Boolean(viewer?.open && viewed)}
        canWrite={canWrite}
        onClose={() => setViewer((v) => (v ? { ...v, open: false } : null))}
      />
    </section>
  );
}

/** Full-size view, with delete for whoever the server would let delete it. */
function AttachmentViewer({
  attachment,
  open,
  canWrite,
  onClose,
}: {
  attachment: CardDetailAttachment | null;
  open: boolean;
  canWrite: boolean;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, quick] = useQuickAction();
  const mayDelete = canWrite && attachment?.canDelete;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirming(false);
          onClose();
        }
      }}
    >
      <DialogContent className="nqm-skin-modal w-[calc(100vw-2rem)] max-w-4xl gap-3 p-4 sm:max-w-4xl">
        {attachment ? (
          <>
            <DialogTitle className="truncate pr-8 text-sm font-medium">
              {attachment.filename}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              {formatBytes(attachment.byteSize)} ·{" "}
              {attachment.uploaderName ?? "Deleted user"} ·{" "}
              <RelativeTime iso={attachment.createdAtIso} />
            </DialogDescription>

            <div className="bg-muted flex max-h-[70vh] min-h-40 items-center justify-center overflow-auto rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element -- authorised per request; see CardAttachments. */}
              <img
                src={src(attachment.id)}
                alt={attachment.filename}
                className="max-h-[70vh] w-auto max-w-full object-contain"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={src(attachment.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open original
                </a>
              </Button>

              {mayDelete ? (
                confirming ? (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      Delete this image for everyone?
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        quick(
                          deleteAttachmentAction,
                          { attachmentId: attachment.id },
                          {
                            successMessage: true,
                            onDone: () => {
                              setConfirming(false);
                              onClose();
                            },
                          },
                        )
                      }
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirming(true)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete
                  </Button>
                )
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
