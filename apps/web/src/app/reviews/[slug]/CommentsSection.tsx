"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  COMMENT_BODY_MAX,
  COMMENT_KINDS,
  type CommentKind,
  type ReviewCommentList,
} from "@oratlas/contracts";

const KIND_LABELS: Record<CommentKind, string> = {
  comment: "Comment",
  question: "Question",
  concern: "Concern",
  suggestion: "Suggestion",
  endorsement: "Endorsement",
};

const KIND_TONES: Record<CommentKind, string> = {
  comment: "neutral",
  question: "neutral",
  concern: "warning",
  suggestion: "neutral",
  endorsement: "success",
};

export interface CommentClaimOption {
  localClaimId: string;
  anchor?: string;
  text: string;
}

export interface CommentViewer {
  githubLogin: string;
  displayName: string | null;
  isEditor: boolean;
}

interface CommentFormProps {
  reviewSlug: string;
  claims: CommentClaimOption[];
  parentId?: string;
  onDone?: () => void;
}

function CommentForm({ reviewSlug, claims, parentId, onDone }: CommentFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<CommentKind>(parentId ? "comment" : "question");
  const [claimLocalId, setClaimLocalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReply = Boolean(parentId);
  const idPrefix = parentId ? `reply-${parentId}` : "new-comment";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(reviewSlug)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          kind,
          claimLocalId: claimLocalId || undefined,
          parentId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not post the comment.");
        return;
      }
      setBody("");
      setClaimLocalId("");
      onDone?.();
      router.refresh();
    } catch {
      setError("Network error — the comment was not posted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="comment-form" onSubmit={submit}>
      {!isReply ? (
        <div className="comment-form-row">
          <div className="field">
            <label htmlFor={`${idPrefix}-kind`}>Type</label>
            <select
              id={`${idPrefix}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as CommentKind)}
            >
              {COMMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {claims.length > 0 ? (
            <div className="field">
              <label htmlFor={`${idPrefix}-claim`}>About</label>
              <select
                id={`${idPrefix}-claim`}
                value={claimLocalId}
                onChange={(e) => setClaimLocalId(e.target.value)}
              >
                <option value="">The whole review</option>
                {claims.map((c) => (
                  <option key={c.localClaimId} value={c.localClaimId}>
                    {c.localClaimId} — {c.text.length > 70 ? `${c.text.slice(0, 70)}…` : c.text}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`${idPrefix}-body`}>{isReply ? "Your reply" : "Your comment"}</label>
        <textarea
          id={`${idPrefix}-body`}
          value={body}
          maxLength={COMMENT_BODY_MAX}
          placeholder={
            isReply
              ? "Reply to this comment…"
              : "Ask a question, raise a methodological concern, suggest missing evidence…"
          }
          onChange={(e) => setBody(e.target.value)}
        />
        <small>Plain text only. Be specific — reference claims, citations, or methods.</small>
      </div>
      <div className="btn-row">
        <button className="btn" type="submit" disabled={busy || !body.trim()}>
          {busy ? "Posting…" : isReply ? "Post reply" : "Post comment"}
        </button>
        {onDone ? (
          <button className="btn btn-secondary" type="button" onClick={onDone} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function AuthorLine({
  comment,
}: {
  comment: ReviewCommentList["comments"][number] | ReviewCommentList["comments"][number]["replies"][number];
}) {
  const date = comment.createdAt.slice(0, 10);
  return (
    <div className="comment-meta">
      <span className={`badge badge-${KIND_TONES[comment.kind]}`}>
        {KIND_LABELS[comment.kind]}
      </span>
      <strong>{comment.author?.displayName ?? comment.author?.githubLogin ?? "—"}</strong>
      {comment.author && (comment.author.role === "EDITOR" || comment.author.role === "ADMIN") ? (
        <span className="badge">editor</span>
      ) : null}
      <span className="muted">{date}</span>
      {comment.claimLocalId ? (
        <a className="mono" href={`#${comment.claimAnchor ?? comment.claimLocalId}`}>
          on {comment.claimLocalId}
        </a>
      ) : null}
    </div>
  );
}

export function CommentsSection({
  reviewSlug,
  list,
  claims,
  viewer,
}: {
  reviewSlug: string;
  list: ReviewCommentList;
  claims: CommentClaimOption[];
  viewer: CommentViewer | null;
}) {
  const router = useRouter();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function canRemove(authorLogin?: string | null): boolean {
    if (!viewer || !authorLogin) return false;
    return viewer.isEditor || viewer.githubLogin === authorLogin;
  }

  async function remove(commentId: string) {
    setRemoveError(null);
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setRemoveError(data?.error?.message ?? "Could not remove the comment.");
        return;
      }
      router.refresh();
    } catch {
      setRemoveError("Network error — the comment was not removed.");
    }
  }

  return (
    <section id="community-review" aria-label="Community review and discussion">
      <div className="card">
        <h2 className="card-title">
          Community review &amp; discussion{" "}
          <span className="muted comment-count">({list.commentCount})</span>
        </h2>
        <p className="muted comment-intro">
          Open scholarly exchange on this review: ask questions, raise concerns, suggest evidence,
          or endorse findings. Comments can address the whole review or a specific claim, and are
          publicly attributed to your account.
        </p>

        {viewer ? (
          <CommentForm reviewSlug={reviewSlug} claims={claims} />
        ) : (
          <p className="notice notice-info">
            <Link href="/signin">Sign in</Link> to join the discussion — comments are attributed
            and moderated by editors.
          </p>
        )}

        {removeError ? (
          <p className="notice notice-error" role="alert">
            {removeError}
          </p>
        ) : null}

        {list.comments.length === 0 ? (
          <p className="muted">No comments yet. Start the exchange above.</p>
        ) : (
          <ul className="comment-list">
            {list.comments.map((comment) => (
              <li className="comment" key={comment.id}>
                {comment.status === "removed" ? (
                  <p className="muted comment-removed">Comment removed.</p>
                ) : (
                  <>
                    <AuthorLine comment={comment} />
                    <p className="comment-body">{comment.body}</p>
                    <div className="btn-row comment-actions">
                      {viewer ? (
                        <button
                          className="btn-link"
                          type="button"
                          onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                        >
                          Reply
                        </button>
                      ) : null}
                      {canRemove(comment.author?.githubLogin) ? (
                        <button
                          className="btn-link btn-link-danger"
                          type="button"
                          onClick={() => remove(comment.id)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </>
                )}

                {replyTo === comment.id && viewer ? (
                  <div className="comment-replies">
                    <CommentForm
                      reviewSlug={reviewSlug}
                      claims={[]}
                      parentId={comment.id}
                      onDone={() => setReplyTo(null)}
                    />
                  </div>
                ) : null}

                {comment.replies.length > 0 ? (
                  <ul className="comment-list comment-replies">
                    {comment.replies.map((reply) => (
                      <li className="comment" key={reply.id}>
                        <AuthorLine comment={reply} />
                        <p className="comment-body">{reply.body}</p>
                        {canRemove(reply.author?.githubLogin) ? (
                          <div className="btn-row comment-actions">
                            <button
                              className="btn-link btn-link-danger"
                              type="button"
                              onClick={() => remove(reply.id)}
                            >
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
