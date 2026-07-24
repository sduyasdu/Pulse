import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { Comment, CommentRef } from "@/types";
import { colorForName } from "@/domain/constants";

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

interface ThreadProps {
  comments: Comment[]; // flat list for ONE target (top-level + replies)
  currentUid?: string;
  canModerate: boolean; // owner can delete any
  composer?: boolean; // show the new-top-level-comment box (default true)
  onAdd: (parentId: string | null, text: string) => Promise<void> | void;
  onDelete: (c: Comment, e: { clientX: number; clientY: number }) => void;
  onEdit?: (c: Comment, text: string) => Promise<void> | void;
  onRefClick?: (ref: CommentRef) => void;
  /** Resolves the task/resource a comment is attached to, rendered as a chip so
   * the flat feed still shows what each comment is about. */
  targetOf?: (c: Comment) => CommentRef | null;
}

/** Renders a threaded comment list (top-level comments with nested replies) plus
 * (optionally) a box to add a new top-level comment. Presentational — data +
 * persistence are passed in. */
export function CommentThread({ comments, currentUid, canModerate, composer = true, onAdd, onDelete, onEdit, onRefClick, targetOf }: ThreadProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const tops = comments.filter((c) => !c.parentId);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText("");
    try {
      await onAdd(null, t);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-2.5 mb-2">
        {tops.length === 0 && <span className="text-xs" style={{ color: "#94A3B8" }}>No comments yet.</span>}
        {tops.map((c) => (
          <Item key={c.id} c={c} replies={comments.filter((r) => r.parentId === c.id)} currentUid={currentUid} canModerate={canModerate} onAdd={onAdd} onDelete={onDelete} onEdit={onEdit} onRefClick={onRefClick} targetOf={targetOf} />
        ))}
      </div>
      {composer && (
        <div className="flex items-end gap-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }}
            placeholder="Add a comment… (⌘↵)"
            rows={2}
            className="text-xs flex-1 rounded px-2 py-1.5"
            style={{ border: "1px solid #E2DFD9", outline: "none", color: "#334155", resize: "vertical" }}
          />
          <button onClick={() => void submit()} disabled={!text.trim() || busy} className="rounded px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40" style={{ background: "#D85A28", color: "#fff" }}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}

function Item({ c, replies, currentUid, canModerate, onAdd, onDelete, onEdit, onRefClick, targetOf }: { c: Comment; replies: Comment[]; currentUid?: string; canModerate: boolean; onAdd: ThreadProps["onAdd"]; onDelete: ThreadProps["onDelete"]; onEdit: ThreadProps["onEdit"]; onRefClick: ThreadProps["onRefClick"]; targetOf: ThreadProps["targetOf"] }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText("");
    try {
      await onAdd(c.id, t);
      setReplying(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Bubble c={c} currentUid={currentUid} canModerate={canModerate} onDelete={onDelete} onEdit={onEdit} onRefClick={onRefClick} targetOf={targetOf} />
      {replies.length > 0 && (
        <div className="flex flex-col gap-2 mt-2" style={{ marginLeft: 20, borderLeft: "2px solid #F1F5F9", paddingLeft: 8 }}>
          {replies.map((r) => (
            <Bubble key={r.id} c={r} currentUid={currentUid} canModerate={canModerate} onDelete={onDelete} onEdit={onEdit} onRefClick={onRefClick} targetOf={targetOf} />
          ))}
        </div>
      )}
      <div style={{ marginLeft: 28 }}>
        {replying ? (
          <div className="flex items-end gap-1.5 mt-1.5">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void send(); if (e.key === "Escape") setReplying(false); }}
              placeholder="Reply…"
              className="text-xs flex-1 rounded px-2 py-1"
              style={{ border: "1px solid #E2DFD9", outline: "none", color: "#334155" }}
            />
            <button onClick={() => void send()} disabled={!text.trim() || busy} className="rounded px-2 py-1 text-xs font-semibold disabled:opacity-40" style={{ background: "#D85A28", color: "#fff" }}>Reply</button>
            <button onClick={() => setReplying(false)} className="mono text-xs" style={{ color: "#94A3B8" }}><Icon name="close" size={13} /></button>
          </div>
        ) : (
          <button onClick={() => setReplying(true)} className="mono mt-1" style={{ fontSize: 9, color: "#94A3B8" }}><Icon name="reply" size={11} /> Reply</button>
        )}
      </div>
    </div>
  );
}

function Bubble({ c, currentUid, canModerate, onDelete, onEdit, onRefClick, targetOf }: { c: Comment; currentUid?: string; canModerate: boolean; onDelete: ThreadProps["onDelete"]; onEdit: ThreadProps["onEdit"]; onRefClick: ThreadProps["onRefClick"]; targetOf: ThreadProps["targetOf"] }) {
  const mine = c.authorUid === currentUid;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.text);
  const [busy, setBusy] = useState(false);

  // The target this comment is attached to, plus its @-mentions, deduped — so
  // the flat feed still shows what each comment is about.
  const refs: CommentRef[] = [];
  const seen = new Set<string>();
  for (const r of [targetOf?.(c) ?? null, ...(c.mentions ?? [])]) {
    if (!r) continue;
    const k = r.kind + ":" + r.id;
    if (seen.has(k)) continue;
    seen.add(k);
    refs.push(r);
  }

  const save = async () => {
    const t = draft.trim();
    if (!t || busy || !onEdit) return;
    if (t === c.text) { setEditing(false); return; }
    setBusy(true);
    try {
      await onEdit(c, t);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-2">
      <span className="mono flex items-center justify-center" style={{ width: 20, height: 20, borderRadius: "50%", background: colorForName(c.authorUid), color: "#fff", fontSize: 8, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{initials(c.authorEmail)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold truncate" style={{ color: "#334155" }}>{mine ? "You" : c.authorEmail}</span>
          <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>{when(c.createdAt)}{c.editedAt ? " · edited" : ""}</span>
          {!editing && (mine || canModerate) && (
            <span className="flex items-center gap-1.5 ml-auto">
              {mine && onEdit && (
                <button onClick={() => { setDraft(c.text); setEditing(true); }} className="no-press" style={{ color: "#64748B", display: "flex" }} title="Edit"><Icon name="edit" size={15} /></button>
              )}
              <button onClick={(e) => onDelete(c, e)} className="no-press" style={{ color: "#DC2626", display: "flex" }} title="Delete"><Icon name="delete" size={15} /></button>
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); if (e.key === "Escape") setEditing(false); }}
              rows={2}
              className="text-xs w-full rounded px-2 py-1.5"
              style={{ border: "1px solid #E2DFD9", outline: "none", color: "#334155", resize: "vertical" }}
            />
            <div className="flex items-center gap-1.5 mt-1">
              <button onClick={() => void save()} disabled={!draft.trim() || busy} className="rounded px-2 py-0.5 text-xs font-semibold disabled:opacity-40" style={{ background: "#D85A28", color: "#fff" }}>Save</button>
              <button onClick={() => setEditing(false)} className="mono text-xs" style={{ color: "#94A3B8" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-xs" style={{ color: "#1F2330", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</div>
            {refs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {refs.map((r) => (
                  <button
                    key={r.kind + r.id}
                    onClick={() => onRefClick?.(r)}
                    className="mono inline-flex items-center gap-0.5 rounded px-1.5 py-0.5"
                    style={{ fontSize: 9, background: r.kind === "task" ? "#FCEEE4" : "#E7F6F1", color: r.kind === "task" ? "#C2410C" : "#0F766E" }}
                    title={r.kind === "task" ? "Open this task" : "Filter by this resource"}
                  >
                    <Icon name={r.kind === "task" ? "checklist" : "group"} size={10} /> {r.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
