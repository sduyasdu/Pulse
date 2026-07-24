import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { Comment } from "@/types";
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
  onAdd: (parentId: string | null, text: string) => Promise<void> | void;
  onDelete: (c: Comment, e: { clientX: number; clientY: number }) => void;
}

/** Renders a threaded comment list (top-level comments with nested replies) plus
 * a box to add a new top-level comment. Presentational — data + persistence are
 * passed in. */
export function CommentThread({ comments, currentUid, canModerate, onAdd, onDelete }: ThreadProps) {
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
          <Item key={c.id} c={c} replies={comments.filter((r) => r.parentId === c.id)} currentUid={currentUid} canModerate={canModerate} onAdd={onAdd} onDelete={onDelete} />
        ))}
      </div>
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
    </div>
  );
}

function Item({ c, replies, currentUid, canModerate, onAdd, onDelete }: { c: Comment; replies: Comment[]; currentUid?: string; canModerate: boolean; onAdd: ThreadProps["onAdd"]; onDelete: ThreadProps["onDelete"] }) {
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
      <Bubble c={c} currentUid={currentUid} canModerate={canModerate} onDelete={onDelete} />
      {replies.length > 0 && (
        <div className="flex flex-col gap-2 mt-2" style={{ marginLeft: 20, borderLeft: "2px solid #F1F5F9", paddingLeft: 8 }}>
          {replies.map((r) => (
            <Bubble key={r.id} c={r} currentUid={currentUid} canModerate={canModerate} onDelete={onDelete} />
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

function Bubble({ c, currentUid, canModerate, onDelete }: { c: Comment; currentUid?: string; canModerate: boolean; onDelete: ThreadProps["onDelete"] }) {
  const mine = c.authorUid === currentUid;
  return (
    <div className="flex items-start gap-2">
      <span className="mono flex items-center justify-center" style={{ width: 20, height: 20, borderRadius: "50%", background: colorForName(c.authorUid), color: "#fff", fontSize: 8, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{initials(c.authorEmail)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold truncate" style={{ color: "#334155" }}>{mine ? "You" : c.authorEmail}</span>
          <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>{when(c.createdAt)}{c.editedAt ? " · edited" : ""}</span>
          {(mine || canModerate) && (
            <button onClick={(e) => onDelete(c, e)} className="mono ml-auto" style={{ fontSize: 9, color: "#CBD5E1" }} title="Delete"><Icon name="close" size={11} /></button>
          )}
        </div>
        <div className="text-xs" style={{ color: "#1F2330", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</div>
      </div>
    </div>
  );
}
