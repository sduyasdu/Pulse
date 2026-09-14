import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeletionPreview } from "@/services/firestore/account";

/**
 * The confirmation screen for an irreversible action.
 *
 * What is being pinned is not that it renders, but that it refuses: the delete
 * button has to stay unreachable while the server says ownership must move
 * first, while a subscription is live, and until the typed address matches. A
 * dialog that offers the button anyway and relies on the server to say no has
 * already failed the person reading it.
 */
const preview = vi.fn();
const del = vi.fn();
vi.mock("@/services/firestore/account", () => ({
  previewAccountDeletion: () => preview(),
  deleteAccount: () => del(),
}));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, functions: {}, googleProvider: {} }));

const reauth = vi.fn();
const needsPassword = vi.fn(() => false);
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ reauthenticate: (p?: string) => reauth(p), needsPasswordToReauth: needsPassword }),
}));

const { DeleteAccountDialog } = await import("./DeleteAccountDialog");

const EMAIL = "me@example.com";
const CLEAN: DeletionPreview = { deletes: [], leaves: [], blockers: [], subscription: null, canDelete: true };

function open(p: Partial<DeletionPreview> = {}) {
  preview.mockResolvedValue({ ...CLEAN, ...p });
  render(<DeleteAccountDialog email={EMAIL} onClose={() => {}} />);
}

/** The delete button is the last one in the footer. */
const deleteButton = () => screen.getByRole("button", { name: /Delete my account/i });

beforeEach(() => {
  vi.clearAllMocks();
  needsPassword.mockReturnValue(false);
});

describe("before it will delete anything", () => {
  it("waits for the typed address to match", async () => {
    open();
    await waitFor(() => expect(deleteButton()).toBeDisabled());

    fireEvent.change(screen.getByPlaceholderText(EMAIL), { target: { value: "me@example.co" } });
    expect(deleteButton()).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(EMAIL), { target: { value: EMAIL } });
    expect(deleteButton()).not.toBeDisabled();
  });

  it("accepts the address in any case, since an email is case-insensitive", async () => {
    open();
    await waitFor(() => expect(deleteButton()).toBeDisabled());
    fireEvent.change(screen.getByPlaceholderText(EMAIL), { target: { value: "  ME@Example.com " } });
    expect(deleteButton()).not.toBeDisabled();
  });

  it("refuses while a sole-owned Beat still has other members", async () => {
    open({ blockers: [{ beatId: "b1", name: "Q3 Roadmap", otherMembers: 3 }], canDelete: false });
    await screen.findByText(/Q3 Roadmap/);
    // No confirmation field is even offered — there is nothing to confirm yet.
    expect(screen.queryByPlaceholderText(EMAIL)).toBeNull();
    expect(deleteButton()).toBeDisabled();
  });

  it("refuses while a subscription is live", async () => {
    open({ subscription: { orgId: "ws1", status: "active" }, canDelete: false });
    await waitFor(() => expect(deleteButton()).toBeDisabled());
    expect(screen.queryByPlaceholderText(EMAIL)).toBeNull();
  });
});

describe("what it tells you will happen", () => {
  it("counts the Beats that die and the ones that survive separately", async () => {
    open({
      deletes: [{ beatId: "b1", name: "Solo" }, { beatId: "b2", name: "Scratch" }],
      leaves: [{ beatId: "b3", name: "Team" }],
    });
    expect(await screen.findByText(/2 Beats you alone own will be deleted/)).toBeTruthy();
    expect(screen.getByText(/removed from 1 Beats/)).toBeTruthy();
  });

  it("says so when nothing is affected", async () => {
    open();
    expect(await screen.findByText(/No Beats are affected/)).toBeTruthy();
  });
});

describe("when the server refuses", () => {
  /** Gets as far as the server refusing for a stale session. */
  async function reachReauth() {
    open();
    del.mockResolvedValue({ ok: false, reason: "reauth-required" });
    await waitFor(() => expect(deleteButton()).toBeDisabled());
    fireEvent.change(screen.getByPlaceholderText(EMAIL), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());
    return screen.findByRole("button", { name: /Sign in again and delete/i });
  }

  it("offers a way through the gate instead of sending the user away", async () => {
    // Signing out and back in would close this dialog and lose everything the
    // person just read and confirmed, so the proof happens here.
    expect(await reachReauth()).toBeTruthy();
  });

  it("retries the deletion itself once identity is proved", async () => {
    const button = await reachReauth();
    reauth.mockResolvedValue(true);
    del.mockResolvedValue({ ok: false, reason: "failed" }); // stop before the redirect
    fireEvent.click(button);
    await waitFor(() => expect(reauth).toHaveBeenCalledTimes(1));
    // Twice: the original attempt, then the retry the user never had to ask for.
    await waitFor(() => expect(del).toHaveBeenCalledTimes(2));
  });

  it("does not retry when the proof fails", async () => {
    const button = await reachReauth();
    reauth.mockResolvedValue(false);
    fireEvent.click(button);
    expect(await screen.findByText(/didn't work/i)).toBeTruthy();
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("asks password accounts for a password, and waits for one", async () => {
    needsPassword.mockReturnValue(true);
    const button = await reachReauth();
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: "hunter2" } });
    expect(button).not.toBeDisabled();
    reauth.mockResolvedValue(true);
    del.mockResolvedValue({ ok: false, reason: "failed" });
    fireEvent.click(button);
    await waitFor(() => expect(reauth).toHaveBeenCalledWith("hunter2"));
  });

  it("names the Beats it discovered late, which the preview had not", async () => {
    // The preview said clean; someone added a member in between. The refusal
    // carries the list, and it must replace the stale preview rather than be
    // swallowed into a generic error.
    open();
    del.mockResolvedValue({
      ok: false,
      reason: "sole-owner-beats",
      blockers: [{ beatId: "b9", name: "Shared Late", otherMembers: 2 }],
    });
    await waitFor(() => expect(deleteButton()).toBeDisabled());
    fireEvent.change(screen.getByPlaceholderText(EMAIL), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());
    expect(await screen.findByText(/Shared Late/)).toBeTruthy();
    expect(deleteButton()).toBeDisabled();
  });
});
