import { Link } from "react-router-dom";
import type { MyPulseIndexEntry } from "@/types";
import { PulseThumbnail } from "./PulseThumbnail";

const ROLE_LABEL: Record<MyPulseIndexEntry["role"], string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

interface PulseCardProps {
  entry: MyPulseIndexEntry;
  onInviteClick: () => void;
}

export function PulseCard({ entry, onInviteClick }: PulseCardProps) {
  const canInvite = entry.role === "owner" || entry.role === "editor";
  return (
    <div
      className="group relative flex flex-col justify-between rounded-xl border p-4 transition-shadow hover:shadow-md"
      style={{ borderColor: "#E2DFD9", background: "#FFFFFF", minHeight: 108 }}
    >
      <Link to={`/p/${entry.pulseId}`} className="flex-1">
        <PulseThumbnail pulseId={entry.pulseId} />
        <div className="font-display mt-2.5 text-sm font-medium text-yasdu-fg">{entry.name || "Untitled Pulse"}</div>
        <span
          className="mono mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
          style={{ background: "#F7E8DA", color: "#D85A28" }}
        >
          {ROLE_LABEL[entry.role]}
        </span>
      </Link>
      {canInvite && (
        <button
          onClick={onInviteClick}
          className="mono mt-3 self-start text-[11px] text-yasdu-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-yasdu-primary"
        >
          + invite collaborator
        </button>
      )}
    </div>
  );
}
