import { useEffect, useMemo, useState } from "react";
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

type Scope = { kind: "all" | "pulse" } | { kind: "task" | "resource"; id: string };

/** The Comments drawer: a context-aware composer (attaches to the selected
 * task/resource, with @-mention autocomplete), a content/target filter, and the
 * full comment feed grouped by target. */
export function AllCommentsPanel({ pulseId, onSelectTask, selectedFeatureId, selectedResourceId, onSelectResource }: Props) {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const email = useAuthStore((s) => s.firebaseUser?.email ?? "");
  const isOwner = usePulseStore((s) => (uid ? s.roleOf(uid) === "owner" : false));
  const members = usePulseStore((s) => s.members);
  const features = usePulseStore((s) => s.features);
  const resources = usePulseStore((s) => s.resources);
  const [all, setAll] = useState<Comment[]>([]);

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

  const resourceName = (r: { name: string; initials: string }) => r.name?.trim() || r.initials;
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

  // ── Feed grouping (unfiltered) ────────────────────────────────────────────
  const nameFor = (kind: "task" | "resource", id: string) =>
    kind === "task"
      ? features.find((f) => f.id === id)?.title || "Untitled task"
      : (() => { const r = resources.find((x) => x.id === id); return r ? resourceName(r) : "Unknown resource"; })();

  const { pulseComments, taskGroups, resourceGroups } = useMemo(() => {
    const pulse = all.filter((c) => c.targetId == null);
    const groupBy = (kind: "task" | "resource") => {
      const ids = [...new Set(all.filter((c) => c.targetId != null && (c.targetKind ?? "task") === kind).map((c) => c.targetId as string))];
      return ids
        .map((id) => ({ id, name: nameFor(kind, id), comments: all.filter((c) => c.targetId === id && (c.targetKind ?? "task") === kind) }))
        .sort((a, b) => Math.max(...b.comments.map((c) => c.createdAt)) - Math.max(...a.comments.map((c) => c.createdAt)));
    };
    return { pulseComments: pulse, taskGroups: groupBy("task"), resourceGroups: groupBy("resource") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, features, resources]);

  // ── Filtering (content + scope) ───────────────────────────────────────────
  const ql = q.trim().toLowerCase();
  const matchesQ = (cs: Comment[]) =>
    !ql || cs.some((c) => c.text.toLowerCase().includes(ql) || (c.mentions ?? []).some((m) => m.label.toLowerCase().includes(ql)));
  const inScope = (kind: Scope["kind"], id?: string) => {
    if (scopeSel === "all") return true;
    const [k, sid] = scopeSel.split(":");
    return k === kind && (sid === undefined || sid === id);
  };
  const showPulse = inScope("pulse") && matchesQ(pulseComments) && pulseComments.length > 0;
  const shownTasks = taskGroups.filter((g) => inScope("task", g.id) && matchesQ(g.comments));
  const shownResources = resourceGroups.filter((g) => inScope("resource", g.id) && matchesQ(g.comments));
  const nothing = !showPulse && shownTasks.length === 0 && shownResources.length === 0;

  // ── Actions ───────────────────────────────────────────────────────────────
  const del = async (c: Comment, e: { clientX: number; clientY: number }) => {
    if (await confirmAt(e, { message: "Delete this comment?", confirmLabel: "Delete" })) await deleteComment(pulseId, c.id).catch(() => {});
  };
  const edit = async (c: Comment, newText: string) => {
    await editComment(pulseId, c.id, newText).catch(() => {});
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

  // Reply / thread-add helper for a specific existing group.
  const addTo = (targetId: string | null, targetKind: "task" | "resource", label: string) => async (parentId: string | null, body: string) => {
    if (!uid) return;
    const mentions = detectMentions(body, suggestions).map((m) => ({ kind: m.kind, id: m.id, label: m.label }));
    await addComment(pulseId, targetId, parentId, uid, email, body, { targetKind, mentions });
    await notifyParticipants({ pulseId, targetId, threadComments: all.filter((c) => c.targetId === targetId), actorUid: uid, actorEmail: email, memberUids: members.map((m) => m.uid), featureTitle: label, text: body });
  };

  return (
    <div className="flex flex-col">
      {/* Composer — attaches to the selected task/resource, with @-mentions. */}
      <div className="p-3 border-b" style={{ borderColor: "#E2DFD9", background: "#FBFAF7" }}>
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
          <button onClick={() => void post()} disabled={!text.trim() || busy} className="rounded px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40" style={{ background: "#D85A28", color: "#fff" }}>Send</button>
        </div>
      </div>

      {/* Filter bar — by content and/or by a specific task/resource. */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: "#E2DFD9" }}>
        <div className="flex items-center gap-1 rounded px-1.5 flex-1" style={{ border: "1px solid #E2DFD9", background: "#FFFFFF" }}>
          <Icon name="search" size={13} style={{ color: "#94A3B8" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter comments…" className="bg-transparent text-xs py-1 flex-1" style={{ color: "#334155", outline: "none", minWidth: 0 }} />
          {q && <button onClick={() => setQ("")} title="Clear"><Icon name="close" size={12} style={{ color: "#94A3B8" }} /></button>}
        </div>
        <select value={scopeSel} onChange={(e) => setScopeSel(e.target.value)} className="text-xs rounded px-1.5 py-1" style={{ border: "1px solid #E2DFD9", background: "#FFFFFF", color: "#334155", maxWidth: 130 }} title="Filter by task or resource">
          <option value="all">All</option>
          {pulseComments.length > 0 && <option value="pulse">Pulse discussion</option>}
          {taskGroups.length > 0 && (
            <optgroup label="Tasks">
              {taskGroups.map((g) => <option key={g.id} value={`task:${g.id}`}>{g.name}</option>)}
            </optgroup>
          )}
          {resourceGroups.length > 0 && (
            <optgroup label="Resources">
              {resourceGroups.map((g) => <option key={g.id} value={`resource:${g.id}`}>{g.name}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {/* Feed. */}
      <div className="flex flex-col gap-5 p-3">
        {showPulse && (
          <section>
            <div className="mono text-xs font-semibold mb-2" style={{ color: "#334155" }}>Pulse discussion</div>
            <CommentThread comments={pulseComments} currentUid={uid} canModerate={isOwner} composer={false} onAdd={addTo(null, "task", "the Pulse")} onDelete={del} onEdit={edit} onRefClick={onRefClick} />
          </section>
        )}

        {shownTasks.map((g) => (
          <GroupSection key={"t" + g.id} kind="task" name={g.name} count={g.comments.filter((c) => !c.parentId).length} onOpen={() => onSelectTask(g.id)}>
            <CommentThread comments={g.comments} currentUid={uid} canModerate={isOwner} composer={false} onAdd={addTo(g.id, "task", g.name)} onDelete={del} onEdit={edit} onRefClick={onRefClick} />
          </GroupSection>
        ))}

        {shownResources.map((g) => (
          <GroupSection key={"r" + g.id} kind="resource" name={g.name} count={g.comments.filter((c) => !c.parentId).length} onOpen={() => onSelectResource?.(g.id)}>
            <CommentThread comments={g.comments} currentUid={uid} canModerate={isOwner} composer={false} onAdd={addTo(g.id, "resource", g.name)} onDelete={del} onEdit={edit} onRefClick={onRefClick} />
          </GroupSection>
        ))}

        {nothing && (
          <span className="text-xs" style={{ color: "#94A3B8" }}>
            {q || scopeSel !== "all" ? "No comments match this filter." : "No comments yet. Select a task or resource and comment above, or comment on the Pulse."}
          </span>
        )}
      </div>
    </div>
  );
}

function GroupSection({ kind, name, count, onOpen, children }: { kind: "task" | "resource"; name: string; count: number; onOpen: () => void; children: React.ReactNode }) {
  return (
    <section>
      <button
        onClick={onOpen}
        className="flex items-center gap-1 text-xs font-semibold mb-2 hover:underline text-left w-full"
        style={{ color: kind === "task" ? "#1B3A63" : "#0F766E" }}
        title={kind === "task" ? "Open this task" : "Filter by this resource"}
      >
        <Icon name={kind === "task" ? "checklist" : "group"} size={12} />
        <span className="truncate">@{name}</span>
        <span style={{ color: "#94A3B8" }}>· {count}</span>
        <Icon name={kind === "task" ? "open_in_new" : "filter_alt"} size={12} style={{ color: "#94A3B8", marginLeft: "auto" }} />
      </button>
      {children}
    </section>
  );
}
