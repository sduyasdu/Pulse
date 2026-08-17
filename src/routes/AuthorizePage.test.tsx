import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthorizePage } from "./AuthorizePage";

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ firebaseUser: { email: "ana@example.com" } }),
}));

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function renderAt(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/oauth/authorize${query}`]}>
      <AuthorizePage />
    </MemoryRouter>,
  );
}

const valid = `?redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}` +
  `&code_challenge=${CHALLENGE}&code_challenge_method=S256&state=xyz&client_name=Claude`;

describe("AuthorizePage (MCP consent)", () => {
  it("names the client and the account being connected", () => {
    renderAt(valid);
    expect(screen.getByText(/Connect Claude to Pulse/)).toBeTruthy();
    expect(screen.getByText(/ana@example.com/)).toBeTruthy();
  });

  // The point of a consent screen: the scope is legible BEFORE the button,
  // including what the assistant will not be able to do.
  it("states what the assistant can and cannot do", () => {
    renderAt(valid);
    expect(screen.getByText(/Read your Pulses/)).toBeTruthy();
    expect(screen.getByText(/cannot create, change or delete/)).toBeTruthy();
    expect(screen.getByText(/cannot see billing/)).toBeTruthy();
  });

  // These are the cases where approving would be unsafe or simply broken. The
  // server refuses them too — this is so a misconfigured client gets an
  // explanation rather than a rejected click.
  it.each([
    ["no redirect target", `?code_challenge=${CHALLENGE}&code_challenge_method=S256`],
    ["no PKCE challenge", `?redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&code_challenge_method=S256`],
    ["a too-short challenge", `?redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&code_challenge=short&code_challenge_method=S256`],
    ["a downgraded challenge method", `?redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&code_challenge=${CHALLENGE}&code_challenge_method=plain`],
  ])("refuses to offer approval with %s", (_label, query) => {
    renderAt(query);
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.getByText(/Something's missing from this request/)).toBeTruthy();
  });
});
