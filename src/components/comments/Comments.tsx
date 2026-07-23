import { useEffect, useState } from "react";
import type { Comment } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { usePulseStore } from "@/stores/pulseStore";
import { subscribeComments, addComment, deleteComment } from "@/services/firestore/comments";
import { createNotification } from "@/services/firestore/notifications";
import { colorForName } from "@/domain/constants";
import { confirmAt } from "@/stores/confirmStore";

function initials(email: string): string {
  const local = (email.split("@")[0] || email).replace(/[^a-zA-Z0-9]/g, "");
  return (local.slice(0, 2) || "?").toUpperCase();
}

function when(ms: number): string {
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Task comment thread. Any member can comment (viewers included); authors and
 * the Pulse owner can delete. */
export function Comments({ pulseId, featureId }: { pulseId: string; featureId: string }) {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const email = useAuthStore((s) => s.firebaseUser?.email ?? "");
  const isOwner = usePulseStore((s) => (uid ? s.roleOf(uid) === "owner" : false));
  const featureTitle = usePulseStore((s) => s.features.find((f) => f.id === featureId)?.title ?? "a task");
  const members = usePulseStore((s) => s.members);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeComments(pulseId, featureId, setComments), [pulseId, featureId]);

  const submit = async () => {
    const t = text.trim();
    if (!t || !uid || busy) return;
    setBusy(true);
    setText("");
    try {
      await addComment(pulseId, featureId, uid, email, t);
      // Notify the other participants already in this thread (and who are still
      // members), so they see the reply.
      const memberUids = new Set(members.map((m) => m.uid));
      const recipients = [...new Set(comments.map((c) => c.authorUid))].filter((p) => p !== uid && memberUids.has(p));
      await Promise.all(
        recipients.map((targetUid) =>
          createNotification(pulseId, {
            targetUid,
            actorUid: uid,
            actorEmail: email,
            type: "comment",
            featureId,
            featureTitle,
            text: t.slice(0, 90),
            createdAt: Date.now(),
            read: false,
          }),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Comment, e: { clientX: number; clientY: number }) => {
    if (!(await confirmAt(e, { message: "Delete this comment?", confirmLabel: "Delete" }))) return;
    await deleteComment(pulseId, featureId, c.id).catch(() => {});
  };

  return (
    <div>
      <div className="mono mb-1.5" style={{ fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Comments {comments.length > 0 && <span style={{ color: "#94A3B8" }}>{comments.length}</span>}
      </div>

      <div className="flex flex-col gap-2 mb-2">
        {comments.length === 0 && <span className="text-xs" style={{ color: "#94A3B8" }}>No comments yet.</span>}
        {comments.map((c) => {
          const mine = c.authorUid === uid;
          return (
            <div key={c.id} className="flex items-start gap-2">
              <span className="mono flex items-center justify-center" style={{ width: 20, height: 20, borderRadius: "50%", background: colorForName(c.authorUid), color: "#fff", fontSize: 8, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{initials(c.authorEmail)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold truncate" style={{ color: "#334155" }}>{mine ? "You" : c.authorEmail}</span>
                  <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>{when(c.createdAt)}{c.editedAt ? " · edited" : ""}</span>
                  {(mine || isOwner) && (
                    <button onClick={(e) => void remove(c, e)} className="mono ml-auto" style={{ fontSize: 9, color: "#CBD5E1" }} title="Delete comment">✕</button>
                  )}
                </div>
                <div className="text-xs" style={{ color: "#1F2330", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-end gap-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }}
          placeholder="Add a comment… (⌘↵ to send)"
          rows={2}
          className="text-xs flex-1 rounded px-2 py-1.5"
          style={{ border: "1px solid #E2DFD9", outline: "none", color: "#334155", resize: "vertical" }}
        />
        <button
          onClick={() => void submit()}
          disabled={!text.trim() || busy}
          className="rounded px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
          style={{ background: "#D85A28", color: "#fff" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
