import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { Comment, CommentRef } from "@/types";
import { colorForName } from "@/domain/constants";
import { MentionTextarea } from "./MentionTextarea";
import type { MentionSuggestion } from "./mentions";
import { useT } from "@/i18n";

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

/** Orange circular icon button used for Send / Reply. */
function SendButton({ onClick, disabled, title, size = 32 }: { onClick: () => void; disabled: boolean; title: string; size?: number }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="rounded flex items-center justify-center flex-shrink-0 disabled:opacity-40"
      style={{ width: size, height: size, background: "#D85A28", color: "#fff" }}
    >
      <Icon name="send" size={Math.round(size * 0.5)} />
    </button>
  );
}

interface ThreadProps {
  comments: Comment[]; // flat list for ONE target (top-level + replies)
  currentUid?: string;
  canModerate: boolean; // owner can delete any
  composer?: boolean; // show the new-top-level-comment box (default true)
  suggestions?: MentionSuggestion[]; // tasks/resources for @-autocomplete in reply/edit
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
export function CommentThread({ comments, currentUid, canModerate, composer = true, suggestions = [], onAdd, onDelete, onEdit, onRefClick, targetOf }: ThreadProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const tops = comments.filter((c) => !c.parentId);

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setText("");
    try {
      await onAdd(null, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-2.5 mb-2">
        {tops.length === 0 && <span className="text-xs" style={{ color: "#94A3B8" }}>No comments yet.</span>}
        {tops.map((c) => (
          <Item key={c.id} c={c} replies={comments.filter((r) => r.parentId === c.id)} currentUid={currentUid} canModerate={canModerate} suggestions={suggestions} onAdd={onAdd} onDelete={onDelete} onEdit={onEdit} onRefClick={onRefClick} targetOf={targetOf} />
        ))}
      </div>
      {composer && (
        <div className="flex items-end gap-1.5">
          <MentionTextarea value={text} onChange={setText} suggestions={suggestions} onSubmit={() => void submit()} placeholder={t("comments.addPlaceholder")} />
          <SendButton onClick={() => void submit()} disabled={!text.trim() || busy} title={t("comments.send")} />
        </div>
      )}
    </div>
  );
}

function Item({ c, replies, currentUid, canModerate, suggestions, onAdd, onDelete, onEdit, onRefClick, targetOf }: { c: Comment; replies: Comment[]; currentUid?: string; canModerate: boolean; suggestions: MentionSuggestion[]; onAdd: ThreadProps["onAdd"]; onDelete: ThreadProps["onDelete"]; onEdit: ThreadProps["onEdit"]; onRefClick: ThreadProps["onRefClick"]; targetOf: ThreadProps["targetOf"] }) {
  const t = useT();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setText("");
    try {
      await onAdd(c.id, body);
      setReplying(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Bubble c={c} currentUid={currentUid} canModerate={canModerate} suggestions={suggestions} onDelete={onDelete} onEdit={onEdit} onRefClick={onRefClick} targetOf={targetOf} />
      {replies.length > 0 && (
        <div className="flex flex-col gap-2 mt-2" style={{ marginLeft: 20, borderLeft: "2px solid #F1F5F9", paddingLeft: 8 }}>
          {replies.map((r) => (
            <Bubble key={r.id} c={r} currentUid={currentUid} canModerate={canModerate} suggestions={suggestions} onDelete={onDelete} onEdit={onEdit} onRefClick={onRefClick} targetOf={targetOf} />
          ))}
        </div>
      )}
      <div style={{ marginLeft: 28 }}>
        {replying ? (
          <div className="flex items-end gap-1.5 mt-1.5">
            <MentionTextarea
              value={text}
              onChange={setText}
              suggestions={suggestions}
              rows={1}
              autoFocus
              submitOnEnter
              onSubmit={() => void send()}
              placeholder={t("comments.replyPlaceholder")}
            />
            <SendButton onClick={() => void send()} disabled={!text.trim() || busy} title={t("comments.reply")} size={28} />
            <button onClick={() => setReplying(false)} className="mono text-xs flex-shrink-0" style={{ color: "#94A3B8" }} title={t("common.cancel")}><Icon name="close" size={14} /></button>
          </div>
        ) : (
          <button onClick={() => setReplying(true)} className="mono mt-1" style={{ fontSize: 9, color: "#94A3B8" }}><Icon name="reply" size={11} /> {t("comments.reply")}</button>
        )}
      </div>
    </div>
  );
}

function Bubble({ c, currentUid, canModerate, suggestions, onDelete, onEdit, onRefClick, targetOf }: { c: Comment; currentUid?: string; canModerate: boolean; suggestions: MentionSuggestion[]; onDelete: ThreadProps["onDelete"]; onEdit: ThreadProps["onEdit"]; onRefClick: ThreadProps["onRefClick"]; targetOf: ThreadProps["targetOf"] }) {
  const mine = c.authorUid === currentUid;
  const t = useT();
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
    const body = draft.trim();
    if (!body || busy || !onEdit) return;
    if (body === c.text) { setEditing(false); return; }
    setBusy(true);
    try {
      await onEdit(c, body);
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
          <span className="text-xs font-semibold truncate" style={{ color: "#334155" }}>{mine ? t("comments.you") : c.authorEmail}</span>
          <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>{when(c.createdAt)}{c.editedAt ? ` · ${t("comments.edited")}` : ""}</span>
          {!editing && (mine || canModerate) && (
            <span className="flex items-center gap-1.5 ml-auto">
              {mine && onEdit && (
                <button onClick={() => { setDraft(c.text); setEditing(true); }} className="no-press" style={{ color: "#64748B", display: "flex" }} title={t("comments.edit")}><Icon name="edit" size={15} /></button>
              )}
              <button onClick={(e) => onDelete(c, e)} className="no-press" style={{ color: "#DC2626", display: "flex" }} title={t("common.delete")}><Icon name="delete" size={15} /></button>
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1">
            <div className="flex items-end gap-1.5">
              <MentionTextarea value={draft} onChange={setDraft} suggestions={suggestions} autoFocus onSubmit={() => void save()} placeholder={t("comments.editPlaceholder")} />
              <SendButton onClick={() => void save()} disabled={!draft.trim() || busy} title={t("common.save")} size={28} />
              <button onClick={() => setEditing(false)} className="mono text-xs flex-shrink-0" style={{ color: "#94A3B8" }} title={t("common.cancel")}><Icon name="close" size={14} /></button>
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
                    title={r.kind === "task" ? t("comments.openTask") : t("comments.filterByResource")}
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
