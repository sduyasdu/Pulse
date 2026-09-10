import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The over-allocation warning moved from a collapsed box inside a tab to the
 * bell, so it has to behave like the dashboard's quota notice: visible without
 * hunting for it, and dismissible two different ways.
 *
 * "Hide for now" and "Don't show again" are deliberately separate answers.
 * Collapsing them into one button forces a permanent decision about a temporary
 * annoyance — you cannot silence today's warning without silencing every future
 * one.
 */

vi.mock("@/services/firestore/notifications", () => ({
  subscribeMyNotifications: () => () => {},
  markNotificationRead: vi.fn(),
  deleteNotification: vi.fn(),
}));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {} }));

const { NotificationsBell } = await import("./NotificationsBell");

const ALERT = { text: "3 people are assigned past their own limit.", dismissKey: "pulse.overLimitNotice.p1" };

function setup(alert: { text: string; dismissKey?: string } | null) {
  render(<NotificationsBell pulseId="p1" uid="u1" onOpenTask={() => {}} alert={alert} />);
  // The bell is the first button; the dropdown is closed until it is clicked.
  return screen.getAllByRole("button")[0];
}

/** jsdom in this project runs without localStorage, so stand one up. */
beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
});

describe("the bell shows there is something wrong", () => {
  it("carries the alert as its label when one is live", () => {
    const bell = setup(ALERT);
    expect(bell.getAttribute("aria-label")).toBe(ALERT.text);
  });

  it("falls back to the plain title when nothing is wrong", () => {
    const bell = setup(null);
    expect(bell.getAttribute("aria-label")).not.toBe(ALERT.text);
  });

  // The warning is derived from the plan and changes with every drag; the
  // unread badge counts messages addressed to you. Folding one into the other
  // would make that number mean two things.
  it("recolours the bell rather than adding to the unread count", () => {
    const withAlert = setup(ALERT).getAttribute("style") ?? "";
    document.body.innerHTML = "";
    const without = setup(null).getAttribute("style") ?? "";
    expect(withAlert).not.toBe(without);
    expect(screen.queryByText("1")).toBeNull();
  });

  it("shows the alert text when the dropdown is opened", () => {
    const bell = setup(ALERT);
    fireEvent.click(bell);
    expect(screen.getByText(ALERT.text)).toBeTruthy();
  });
});

describe("dismissing it", () => {
  it("hides for this session with the close button", () => {
    const bell = setup(ALERT);
    fireEvent.click(bell);
    fireEvent.click(screen.getByLabelText("Hide for now"));
    expect(screen.queryByText(ALERT.text)).toBeNull();
  });

  // "Not now" must not become "never": nothing is written.
  it("does not persist a session dismissal", () => {
    const bell = setup(ALERT);
    fireEvent.click(bell);
    fireEvent.click(screen.getByLabelText("Hide for now"));
    expect(localStorage.getItem(ALERT.dismissKey)).toBeNull();
  });

  it("persists when asked not to show it again", () => {
    const bell = setup(ALERT);
    fireEvent.click(bell);
    fireEvent.click(screen.getByText("Don't show again"));
    expect(localStorage.getItem(ALERT.dismissKey)).toBe("1");
  });

  it("stays hidden on a later mount once persisted", () => {
    localStorage.setItem(ALERT.dismissKey, "1");
    const bell = setup(ALERT);
    expect(bell.getAttribute("aria-label")).not.toBe(ALERT.text);
    fireEvent.click(bell);
    expect(screen.queryByText(ALERT.text)).toBeNull();
  });

  // An alert with no key can only be hidden for the session — there is nowhere
  // to record "never", and inventing one would silence it globally.
  it("offers no permanent dismissal without a key", () => {
    const bell = setup({ text: ALERT.text });
    fireEvent.click(bell);
    expect(screen.queryByText("Don't show again")).toBeNull();
  });
});
