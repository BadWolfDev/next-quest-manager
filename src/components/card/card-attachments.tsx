"use client";

import {
  Download,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FilePlay,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { createElement, useEffect, useRef, useState } from "react";

import { deleteAttachmentAction } from "@/actions/attachments";
import {
  describeProgress,
  type AttachmentUploader,
} from "@/components/card/attachment-upload";
import { RelativeTime, useQuickAction } from "@/components/card/card-hooks";
import type { CardDetailAttachment } from "@/components/card/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_ATTACHMENTS_PER_CARD, formatBytes } from "@/lib/attachments";

/**
 * The card's attachments: images as a thumbnail grid with a viewer, every
 * other file as a download row.
 *
 * Which is which comes from the server (`isImage`, i.e. the stored type was
 * sniffed from the bytes as PNG/JPEG/GIF/WebP) — never from the filename. A
 * `.png` that is really HTML is a file row, and the route serves it as a
 * download whatever this component does.
 *
 * Thumbnails, the viewer and downloads are plain elements pointed at
 * `/api/attachments/<id>`, which re-authorises every request with the session
 * cookie. `next/image` is deliberately not used: its optimiser fetches the
 * source server-side *without* the viewer's cookie, so it would only ever see
 * the 404 an anonymous caller gets.
 *
 * Uploads (button, pasting files anywhere while the card is open, or dropping
 * them on the card — see `FileDropZone`) all go through the card's one
 * `AttachmentUploader`.
 */

const src = (id: string) => `/api/attachments/${id}`;

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

const ICON_BY_EXTENSION: Record<string, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  odt: FileText,
  rtf: FileText,
  txt: FileText,
  md: FileText,
  zip: FileArchive,
  gz: FileArchive,
  tgz: FileArchive,
  tar: FileArchive,
  "7z": FileArchive,
  rar: FileArchive,
  csv: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  ods: FileSpreadsheet,
  mp3: FileMusic,
  wav: FileMusic,
  flac: FileMusic,
  ogg: FileMusic,
  m4a: FileMusic,
  mp4: FilePlay,
  mov: FilePlay,
  webm: FilePlay,
  mkv: FilePlay,
  avi: FilePlay,
  html: FileCode,
  htm: FileCode,
  js: FileCode,
  ts: FileCode,
  json: FileCode,
  xml: FileCode,
  css: FileCode,
  py: FileCode,
  sh: FileCode,
  svg: FileImage,
  heic: FileImage,
  tif: FileImage,
  tiff: FileImage,
  bmp: FileImage,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
};

/** Cosmetic only: the extension picks an icon, nothing else. */
function iconFor(filename: string): LucideIcon {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return ICON_BY_EXTENSION[ext] ?? FileIcon;
}

export function CardAttachments({
  attachments,
  maxBytes,
  uploader,
  canWrite,
}: {
  attachments: CardDetailAttachment[];
  maxBytes: number;
  uploader: AttachmentUploader;
  canWrite: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The id outlives `open` so the dialog keeps its content (and its title)
  // through the close animation.
  const [viewer, setViewer] = useState<{ id: string; open: boolean } | null>(
    null,
  );
  const viewed = attachments.find((a) => a.id === viewer?.id) ?? null;

  const images = attachments.filter((a) => a.isImage);
  const files = attachments.filter((a) => !a.isImage);

  const { upload, progress, uploading } = uploader;
  const full = attachments.length >= MAX_ATTACHMENTS_PER_CARD;

  // Pasting files anywhere while the card is open attaches them. Text pastes
  // carry no files and fall straight through to whatever field has focus.
  //
  // A paste into a text field that carries text *as well as* a file is left
  // alone: copying cells from a spreadsheet or a paragraph from a word
  // processor puts both on the clipboard, and the user meant the text.
  useEffect(() => {
    if (!canWrite) return;
    function onPaste(event: ClipboardEvent) {
      const data = event.clipboardData;
      if (!data) return;
      const pasted = [...data.files];
      if (pasted.length === 0) return;
      const hasText = data.types.some(
        (t) => t === "text/plain" || t === "text/html",
      );
      if (hasText && isEditableTarget(event.target)) return;
      event.preventDefault();
      // `upload` refuses (with a toast) while another batch is in flight.
      void upload(pasted);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canWrite, upload]);

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
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const picked = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = "";
                void upload(picked);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 max-w-[60%] text-xs"
              disabled={uploading || full}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="size-3.5" aria-hidden="true" />
              )}
              <span className="truncate">
                {progress ? describeProgress(progress) : "Add files"}
              </span>
            </Button>
          </>
        ) : null}
      </div>

      {attachments.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {canWrite
            ? "No attachments yet. Add files, drop them on this card, or paste a screenshot."
            : "No attachments."}
        </p>
      ) : null}

      {images.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((attachment) => (
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
      ) : null}

      {files.length > 0 ? (
        <ul className={images.length > 0 ? "mt-3 space-y-1.5" : "space-y-1.5"}>
          {files.map((attachment) => (
            <FileRow
              key={attachment.id}
              attachment={attachment}
              canWrite={canWrite}
            />
          ))}
        </ul>
      ) : null}

      {canWrite && attachments.length > 0 ? (
        <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
          <Paperclip className="size-3.5" aria-hidden="true" />
          Drop or paste files to attach · up to {formatBytes(maxBytes)} each.
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

/** A non-image attachment: icon, name, details, download, and delete if allowed. */
function FileRow({
  attachment,
  canWrite,
}: {
  attachment: CardDetailAttachment;
  canWrite: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, quick] = useQuickAction();
  const mayDelete = canWrite && attachment.canDelete;

  return (
    <li className="nqm-skin-card bg-card flex items-center gap-3 rounded-md border px-3 py-2">
      {createElement(iconFor(attachment.filename), {
        className: "text-muted-foreground size-5 shrink-0",
        "aria-hidden": true,
      })}
      <div className="min-w-0 flex-1">
        <a
          href={src(attachment.id)}
          download={attachment.filename}
          className="block truncate text-sm font-medium hover:underline"
          title={attachment.filename}
        >
          {attachment.filename}
        </a>
        <p className="text-muted-foreground truncate text-xs">
          {formatBytes(attachment.byteSize)} ·{" "}
          {attachment.uploaderName ?? "Deleted user"} ·{" "}
          <RelativeTime iso={attachment.createdAtIso} />
        </p>
      </div>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-7 text-xs"
            disabled={pending}
            onClick={() =>
              quick(
                deleteAttachmentAction,
                { attachmentId: attachment.id },
                { successMessage: true, onDone: () => setConfirming(false) },
              )
            }
          >
            Delete
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-7"
            title="Download"
          >
            <a href={src(attachment.id)} download={attachment.filename}>
              <Download className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Download {attachment.filename}</span>
            </a>
          </Button>
          {mayDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive size-7"
              title="Delete"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Delete {attachment.filename}</span>
            </Button>
          ) : null}
        </div>
      )}
    </li>
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
