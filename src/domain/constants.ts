import type { FeatureStatus } from "@/types";

// Canvas layout constants — ported 1:1 from the prototype.
export const BASE_DAY_WIDTH = 26; // px per day at 100% in DAY view
export const RULER_HEIGHT = 46;
export const CONTENT_MIN_HEIGHT = 1300;
export const RES_LABEL_W = 320; // width of the resource-label column in the assignment panel

export type Density = "day" | "week" | "month";
export const DENSITY_DAY_PX: Record<Density, number> = { day: 1, week: 0.42, month: 0.14 };
export const DENSITY_HINT: Record<Density, string> = {
  day: "days shown; months banded above",
  week: "ISO weeks shown; months banded above",
  month: "months shown; years banded above",
};

export interface StatusMeta {
  border: string;
  bg: string;
  text: string;
  label: string;
}

export const STATUS_META: Record<FeatureStatus, StatusMeta> = {
  planned: { border: "#64748B", bg: "#EEF2F7", text: "#475569", label: "Planned" },
  "in-progress": { border: "#F5A524", bg: "#FFF6E2", text: "#92400E", label: "In progress" },
  blocked: { border: "#E5484D", bg: "#FDEBEC", text: "#9F1D23", label: "Blocked" },
  done: { border: "#12A594", bg: "#E6F7F4", text: "#0F6B5C", label: "Done" },
};

export const AVATAR_COLORS = ["#6366F1", "#EC4899", "#14B8A6", "#F59E0B", "#8B5CF6", "#0EA5E9"];

export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export interface LabelColorOption {
  id: string;
  color: string | null;
  name: string;
}

export const LABEL_COLORS: LabelColorOption[] = [
  { id: "none", color: null, name: "None" },
  { id: "violet", color: "#8B5CF6", name: "Violet" },
  { id: "blue", color: "#3B82F6", name: "Blue" },
  { id: "teal", color: "#14B8A6", name: "Teal" },
  { id: "green", color: "#22C55E", name: "Green" },
  { id: "amber", color: "#F59E0B", name: "Amber" },
  { id: "rose", color: "#F43F5E", name: "Rose" },
  { id: "slate", color: "#64748B", name: "Slate" },
];

export const EPIC_PALETTE = ["#8B5CF6", "#3B82F6", "#14B8A6", "#22C55E", "#F59E0B", "#F43F5E", "#0EA5E9"];

/** hex (#rrggbb) + alpha -> rgba() string */
export function hexA(hex: string | null | undefined, a: number): string {
  if (!hex) return `rgba(100,116,139,${a})`;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
