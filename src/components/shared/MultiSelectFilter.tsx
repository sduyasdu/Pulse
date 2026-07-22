import { useState } from "react";

export interface Option {
  id: string;
  name: string;
}

/** Compact multi-select dropdown used for every canvas/panel filter. Empty
 * selection = no filter ("all"). `openUp` flips the menu above the button for
 * bottom-of-screen callers (the assignment panel); the toolbar opens downward. */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  searchable,
  openUp,
}: {
  label: string;
  options: Option[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
  openUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = searchable && query ? options.filter((o) => o.name.toLowerCase().includes(query)) : options;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const summary =
    selected.size === 0
      ? `all ${label}`
      : selected.size === 1
        ? options.find((o) => selected.has(o.id))?.name ?? `1 ${label}`
        : `${selected.size} ${label}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="mono text-xs border rounded px-1.5 py-1 flex items-center gap-1 no-press"
        style={{ borderColor: selected.size ? "#EE7240" : "#E2DFD9", background: selected.size ? "#FFF7F1" : "#FFFFFF", color: "#334155", maxWidth: 150 }}
      >
        <span className="truncate">{summary}</span>
        <span style={{ fontSize: 8, color: "#94A3B8" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => { setOpen(false); setQ(""); }} />
          <div
            className="absolute rounded border"
            style={{ [openUp ? "bottom" : "top"]: "calc(100% + 4px)", left: 0, zIndex: 50, width: 200, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}
          >
            {searchable && (
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="text-xs w-full px-2 py-1.5 border-b" style={{ borderColor: "#F1F5F9", outline: "none" }} />
            )}
            {selected.size > 0 && (
              <button onClick={() => onChange(new Set())} className="mono text-xs w-full text-left px-2 py-1 border-b" style={{ color: "#9F1D23", borderColor: "#F1F5F9" }}>
                ✕ clear ({selected.size})
              </button>
            )}
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {filtered.length === 0 && <div className="mono text-xs px-2 py-1.5" style={{ color: "#94A3B8" }}>No matches</div>}
              {filtered.map((o) => (
                <button key={o.id} onClick={() => toggle(o.id)} className="text-xs w-full text-left px-2 py-1 flex items-center gap-2" style={{ background: selected.has(o.id) ? "#FFF7F1" : undefined }}>
                  <input type="checkbox" readOnly checked={selected.has(o.id)} style={{ accentColor: "#EE7240", pointerEvents: "none", flexShrink: 0 }} />
                  <span className="truncate" style={{ color: "#334155" }}>{o.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
