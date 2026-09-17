import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { filterSignatureOf, useJustAdded } from "./useJustAdded";

const sig = (over: Partial<Parameters<typeof filterSignatureOf>[0]> = {}) =>
  filterSignatureOf({ query: "", statuses: new Set(), epics: new Set(), cycles: new Set(), resource: null, mineOnly: false, ...over });

const ids = (s: ReadonlySet<string>) => [...s].sort();

describe("keeping just-added tasks visible", () => {
  it("starts with nothing exempt", () => {
    const { result } = renderHook(() => useJustAdded(sig()));
    expect(result.current.justAddedIds.size).toBe(0);
  });

  it("exempts a task that was just created", () => {
    const { result } = renderHook(() => useJustAdded(sig({ query: "auth" })));
    act(() => result.current.markAdded("f1"));
    expect(ids(result.current.justAddedIds)).toEqual(["f1"]);
  });

  // The whole point of the set. As a single id, adding a second task moved the
  // exemption onto it and the first vanished again — so a run of new tasks was
  // cascaded into place and then shown one at a time.
  it("keeps every task added since the filter last changed", () => {
    const { result } = renderHook(() => useJustAdded(sig({ query: "auth" })));
    act(() => result.current.markAdded("f1"));
    act(() => result.current.markAdded("f2"));
    act(() => result.current.markAdded("f3"));
    expect(ids(result.current.justAddedIds)).toEqual(["f1", "f2", "f3"]);
  });

  it("ignores a repeated id rather than growing the set", () => {
    const { result } = renderHook(() => useJustAdded(sig()));
    act(() => result.current.markAdded("f1"));
    const before = result.current.justAddedIds;
    act(() => result.current.markAdded("f1"));
    expect(result.current.justAddedIds).toBe(before);
  });

  // The trap this hook exists to hold shut: the clearing effect must depend on
  // the filters ALONE. Include the set itself and it clears on the very render
  // that granted it — the feature stops working and nothing else notices.
  it("keeps the exemptions across re-renders while the filter is unchanged", () => {
    const { result, rerender } = renderHook(({ s }) => useJustAdded(s), {
      initialProps: { s: sig({ query: "auth" }) },
    });
    act(() => result.current.markAdded("f1"));
    act(() => result.current.markAdded("f2"));
    rerender({ s: sig({ query: "auth" }) });
    rerender({ s: sig({ query: "auth" }) });
    expect(ids(result.current.justAddedIds)).toEqual(["f1", "f2"]);
  });

  it("ends every exemption when the filter changes", () => {
    const { result, rerender } = renderHook(({ s }) => useJustAdded(s), {
      initialProps: { s: sig({ query: "auth" }) },
    });
    act(() => result.current.markAdded("f1"));
    act(() => result.current.markAdded("f2"));
    rerender({ s: sig({ query: "billing" }) });
    expect(result.current.justAddedIds.size).toBe(0);
  });

  it("starts a fresh run after a filter change", () => {
    const { result, rerender } = renderHook(({ s }) => useJustAdded(s), {
      initialProps: { s: sig() },
    });
    act(() => result.current.markAdded("f1"));
    rerender({ s: sig({ mineOnly: true }) });
    act(() => result.current.markAdded("f2"));
    expect(ids(result.current.justAddedIds)).toEqual(["f2"]);
  });

  // Selection used to end the exemption, back when one task was exempt at a
  // time. With a set that would mean adding three and keeping whichever you
  // clicked last, so nothing about selection touches this any more.
  it("survives clicking around between adds", () => {
    const { result } = renderHook(() => useJustAdded(sig({ query: "auth" })));
    act(() => result.current.markAdded("f1"));
    act(() => result.current.markAdded("f2"));
    expect(result.current.justAddedIds.has("f1")).toBe(true);
    expect(result.current.justAddedIds.has("f2")).toBe(true);
  });

  // The set feeds the canvas's match memo, which drives the compacted layout.
  // A new identity on every render would recompute that on every keystroke.
  it("keeps the set referentially stable when nothing changed", () => {
    const { result, rerender } = renderHook(({ s }) => useJustAdded(s), {
      initialProps: { s: sig() },
    });
    act(() => result.current.markAdded("f1"));
    const held = result.current.justAddedIds;
    rerender({ s: sig() });
    rerender({ s: sig() });
    expect(result.current.justAddedIds).toBe(held);
  });

  it("reuses one empty set, so clearing twice doesn't invalidate anything", () => {
    const { result, rerender } = renderHook(({ s }) => useJustAdded(s), {
      initialProps: { s: sig() },
    });
    const empty = result.current.justAddedIds;
    rerender({ s: sig({ query: "a" }) });
    rerender({ s: sig({ query: "b" }) });
    expect(result.current.justAddedIds).toBe(empty);
  });
});

describe("filterSignatureOf", () => {
  it("is unchanged when the same statuses arrive in a different order", () => {
    expect(sig({ statuses: new Set(["a", "b"]) })).toBe(sig({ statuses: new Set(["b", "a"]) }));
    expect(sig({ cycles: new Set(["a", "b"]) })).toBe(sig({ cycles: new Set(["b", "a"]) }));
  });

  it("changes when any one filter changes", () => {
    const base = sig();
    expect(sig({ query: "x" })).not.toBe(base);
    expect(sig({ statuses: new Set(["done"]) })).not.toBe(base);
    expect(sig({ epics: new Set(["e1"]) })).not.toBe(base);
    expect(sig({ cycles: new Set(["rev"]) })).not.toBe(base);
    expect(sig({ resource: "r1" })).not.toBe(base);
    expect(sig({ mineOnly: true })).not.toBe(base);
  });

  it("ignores whitespace-only edits to the query, which change nothing on screen", () => {
    expect(sig({ query: "  auth  " })).toBe(sig({ query: "auth" }));
  });

  // Distinct filters must not collide into one signature, or changing between
  // them would leave a stale exemption standing.
  it("does not confuse a query with a resource id", () => {
    expect(sig({ query: "r1" })).not.toBe(sig({ resource: "r1" }));
  });

  // An epic id and a cycle id are both opaque strings in adjacent slots, so
  // this is the collision the delimiter is actually load-bearing for.
  it("does not confuse an epic with a cycle of the same id", () => {
    expect(sig({ epics: new Set(["x"]) })).not.toBe(sig({ cycles: new Set(["x"]) }));
  });
});
