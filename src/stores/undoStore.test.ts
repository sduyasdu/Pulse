import { describe, expect, it } from "vitest";
import { patchOp, createOp, deleteOp } from "./undoStore";

describe("patchOp (field-level diff, D1)", () => {
  it("captures only the patched keys, with before + after", () => {
    const before = { id: "f1", x: 10, y: 20, title: "A", duration: 5 };
    const op = patchOp("feature", "f1", before, { x: 30, title: "B" });
    expect(op).toEqual({
      kind: "feature",
      id: "f1",
      op: "patch",
      keys: ["x", "title"],
      before: { x: 10, title: "A" },
      after: { x: 30, title: "B" },
    });
  });

  it("returns null when the patch changes nothing (no empty history entries)", () => {
    const before = { id: "f1", x: 10, status: "planned" };
    expect(patchOp("feature", "f1", before, { x: 10, status: "planned" })).toBeNull();
  });

  it("returns null for an empty patch", () => {
    expect(patchOp("feature", "f1", { x: 1 }, {})).toBeNull();
  });

  it("maps a key the before-doc lacks to null, so undo clears an added field", () => {
    // Feature had no `lead`; the action set one. Undo must actively clear it,
    // and the store's convention for a cleared optional is null (not undefined,
    // which stripUndefined would drop).
    const before = { id: "f1", resources: [] };
    const op = patchOp("feature", "f1", before, { lead: "r1" });
    expect(op).not.toBeNull();
    expect(op!.op).toBe("patch");
    if (op!.op === "patch") expect(op!.before).toEqual({ lead: null });
  });

  it("compares nested arrays/maps structurally when deciding no-op", () => {
    const before = { id: "f1", resources: ["r1", "r2"], alloc: { r1: 100 } };
    // same content -> no-op
    expect(patchOp("feature", "f1", before, { resources: ["r1", "r2"], alloc: { r1: 100 } })).toBeNull();
    // changed content -> recorded
    expect(patchOp("feature", "f1", before, { resources: ["r1"] })).not.toBeNull();
  });
});

describe("createOp / deleteOp", () => {
  it("snapshot the whole doc and copy it (no aliasing)", () => {
    const doc = { id: "e1", name: "Epic", y0: 0, y1: 90 };
    const cOp = createOp("epic", "e1", doc);
    const dOp = deleteOp("epic", "e1", doc);
    expect(cOp).toMatchObject({ kind: "epic", id: "e1", op: "create", doc });
    expect(dOp).toMatchObject({ kind: "epic", id: "e1", op: "delete", doc });
    // must be a copy, so later mutation of the source doesn't corrupt history
    doc.name = "changed";
    if (cOp.op === "create") expect(cOp.doc.name).toBe("Epic");
    if (dOp.op === "delete") expect(dOp.doc.name).toBe("Epic");
  });
});
