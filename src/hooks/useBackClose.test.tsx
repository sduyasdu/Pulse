import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBackClose } from "./useBackClose";

/**
 * The behaviour under test is history bookkeeping, and every bug it has is a
 * counting bug: one entry too many and a real Back press appears to do nothing;
 * one too few and Back leaves the Pulse. So these assert the *depth* of the
 * history stack as much as the callback.
 */
describe("useBackClose", () => {
  beforeEach(() => {
    // A known baseline: jsdom shares one history across tests in a file.
    window.history.pushState({ base: true }, "");
  });

  it("pushes exactly one entry while active, whatever re-renders happen", async () => {
    const before = window.history.length;
    const { rerender } = renderHook(({ close }) => useBackClose(true, close), {
      // A fresh closure every render is the realistic case — the component defines
      // its handler inline. It must not push again.
      initialProps: { close: () => {} },
    });
    rerender({ close: () => {} });
    rerender({ close: () => {} });
    expect(window.history.length).toBe(before + 1);
  });

  it("closes the overlay instead of leaving the page when Back is pressed", async () => {
    const close = vi.fn();
    renderHook(() => useBackClose(true, close));

    act(() => {
      window.history.back();
    });

    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it("consumes its own entry when the overlay is closed from the UI", async () => {
    const close = vi.fn();
    const { rerender } = renderHook(({ active }) => useBackClose(active, close), {
      initialProps: { active: true },
    });
    const withOverlay = window.history.length;

    // Closed by tapping the on-screen back arrow: the effect tears down without
    // popstate ever firing, so the cleanup owes the stack one pop.
    rerender({ active: false });

    await waitFor(() => expect(window.history.length).toBeLessThanOrEqual(withOverlay));
    // And it must not masquerade as a Back press by invoking the callback.
    expect(close).not.toHaveBeenCalled();
  });

  it("does nothing at all while inactive", () => {
    const close = vi.fn();
    const before = window.history.length;
    renderHook(() => useBackClose(false, close));
    expect(window.history.length).toBe(before);
    expect(close).not.toHaveBeenCalled();
  });
});
