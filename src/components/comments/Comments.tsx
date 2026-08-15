import { useEffect, useState } from "react";
import type { Comment } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { usePulseStore } from "@/stores/pulseStore";
import { subscribeCommentsFor, addComment, editComment, deleteComment } from "@/services/firestore/comments";
import { confirmAt } from "@/stores/confirmStore";
import { useT } from "@/i18n";
import { CommentThread } from "./CommentThread";
import { notifyParticipants } from "./notify";

/** Comment thread for a single target (a task id, or null for Pulse-level).
 * Used inline in the mobile task editor. */
export function Comments({ pulseId, targetId }: { pulseId: string; targetId: string | null }) {
  const t = useT();
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const email = useAuthStore((s) => s.firebaseUser?.email ?? "");
  const isOwner = usePulseStore((s) => (uid ? s.roleOf(uid) === "owner" : false));
  const members = usePulseStore((s) => s.members);
  const featureTitle = usePulseStore((s) => (targetId ? s.features.find((f) => f.id === targetId)?.title ?? t("comments.aTask") : t("comments.thePulse")));
  const [comments, setComments] = useState<Comment[]>([]);

  useEffect(() => subscribeCommentsFor(pulseId, targetId, setComments), [pulseId, targetId]);

  const add = async (parentId: string | null, text: string) => {
    if (!uid) return;
    await addComment(pulseId, targetId, parentId, uid, email, text);
    await notifyParticipants({ pulseId, targetId, threadComments: comments, actorUid: uid, actorEmail: email, memberUids: members.map((m) => m.uid), featureTitle, text });
  };
  const del = async (c: Comment, e: { clientX: number; clientY: number }) => {
    if (await confirmAt(e, { message: t("comments.deleteConfirm"), confirmLabel: t("common.delete") })) await deleteComment(pulseId, c.id).catch(() => {});
  };
  const edit = async (c: Comment, text: string) => {
    await editComment(pulseId, c.id, text).catch(() => {});
  };

  return (
    <div>
      <div className="mono mb-1.5" style={{ fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("pulse.comments")}</div>
      <CommentThread comments={comments} currentUid={uid} canModerate={isOwner} onAdd={add} onDelete={del} onEdit={edit} />
    </div>
  );
}
