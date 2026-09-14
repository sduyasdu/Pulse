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

const { DeleteAccountDialog } = await import("./DeleteAccountDialog");

const EMAIL = "me@example.com";
const CLEAN: DeletionPreview = { deletes: [], leaves: [], blockers: [], subscription: null, canDelete: true };

function open(p: Partial<DeletionPreview> = {}) {
  preview.mockResolvedValue({ ...CLEAN, ...p });
  render(<DeleteAccountDialog email={EMAIL} onClose={() => {}} />);
}

/** The delete button is the last one in the footer. */
const deleteButton = () => screen.getByRole("button", { name: /Delete my account/i });

beforeEach(() => vi.clearAllMocks());

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
  it("asks for a fresh sign-in rather than reporting a failure", async () => {
    open();
    del.mockResolvedValue({ ok: false, reason: "reauth-required" });
    await waitFor(() => expect(deleteButton()).toBeDisabled());
    fireEvent.change(screen.getByPlaceholderText(EMAIL), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());
    expect(await screen.findByText(/sign in again/i)).toBeTruthy();
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
