import type { DatePeriod } from "@/domain/dateUtils";
import { useT } from "@/i18n";

const OPTIONS: { id: DatePeriod; key: "period.today" | "period.week" | "period.month" | "period.all" }[] = [
  { id: "today", key: "period.today" },
  { id: "week", key: "period.week" },
  { id: "month", key: "period.month" },
  { id: "all", key: "period.all" },
];

/** Segmented control to filter the board by when tasks are active
 * (today / this week / this month / all). */
export function DatePeriodFilter({ value, onChange, title }: { value: DatePeriod; onChange: (p: DatePeriod) => void; title?: string }) {
  const t = useT();
  return (
    <div className="flex rounded-lg overflow-hidden flex-shrink-0" style={{ border: "1px solid #E2DFD9" }} title={title ?? t("period.title")}>
      {OPTIONS.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className="text-xs font-semibold px-2.5 py-1"
            style={{ background: on ? "#123359" : "#FFFFFF", color: on ? "#FFFFFF" : "#64748B" }}
          >
            {t(o.key)}
          </button>
        );
      })}
    </div>
  );
}
