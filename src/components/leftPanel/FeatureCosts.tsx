// Per-task cost entry — Costs-Spec §5 + Build-Plan Phase 3. Lives in the task
// editor, which is also what mobile renders, so recording spend works on both
// without a separate mobile surface.
import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import { usePulseStore } from "@/stores/pulseStore";
import { confirmAt } from "@/stores/confirmStore";
import { AI_COST_TYPE, costTypeById, modelsUsed } from "@/domain/costTypes";
import { amountOf, dollarsToMicros, fmtMoney, fmtQuantity, microsToDollars, unitCostOf } from "@/domain/costs";
import type { CostEntry } from "@/types";
import { useT } from "@/i18n";

/** Cost-type defs carry i18n *keys* as plain strings (they're data, and typing
 * them against the dictionary would couple domain to i18n). Narrow at the one
 * place they're translated. */
type TKey = Parameters<ReturnType<typeof useT>>[0];

export function FeatureCosts({ featureId, canEdit }: { featureId: string; canEdit: boolean }) {
  const t = useT();
  const allCosts = usePulseStore((s) => s.costs);
  const resources = usePulseStore((s) => s.resources);
  const addCost = usePulseStore((s) => s.addCost);
  const patchCost = usePulseStore((s) => s.patchCost);
  const removeCost = usePulseStore((s) => s.removeCost);
  const [editing, setEditing] = useState<string | null>(null);

  const costs = useMemo(() => allCosts.filter((c) => c.featureId === featureId), [allCosts, featureId]);
  const models = useMemo(() => modelsUsed(allCosts), [allCosts]);
  const total = costs.reduce((sum, c) => sum + amountOf(c, costTypeById(c.typeId)), 0);

  const handleAdd = async () => {
    const id = await addCost(featureId, {
      typeId: AI_COST_TYPE.id,
      basis: "amount",
      quantities: { tokens: 0 },
      attrs: { brand: "anthropic", model: models[0] ?? "", resourceId: null },
    });
    if (id) setEditing(id);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="mono" style={{ fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("cost.section")}</div>
        {costs.length > 0 && (
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "#1F2330" }}>{fmtMoney(total)}</span>
        )}
        {canEdit && (
          <button
            onClick={() => void handleAdd()}
            className="mono flex items-center gap-1 rounded px-1.5 py-0.5 ml-auto"
            style={{ fontSize: 10, background: "#F4F2EC", color: "#64748B" }}
            title={t("cost.addTitle")}
          >
            <Icon name="add" size={12} /> {t("cost.add")}
          </button>
        )}
      </div>

      {costs.length === 0 ? (
        <div className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>{t("cost.none")}</div>
      ) : (
        <div className="flex flex-col gap-1">
          {costs.map((c) =>
            editing === c.id && canEdit ? (
              <CostForm
                key={c.id}
                cost={c}
                models={models}
                resources={resources.map((r) => ({ id: r.id, name: r.name }))}
                onDone={() => setEditing(null)}
                onChange={(patch) => void patchCost(c.id, patch)}
              />
            ) : (
              <CostRow
                key={c.id}
                cost={c}
                canEdit={canEdit}
                onEdit={() => setEditing(c.id)}
                onDelete={async (e) => {
                  if (await confirmAt(e, { message: t("cost.deleteConfirm"), confirmLabel: t("common.delete") })) {
                    void removeCost(c.id);
                  }
                }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function CostRow({ cost, canEdit, onEdit, onDelete }: {
  cost: CostEntry;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const t = useT();
  const type = costTypeById(cost.typeId);
  const unit = unitCostOf(cost, type, "tokens");
  const qty = cost.quantities?.tokens ?? 0;
  const rid = cost.attrs?.resourceId || null;

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5" style={{ background: "#F8F7F4", border: "1px solid #EEF1F4" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: type?.color ?? "#94A3B8", flexShrink: 0 }} />
      <div className="min-w-0 flex-1">
        <div className="text-xs truncate" style={{ color: "#1F2330" }}>{cost.attrs?.model || t("cost.noModel")}</div>
        <div className="mono" style={{ fontSize: 9, color: "#64748B" }}>
          {fmtQuantity(qty)} {t("cost.unit.tokens")}
          {unit != null ? ` · $${unit.toFixed(2)}/M` : " · —"}
          {cost.attrs?.brand ? ` · ${cost.attrs.brand}` : ""}
        </div>
      </div>
      {rid && <ResourceBadge resourceId={rid} size={16} />}
      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "#1F2330" }}>{fmtMoney(cost.amountMicros)}</span>
      {canEdit && (
        <>
          <button onClick={onEdit} className="no-press" style={{ color: "#64748B", display: "flex" }} title={t("cost.edit")} aria-label={t("cost.edit")}>
            <Icon name="edit" size={13} />
          </button>
          <button onClick={onDelete} className="no-press" style={{ color: "#9F1D23", display: "flex" }} title={t("cost.delete")} aria-label={t("cost.delete")}>
            <Icon name="delete" size={13} />
          </button>
        </>
      )}
    </div>
  );
}

/** The entry form. Renders from the type's attribute defs, so a second cost
 * type needs no new form code (Costs-Spec §2). */
function CostForm({ cost, models, resources, onChange, onDone }: {
  cost: CostEntry;
  models: string[];
  resources: { id: string; name: string }[];
  onChange: (patch: Partial<CostEntry>) => void;
  onDone: () => void;
}) {
  const t = useT();
  const type = costTypeById(cost.typeId) ?? AI_COST_TYPE;
  const [qty, setQty] = useState(String(cost.quantities?.tokens ?? 0));
  const [amount, setAmount] = useState(String(microsToDollars(cost.amountMicros || 0)));
  const [attrs, setAttrs] = useState<Record<string, string | null>>({ ...cost.attrs });

  const qtyNum = Number(qty) || 0;
  const amountNum = Number(amount) || 0;
  // Unit cost is always derived from actuals — there is no price table (CO4).
  const unit = qtyNum > 0 ? amountNum / (qtyNum / 1_000_000) : null;

  const commit = () => {
    onChange({
      quantities: { tokens: qtyNum },
      amountMicros: dollarsToMicros(amountNum),
      attrs,
    });
    onDone();
  };

  const fieldStyle: React.CSSProperties = {
    border: "1px solid #E2DFD9",
    borderRadius: 4,
    padding: "3px 6px",
    fontSize: 11,
    color: "#1F2330",
    background: "#FFFFFF",
    outline: "none",
    width: "100%",
  };

  return (
    <div className="rounded p-2 flex flex-col gap-1.5" style={{ background: "#FFFFFF", border: `1px solid ${type.color}` }}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {type.attributes.map((attr) => (
          <label key={attr.id} className="flex flex-col gap-0.5" style={{ gridColumn: attr.kind === "resourceRef" ? "span 2" : undefined }}>
            <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t(attr.label as TKey)}</span>
            {attr.kind === "enum" ? (
              <select value={attrs[attr.id] ?? ""} onChange={(e) => setAttrs({ ...attrs, [attr.id]: e.target.value })} className="mono" style={fieldStyle}>
                {(attr.options ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : attr.kind === "resourceRef" ? (
              <select value={attrs[attr.id] ?? ""} onChange={(e) => setAttrs({ ...attrs, [attr.id]: e.target.value || null })} className="mono" style={fieldStyle}>
                <option value="">{t("cost.unattributed")}</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            ) : (
              <>
                <input
                  list={`cost-models-${cost.id}`}
                  value={attrs[attr.id] ?? ""}
                  onChange={(e) => setAttrs({ ...attrs, [attr.id]: e.target.value })}
                  placeholder={t("cost.modelPlaceholder")}
                  className="mono"
                  style={fieldStyle}
                />
                <datalist id={`cost-models-${cost.id}`}>
                  {models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </>
            )}
          </label>
        ))}

        <label className="flex flex-col gap-0.5">
          <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t("cost.measure.tokens")}</span>
          <input type="number" min={0} step={1000} value={qty} onChange={(e) => setQty(e.target.value)} className="mono" style={fieldStyle} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t("cost.amount")}</span>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mono" style={fieldStyle} />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>
          {t("cost.unitCost")}: <strong style={{ color: unit == null ? "#94A3B8" : "#1F2330" }}>{unit == null ? "—" : `$${unit.toFixed(2)}/M`}</strong>
        </span>
        <button onClick={onDone} className="mono rounded px-2 py-1 ml-auto" style={{ fontSize: 10, background: "#F1F5F9", color: "#64748B" }}>
          {t("common.cancel")}
        </button>
        <button onClick={commit} className="mono rounded px-2 py-1" style={{ fontSize: 10, background: "#123359", color: "#FFFFFF", fontWeight: 600 }}>
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
