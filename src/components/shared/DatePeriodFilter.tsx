import type { DatePeriod } from "@/domain/dateUtils";

const OPTIONS: { id: DatePeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" },
];

/** Segmented control to filter the board by when tasks are active
 * (today / this week / this month / all). */
export function DatePeriodFilter({ value, onChange, title }: { value: DatePeriod; onChange: (p: DatePeriod) => void; title?: string }) {
  return (
    <div className="flex rounded-lg overflow-hidden flex-shrink-0" style={{ border: "1px solid #E2DFD9" }} title={title ?? "Filter by tasks active in a period"}>
      {OPTIONS.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className="text-xs font-semibold px-2.5 py-1"
            style={{ background: on ? "#123359" : "#FFFFFF", color: on ? "#FFFFFF" : "#64748B" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
