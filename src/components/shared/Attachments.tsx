import { useRef, useState } from "react";
import type { Attachment } from "@/types";

interface AttachmentsProps {
  items: Attachment[] | undefined;
  onAdd: (title: string, url: string) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
  compact?: boolean;
}

export function Attachments({ items, onAdd, onDelete, canEdit, compact }: AttachmentsProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const submit = () => {
    if (url.trim()) {
      onAdd(title, url);
      setTitle("");
      setUrl("");
    }
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => onAdd(f.name, reader.result as string);
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  };

  return (
    <div>
      {!compact && (
        <span className="mono text-xs" style={{ color: "#64748B" }}>
          ATTACHMENTS {(items || []).length > 0 && `(${items!.length})`}
        </span>
      )}
      <div className={`flex flex-col gap-1 ${compact ? "" : "mt-1.5"}`}>
        {(items || []).map((a) => (
          <div key={a.id} className="flex items-center gap-1.5 rounded px-2 py-1" style={{ background: "#F8FAFC", border: "1px solid #EEF1F4" }}>
            <span style={{ fontSize: 12, color: "#D85A28" }}>{a.isData ? "📄" : "🔗"}</span>
            <a href={a.url} target="_blank" rel="noopener noreferrer" download={a.isData ? a.title : undefined} className="text-xs flex-1 truncate" style={{ color: "#123359", textDecoration: "none" }} title={a.title}>
              {a.title}
            </a>
            {canEdit && (
              <button onClick={() => onDelete(a.id)} title="Remove attachment">
                <span style={{ fontSize: 11, color: "#64748B" }}>✕</span>
              </button>
            )}
          </div>
        ))}
        {(items || []).length === 0 && !compact && <span className="mono text-xs" style={{ color: "#78859A" }}>No attachments — upload a file or paste a link.</span>}
      </div>
      {canEdit && (
        <div className="flex gap-1 mt-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="text-xs border rounded px-1.5 py-1" style={{ borderColor: "#E2DFD9", width: compact ? 56 : 80, minWidth: 0 }} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Paste URL…" className="text-xs border rounded px-1.5 py-1 flex-1" style={{ borderColor: "#E2DFD9", minWidth: 0 }} />
          <button onClick={submit} title="Add link" className="mono text-xs px-2 rounded" style={{ background: "#F7E8DA", color: "#D85A28" }}>+</button>
          <button onClick={() => fileRef.current?.click()} title="Upload file" className="mono text-xs px-2 rounded" style={{ background: "#EFF6FF", color: "#2563EB" }}>⤴</button>
          <input ref={fileRef} type="file" multiple onChange={onFiles} style={{ display: "none" }} />
        </div>
      )}
    </div>
  );
}
