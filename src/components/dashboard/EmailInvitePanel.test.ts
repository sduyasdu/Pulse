import { describe, it, expect } from "vitest";
import { candidatesFrom } from "./EmailInvitePanel";
import type { PulseMember, Resource } from "@/types";

const res = (p: Partial<Resource>): Resource =>
  ({ id: p.name ?? "r", name: "R", initials: "R", capacity: 1, ...p }) as Resource;

const member = (uid: string, email: string): PulseMember =>
  ({ uid, email, role: "editor", joinedAt: 0 }) as PulseMember;

describe("who gets suggested as an invitee", () => {
  it("offers a linked person who isn't a collaborator", () => {
    const out = candidatesFrom([res({ name: "Ana", linkedEmail: "ana@x.com" })], [], new Set());
    expect(out.map((c) => c.email)).toEqual(["ana@x.com"]);
  });

  it("skips resources with no linked address — there's nobody to invite", () => {
    const out = candidatesFrom([res({ name: "Design team" }), res({ name: "TBD", linkedEmail: null })], [], new Set());
    expect(out).toEqual([]);
  });

  // `linkedUid` is set only when the address resolved against THIS Pulse's
  // membership, so its presence is the app's own record that they're already in.
  it("skips a linked person who is already a collaborator", () => {
    const out = candidatesFrom([res({ name: "Ana", linkedEmail: "ana@x.com", linkedUid: "u_ana" })], [], new Set());
    expect(out).toEqual([]);
  });

  // The belt-and-braces case: membership docs predating the email field, and
  // resources the resolver never ran over, both leave linkedUid empty on someone
  // who is in fact a member. Suggesting them would produce an invite that can
  // never be accepted, because they're already here.
  it("skips a member whose resource was never resolved", () => {
    const out = candidatesFrom(
      [res({ name: "Ana", linkedEmail: "Ana@X.com" })],
      [member("u_ana", "ana@x.com")],
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it("skips anyone already invited", () => {
    const out = candidatesFrom([res({ name: "Ana", linkedEmail: "ana@x.com" })], [], new Set(["ana@x.com"]));
    expect(out).toEqual([]);
  });

  it("folds case, because stored addresses are not consistently normalised", () => {
    const out = candidatesFrom([res({ name: "Ana", linkedEmail: "  ANA@X.com " })], [], new Set());
    expect(out[0].email).toBe("ana@x.com");
  });

  it("collapses two resources sharing an address into one row", () => {
    const out = candidatesFrom(
      [res({ name: "Ana (design)", linkedEmail: "ana@x.com" }), res({ name: "Ana (QA)", linkedEmail: "ana@x.com" })],
      [], new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Ana (design)");
  });

  it("sorts by name so the list doesn't reshuffle between opens", () => {
    const out = candidatesFrom(
      [res({ name: "Zoe", linkedEmail: "z@x.com" }), res({ name: "Ana", linkedEmail: "a@x.com" })],
      [], new Set(),
    );
    expect(out.map((c) => c.name)).toEqual(["Ana", "Zoe"]);
  });

  it("falls back to the address when the resource has no name", () => {
    const out = candidatesFrom([res({ name: "", linkedEmail: "ana@x.com" })], [], new Set());
    expect(out[0].name).toBe("ana@x.com");
  });
});
