import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The indicator has no other guard.
 *
 * `Icon` returns `null` for a name it does not have — no error, no warning, no
 * failing build, just an element with nothing in it. For an indicator that is
 * *supposed* to be quiet when connected, a silently-missing glyph is
 * indistinguishable from working correctly, in both states.
 *
 * So these assert a path element actually renders, and that the two states are
 * told apart by something a user can perceive.
 */

let status = "online";
vi.mock("@/hooks/useNetworkStatus", () => ({ useNetworkStatus: () => status }));

const { ConnectionStatus } = await import("./ConnectionStatus");

const svg = () => document.querySelector("svg");
const pathData = () => Array.from(document.querySelectorAll("svg path"), (p) => p.getAttribute("d")).join("|");

beforeEach(() => {
  status = "online";
});

describe("the connection indicator", () => {
  it.each(["online", "offline", "unreachable"])("draws a real glyph when %s", (s) => {
    status = s;
    render(<ConnectionStatus uid="u1" />);
    // Not `toBeTruthy()` on the svg alone: Icon renders an empty <svg> for a
    // name it lacks, so the assertion has to reach the path data.
    expect(svg()).toBeTruthy();
    expect(pathData()).toMatch(/^[Mm]/);
  });

  it("uses a different glyph connected than disconnected", () => {
    render(<ConnectionStatus uid="u1" />);
    const connected = pathData();
    status = "offline";
    document.body.innerHTML = "";
    render(<ConnectionStatus uid="u1" />);
    expect(pathData()).not.toBe(connected);
  });

  // The icon is the whole message, so the text alternative is the whole
  // message for anyone not looking at it.
  it("says it is connected", () => {
    render(<ConnectionStatus uid="u1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Connected to Beats.");
  });

  // Offline and unreachable are different facts and must not be flattened into
  // one string — "you're offline" is wrong and unactionable on a captive portal.
  it("distinguishes being offline from not reaching the server", () => {
    status = "offline";
    render(<ConnectionStatus uid="u1" />);
    expect(screen.getByRole("status")).toHaveTextContent("You're offline.");
    document.body.innerHTML = "";
    status = "unreachable";
    render(<ConnectionStatus uid="u1" />);
    expect(screen.getByRole("status")).toHaveTextContent("can't reach the server");
  });

  // Both disconnected states carry it: it is the answer to "have I lost work?",
  // which is the only question anyone actually has here.
  it.each(["offline", "unreachable"])("promises queued edits when %s", (s) => {
    status = s;
    render(<ConnectionStatus uid="u1" />);
    expect(screen.getByRole("status")).toHaveTextContent(/saved on this device/);
  });

  it("carries the same wording in the tooltip as in the text", () => {
    status = "offline";
    render(<ConnectionStatus uid="u1" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("title")).toBe(el.textContent);
  });
});
