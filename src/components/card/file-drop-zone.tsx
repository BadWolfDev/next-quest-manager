"use client";

import { Loader2, Upload } from "lucide-react";

import {
  describeProgress,
  useFileDropTarget,
  usePreventFileDropNavigation,
  type AttachmentUploader,
} from "@/components/card/attachment-upload";
import { formatBytes } from "@/lib/attachments";
import { cn } from "@/lib/utils";

/**
 * The card detail's drop target: drag files anywhere over the card and an
 * overlay says so; drop them and they upload like a multi-select.
 *
 * Rendered as the card detail's root element (it takes the root's classes), so
 * the whole card — modal or standalone page — is the target. Disabled for
 * viewers: no handlers and no overlay, though a stray drop still cannot
 * navigate the tab away to the file.
 */
export function FileDropZone({
  enabled,
  uploader,
  maxBytes,
  className,
  children,
}: {
  enabled: boolean;
  uploader: AttachmentUploader;
  maxBytes: number;
  className?: string;
  children: React.ReactNode;
}) {
  usePreventFileDropNavigation();
  const { over, handlers } = useFileDropTarget(enabled, (files) => {
    void uploader.upload(files);
  });
  const { progress } = uploader;

  return (
    <div className={cn("relative", className)} {...handlers}>
      {children}

      {over ? (
        <div
          aria-hidden="true"
          className="bg-background/90 border-primary pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed"
        >
          <Upload className="text-primary size-7" />
          <p className="text-sm font-medium">Drop files to attach</p>
          <p className="text-muted-foreground text-xs">
            Any file type · up to {formatBytes(maxBytes)} each
          </p>
        </div>
      ) : null}

      {progress ? (
        <div
          role="status"
          className="bg-popover text-popover-foreground pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b px-5 py-2 text-xs shadow-sm"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span className="truncate">{describeProgress(progress)}</span>
        </div>
      ) : null}
    </div>
  );
}
