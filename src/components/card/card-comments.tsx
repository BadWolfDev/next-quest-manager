"use client";

import { AtSign, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  addCommentAction,
  deleteCommentAction,
  updateCommentAction,
} from "@/actions/comments";
import {
  CardMarkdown,
  RelativeTime,
  useBoundAction,
  useQuickAction,
} from "@/components/card/card-hooks";
import type { CardDetailComment } from "@/components/card/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { initials } from "@/components/board/assignee-popover";

/** Cmd/Ctrl+Enter submits the surrounding form. */
function submitOnMetaEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function CommentRow({
  comment,
  canWrite,
}: {
  comment: CardDetailComment;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, quick] = useQuickAction();
  const [, editAction] = useBoundAction(updateCommentAction, () =>
    setEditing(false),
  );

  const name = comment.authorName ?? "Deleted user";
  // Editing and deleting are the same rule the server enforces (author, or a
  // workspace admin/owner); a viewer never gets either regardless.
  const mayModify = canWrite && comment.canModify;

  return (
    <li className="flex gap-2.5">
      <Avatar className="mt-0.5 size-7 shrink-0" title={name}>
        {comment.authorImage ? (
          <AvatarImage src={comment.authorImage} alt="" />
        ) : null}
        <AvatarFallback className="text-[0.6rem]">
          {initials(name) || "?"}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-medium">{name}</span>
          <RelativeTime
            iso={comment.createdAtIso}
            className="text-muted-foreground"
          />
          {comment.editedAtIso ? (
            <span className="text-muted-foreground italic">edited</span>
          ) : null}
        </p>

        {editing ? (
          <form action={editAction} className="mt-1.5 space-y-2">
            <input type="hidden" name="commentId" value={comment.id} />
            <Textarea
              name="body"
              defaultValue={comment.body}
              autoFocus
              rows={4}
              maxLength={20_000}
              aria-label="Edit comment"
              className="text-sm"
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
                else submitOnMetaEnter(event);
              }}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <CardMarkdown className="mt-1 text-sm leading-relaxed">
              {comment.body}
            </CardMarkdown>

            {mayModify ? (
              <div className="mt-1 flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  onClick={() => {
                    setConfirming(false);
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-3" aria-hidden="true" />
                  Edit
                </Button>

                {confirming ? (
                  <>
                    <span className="text-muted-foreground text-xs">
                      Delete this comment?
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-6 px-1.5 text-xs"
                      disabled={pending}
                      onClick={() =>
                        quick(
                          deleteCommentAction,
                          { commentId: comment.id },
                          {
                            successMessage: true,
                            onDone: () => setConfirming(false),
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
                      className="h-6 px-1.5 text-xs"
                      onClick={() => setConfirming(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive h-6 px-1.5 text-xs"
                    onClick={() => setConfirming(true)}
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                    Delete
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export function CardComments({
  cardId,
  comments,
  canWrite,
}: {
  cardId: string;
  comments: CardDetailComment[];
  canWrite: boolean;
}) {
  // Remount the composer after a successful post so the textarea empties.
  const [composerKey, setComposerKey] = useState(0);
  const [, addAction] = useBoundAction(addCommentAction, () =>
    setComposerKey((n) => n + 1),
  );

  return (
    <section className="mt-7">
      <h2 className="nqm-skin-kicker text-muted-foreground mb-3 text-xs uppercase tracking-wide">
        Comments {comments.length > 0 ? `· ${comments.length}` : ""}
      </h2>

      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No comments yet.</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              canWrite={canWrite}
            />
          ))}
        </ul>
      )}

      {canWrite ? (
        <form key={composerKey} action={addAction} className="mt-4 space-y-2">
          <input type="hidden" name="cardId" value={cardId} />
          <label htmlFor="new-comment" className="sr-only">
            Write a comment
          </label>
          <Textarea
            id="new-comment"
            name="body"
            required
            rows={3}
            maxLength={20_000}
            placeholder="Write a comment…"
            className="text-sm"
            onKeyDown={submitOnMetaEnter}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm">
              Comment
            </Button>
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <AtSign className="size-3.5" aria-hidden="true" />
              Type <code className="font-mono">@name</code> to notify a member.
              <span className="hidden sm:inline">⌘/Ctrl + Enter to post.</span>
            </p>
          </div>
        </form>
      ) : null}
    </section>
  );
}
