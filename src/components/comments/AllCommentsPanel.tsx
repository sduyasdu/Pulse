import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { Comment } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { usePulseStore } from "@/stores/pulseStore";
import { subscribeAllComments, addComment, deleteComment } from "@/services/firestore/comments";
import { confirmAt } from "@/stores/confirmStore";
import { CommentThread } from "./CommentThread";
import { notifyParticipants } from "./notify";

/** The Comments tab: every comment in the Pulse, grouped by task (plus a
 * Pulse-level discussion), each task group linking to open that task. */
export function AllCommentsPanel({ pulseId, onSelectTask }: { pulseId: string; onSelectTask: (featureId: string) => void }) {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const email = useAuthStore((s) => s.firebaseUser?.email ?? "");
  const isOwner = usePulseStore((s) => (uid ? s.roleOf(uid) === "owner" : false));
  const members = usePulseStore((s) => s.members);
  const features = usePulseStore((s) => s.features);
  const [all, setAll] = useState<Comment[]>([]);

  useEffect(() => subscribeAllComments(pulseId, setAll), [pulseId]);

  const { pulseComments, taskGroups } = useMemo(() => {
    const pulseComments = all.filter((c) => c.targetId == null);
    const groups = features
      .map((f) => ({ feature: f, comments: all.filter((c) => c.targetId === f.id) }))
      .filter((g) => g.comments.length > 0)
      // Most recently active tasks first.
      .sort((a, b) => Math.max(...b.comments.map((c) => c.createdAt)) - Math.max(...a.comments.map((c) => c.createdAt)));
    return { pulseComments, taskGroups: groups };
  }, [all, features]);

  const del = async (c: Comment, e: { clientX: number; clientY: number }) => {
    if (await confirmAt(e, { message: "Delete this comment?", confirmLabel: "Delete" })) await deleteComment(pulseId, c.id).catch(() => {});
  };
  const addTo = (targetId: string | null, featureTitle: string) => async (parentId: string | null, text: string) => {
    if (!uid) return;
    const threadComments = all.filter((c) => c.targetId === targetId);
    await addComment(pulseId, targetId, parentId, uid, email, text);
    await notifyParticipants({ pulseId, targetId, threadComments, actorUid: uid, actorEmail: email, memberUids: members.map((m) => m.uid), featureTitle, text });
  };

  return (
    <div className="flex flex-col gap-5 p-3">
      <section>
        <div className="mono text-xs font-semibold mb-2" style={{ color: "#334155" }}>Pulse discussion</div>
        <CommentThread comments={pulseComments} currentUid={uid} canModerate={isOwner} onAdd={addTo(null, "the Pulse")} onDelete={del} />
      </section>

      {taskGroups.map((g) => (
        <section key={g.feature.id}>
          <button
            onClick={() => onSelectTask(g.feature.id)}
            className="flex items-center gap-1 text-xs font-semibold mb-2 hover:underline text-left w-full"
            style={{ color: "#1B3A63" }}
            title="Open this task"
          >
            <span className="truncate">{g.feature.title || "Untitled task"}</span>
            <span style={{ color: "#94A3B8" }}>· {g.comments.filter((c) => !c.parentId).length}</span>
            <Icon name="open_in_new" size={12} style={{ color: "#94A3B8", marginLeft: "auto" }} />
          </button>
          <CommentThread comments={g.comments} currentUid={uid} canModerate={isOwner} onAdd={addTo(g.feature.id, g.feature.title || "a task")} onDelete={del} />
        </section>
      ))}

      {pulseComments.length === 0 && taskGroups.length === 0 && (
        <span className="text-xs" style={{ color: "#94A3B8" }}>No comments yet. Start a Pulse discussion above, or comment on any task.</span>
      )}
    </div>
  );
}
