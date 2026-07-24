import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { Comment, CommentRef } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { usePulseStore } from "@/stores/pulseStore";
import { subscribeAllComments, addComment, editComment, deleteComment } from "@/services/firestore/comments";
import { confirmAt } from "@/stores/confirmStore";
import { CommentThread } from "./CommentThread";
import { MentionTextarea } from "./MentionTextarea";
import { detectMentions, type MentionSuggestion } from "./mentions";
import { notifyParticipants } from "./notify";

interface Props {
  pulseId: string;
  onSelectTask: (featureId: string) => void;
  /** Currently-selected task / resource on the canvas — a new comment attaches
   * to whichever is set (task wins). */
  selectedFeatureId?: string | null;
  selectedResourceId?: string | null;
  onSelectResource?: (resourceId: string | null) => void;
}

/** The Comments drawer: a context-aware composer (attaches to the selected
 * task/resource, with @-mention autocomplete), a content/target filter, and one
 * flat conversation feed — every comment in the Pulse, each showing the
 * task/resource it's about as a chip. */
export function AllCommentsPanel({ pulseId, onSelectTask, selectedFeatureId, selectedResourceId, onSelectResource }: Props) {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const email = useAuthStore((s) => s.firebaseUser?.email ?? "");
  const isOwner = usePulseStore((s) => (uid ? s.roleOf(uid) === "owner" : false));
  const members = usePulseStore((s) => s.members);
  const features = usePulseStore((s) => s.features);
  const resources = usePulseStore((s) => s.resources);
  const [all, setAll] = useState<Comment[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);

  // Composer state.
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [detach, setDetach] = useState(false); // user cleared the context chip → post at Pulse level
  // Filter state.
  const [q, setQ] = useState("");
  const [scopeSel, setScopeSel] = useState("all"); // "all" | "pulse" | "task:<id>" | "resource:<id>"

  useEffect(() => subscribeAllComments(pulseId, setAll), [pulseId]);
  // Re-attach the composer to whatever is now selected on the canvas.
  useEffect(() => setDetach(false), [selectedFeatureId, selectedResourceId]);
  // Keep the newest comment (nearest the bottom composer) in view.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [all.length]);

  const resourceName = (r: { name: string; initials: string }) => r.name?.trim() || r.initials;
  const nameFor = (kind: "task" | "resource", id: string): string =>
    kind === "task"
      ? features.find((f) => f.id === id)?.title || "Untitled task"
      : (() => { const r = resources.find((x) => x.id === id); return r ? resourceName(r) : "Unknown resource"; })();

  const suggestions: MentionSuggestion[] = useMemo(
    () => [
      ...features.map((f) => ({ kind: "task" as const, id: f.id, label: f.title || "Untitled task" })),
      ...resources.map((r) => ({ kind: "resource" as const, id: r.id, label: resourceName(r) })),
    ],
    [features, resources],
  );

  // What a new comment attaches to, from the current canvas selection.
  const context: CommentRef | null = useMemo(() => {
    if (detach) return null;
    const f = selectedFeatureId ? features.find((x) => x.id === selectedFeatureId) : null;
    if (f) return { kind: "task", id: f.id, label: f.title || "Untitled task" };
    const r = selectedResourceId ? resources.find((x) => x.id === selectedResourceId) : null;
    if (r) return { kind: "resource", id: r.id, label: resourceName(r) };
    return null;
  }, [detach, selectedFeatureId, selectedResourceId, features, resources]);
  const hasSelection = !!(selectedFeatureId || selectedResourceId);

  // The task this comment is attached to (task/resource), for the feed chips.
  const targetOf = (c: Comment): CommentRef | null =>
    c.targetId ? { kind: c.targetKind ?? "task", id: c.targetId, label: nameFor(c.targetKind ?? "task", c.targetId) } : null;

  // Tasks/resources referenced anywhere (as a target or a mention) — the filter
  // dropdown options.
  const { refTasks, refResources, hasPulse } = useMemo(() => {
    const tasks = new Map<string, string>();
    const res = new Map<string, string>();
    let pulse = false;
    for (const c of all) {
      if (c.targetId == null) pulse = true;
      else (c.targetKind === "resource" ? res : tasks).set(c.targetId, nameFor(c.targetKind ?? "task", c.targetId));
      for (const m of c.mentions ?? []) (m.kind === "resource" ? res : tasks).set(m.id, m.label || nameFor(m.kind, m.id));
    }
    const toArr = (m: Map<string, string>) => [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return { refTasks: toArr(tasks), refResources: toArr(res), hasPulse: pulse };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, features, resources]);

  // ── Filtering (content + scope), thread-preserving ────────────────────────
  const ql = q.trim().toLowerCase();
  const refersTo = (c: Comment, kind: string, id: string) =>
    (c.targetId === id && (c.targetKind ?? "task") === kind) || (c.mentions ?? []).some((m) => m.kind === kind && m.id === id);
  const matchContent = (c: Comment) =>
    !ql ||
    c.text.toLowerCase().includes(ql) ||
    (c.mentions ?? []).some((m) => m.label.toLowerCase().includes(ql)) ||
    (targetOf(c)?.label.toLowerCase().includes(ql) ?? false);
  const matchScope = (c: Comment) => {
    if (scopeSel === "all") return true;
    if (scopeSel === "pulse") return c.targetId == null;
    const [k, id] = scopeSel.split(":");
    return refersTo(c, k, id);
  };

  const visible = useMemo(() => {
    const tops = all.filter((c) => !c.parentId);
    const repliesOf = (id: string) => all.filter((c) => c.parentId === id);
    const out: Comment[] = [];
    for (const top of tops) {
      const thread = [top, ...repliesOf(top.id)];
      if (thread.some(matchScope) && thread.some(matchContent)) out.push(...thread);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, ql, scopeSel]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const del = async (c: Comment, e: { clientX: number; clientY: number }) => {
    if (await confirmAt(e, { message: "Delete this comment?", confirmLabel: "Delete" })) await deleteComment(pulseId, c.id).catch(() => {});
  };
  const edit = async (c: Comment, newText: string) => {
    const mentions = detectMentions(newText, suggestions).map((m) => ({ kind: m.kind, id: m.id, label: m.label }));
    await editComment(pulseId, c.id, newText, mentions).catch(() => {});
  };
  const onRefClick = (r: CommentRef) => (r.kind === "task" ? onSelectTask(r.id) : onSelectResource?.(r.id));

  const post = async () => {
    const t = text.trim();
    if (!t || busy || !uid) return;
    setBusy(true);
    const targetId = context?.id ?? null;
    const targetKind = context?.kind ?? "task";
    const mentions = detectMentions(t, suggestions).map((m) => ({ kind: m.kind, id: m.id, label: m.label }));
    const label = context ? context.label : "the Pulse";
    setText("");
    try {
      await addComment(pulseId, targetId, null, uid, email, t, { targetKind, mentions });
      await notifyParticipants({ pulseId, targetId, threadComments: all.filter((c) => c.targetId === targetId), actorUid: uid, actorEmail: email, memberUids: members.map((m) => m.uid), featureTitle: label, text: t });
    } finally {
      setBusy(false);
    }
  };

  // Replies inherit the target of the comment they answer.
  const onReply = async (parentId: string | null, body: string) => {
    if (!uid || !parentId) return;
    const parent = all.find((c) => c.id === parentId);
    const targetId = parent?.targetId ?? null;
    const targetKind = parent?.targetKind ?? "task";
    const mentions = detectMentions(body, suggestions).map((m) => ({ kind: m.kind, id: m.id, label: m.label }));
    const label = targetId ? nameFor(targetKind, targetId) : "the Pulse";
    await addComment(pulseId, targetId, parentId, uid, email, body, { targetKind, mentions });
    await notifyParticipants({ pulseId, targetId, threadComments: all.filter((c) => c.targetId === targetId), actorUid: uid, actorEmail: email, memberUids: members.map((m) => m.uid), featureTitle: label, text: body });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar — by content and/or by a specific task/resource. */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: "#E2DFD9" }}>
        <div className="flex items-center gap-1 rounded px-1.5 flex-1" style={{ border: "1px solid #E2DFD9", background: "#FFFFFF" }}>
          <Icon name="search" size={13} style={{ color: "#94A3B8" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter comments…" className="bg-transparent text-xs py-1 flex-1" style={{ color: "#334155", outline: "none", minWidth: 0 }} />
          {q && <button onClick={() => setQ("")} title="Clear"><Icon name="close" size={12} style={{ color: "#94A3B8" }} /></button>}
        </div>
        <select value={scopeSel} onChange={(e) => setScopeSel(e.target.value)} className="text-xs rounded px-1.5 py-1" style={{ border: "1px solid #E2DFD9", background: "#FFFFFF", color: "#334155", maxWidth: 130 }} title="Filter by task or resource">
          <option value="all">All comments</option>
          {hasPulse && <option value="pulse">Pulse-level only</option>}
          {refTasks.length > 0 && (
            <optgroup label="Tasks">
              {refTasks.map((t) => <option key={t.id} value={`task:${t.id}`}>{t.name}</option>)}
            </optgroup>
          )}
          {refResources.length > 0 && (
            <optgroup label="Resources">
              {refResources.map((r) => <option key={r.id} value={`resource:${r.id}`}>{r.name}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {/* One flat conversation — scrolls between the filter and the composer. */}
      <div ref={feedRef} className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
        {visible.length === 0 ? (
          <span className="text-xs" style={{ color: "#94A3B8" }}>
            {all.length === 0 ? "No comments yet. Select a task or resource and comment below, or comment on the Pulse." : "No comments match this filter."}
          </span>
        ) : (
          <CommentThread comments={visible} currentUid={uid} canModerate={isOwner} composer={false} suggestions={suggestions} onAdd={onReply} onDelete={del} onEdit={edit} onRefClick={onRefClick} targetOf={targetOf} />
        )}
      </div>

      {/* Composer — pinned to the bottom; attaches to the selected
          task/resource, with @-mention autocomplete. */}
      <div className="p-3 border-t flex-shrink-0" style={{ borderColor: "#E2DFD9", background: "#FBFAF7" }}>
        <div className="flex items-center gap-1.5 mb-1.5" style={{ minHeight: 20 }}>
          <span className="mono" style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase" }}>Comment on</span>
          {context ? (
            <span className="mono inline-flex items-center gap-0.5 rounded px-1.5 py-0.5" style={{ fontSize: 10, background: context.kind === "task" ? "#FCEEE4" : "#E7F6F1", color: context.kind === "task" ? "#C2410C" : "#0F766E" }}>
              <Icon name={context.kind === "task" ? "checklist" : "group"} size={11} /> @{context.label}
              <button onClick={() => setDetach(true)} title="Comment on the Pulse instead" style={{ display: "flex", marginLeft: 2 }}><Icon name="close" size={11} /></button>
            </span>
          ) : (
            <>
              <span className="text-xs font-semibold" style={{ color: "#334155" }}>the Pulse</span>
              {hasSelection && detach && (
                <button onClick={() => setDetach(false)} className="mono hover:underline" style={{ fontSize: 9, color: "#1B3A63" }}>attach to selection</button>
              )}
            </>
          )}
        </div>
        <div className="flex items-end gap-1.5">
          <MentionTextarea value={text} onChange={setText} suggestions={suggestions} onSubmit={() => void post()} placeholder="Add a comment… type @ to tag a task or resource (⌘↵)" />
          <button onClick={() => void post()} disabled={!text.trim() || busy} title="Send" aria-label="Send" className="rounded flex items-center justify-center flex-shrink-0 disabled:opacity-40" style={{ width: 32, height: 32, background: "#D85A28", color: "#fff" }}>
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
