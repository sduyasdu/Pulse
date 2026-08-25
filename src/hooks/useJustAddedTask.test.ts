import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { filterSignatureOf, useJustAddedTask } from "./useJustAddedTask";

const sig = (over: Partial<Parameters<typeof filterSignatureOf>[0]> = {}) =>
  filterSignatureOf({ query: "", statuses: new Set(), epics: new Set(), resource: null, mineOnly: false, ...over });

describe("keeping a just-added task visible", () => {
  it("starts with nothing exempt", () => {
    const { result } = renderHook(() => useJustAddedTask(sig()));
    expect(result.current.justAddedId).toBeNull();
  });

  it("exempts the task that was just created", () => {
    const { result } = renderHook(() => useJustAddedTask(sig({ query: "auth" })));
    act(() => result.current.markAdded("f1"));
    expect(result.current.justAddedId).toBe("f1");
  });

  // The trap this hook exists to hold shut: the clearing effect must depend on
  // the filters ALONE. Include `justAddedId` and it clears on the very render
  // that granted it — the feature stops working and nothing else notices.
  it("keeps the exemption across re-renders while the filter is unchanged", () => {
    const { result, rerender } = renderHook(({ s }) => useJustAddedTask(s), {
      initialProps: { s: sig({ query: "auth" }) },
    });
    act(() => result.current.markAdded("f1"));
    rerender({ s: sig({ query: "auth" }) });
    rerender({ s: sig({ query: "auth" }) });
    expect(result.current.justAddedId).toBe("f1");
  });

  it("ends the exemption when the filter changes", () => {
    const { result, rerender } = renderHook(({ s }) => useJustAddedTask(s), {
      initialProps: { s: sig({ query: "auth" }) },
    });
    act(() => result.current.markAdded("f1"));
    rerender({ s: sig({ query: "billing" }) });
    expect(result.current.justAddedId).toBeNull();
  });

  it("ends the exemption when another task is selected", () => {
    const { result } = renderHook(() => useJustAddedTask(sig()));
    act(() => result.current.markAdded("f1"));
    act(() => result.current.noteSelection("f2"));
    expect(result.current.justAddedId).toBeNull();
  });

  it("ends it on deselection too", () => {
    const { result } = renderHook(() => useJustAddedTask(sig()));
    act(() => result.current.markAdded("f1"));
    act(() => result.current.noteSelection(null));
    expect(result.current.justAddedId).toBeNull();
  });

  // Creating selects the new task, so markAdded and noteSelection fire back to
  // back with the same id. If that read as "the selection moved", the exemption
  // would be revoked the instant it was granted.
  it("survives the selection that creating it causes", () => {
    const { result } = renderHook(() => useJustAddedTask(sig({ mineOnly: true })));
    act(() => {
      result.current.markAdded("f1");
      result.current.noteSelection("f1");
    });
    expect(result.current.justAddedId).toBe("f1");
  });

  it("keeps `noteSelection` stable, since the page passes it around", () => {
    const { result, rerender } = renderHook(({ s }) => useJustAddedTask(s), {
      initialProps: { s: sig() },
    });
    const first = result.current.noteSelection;
    act(() => result.current.markAdded("f1"));
    rerender({ s: sig() });
    expect(result.current.noteSelection).toBe(first);
  });
});

describe("filterSignatureOf", () => {
  it("is unchanged when the same statuses arrive in a different order", () => {
    expect(sig({ statuses: new Set(["a", "b"]) })).toBe(sig({ statuses: new Set(["b", "a"]) }));
  });

  it("changes when any one filter changes", () => {
    const base = sig();
    expect(sig({ query: "x" })).not.toBe(base);
    expect(sig({ statuses: new Set(["done"]) })).not.toBe(base);
    expect(sig({ epics: new Set(["e1"]) })).not.toBe(base);
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
});
