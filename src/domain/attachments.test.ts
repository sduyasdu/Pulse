import { describe, expect, it } from "vitest";
import { rejectAttachmentUrl, MAX_ATTACHMENT_URL } from "./attachments";

/**
 * Attachments are links, and the cap is what keeps them that way.
 *
 * Not a storage concern — a URL is a few hundred bytes. The reason is that
 * attachments live inside the feature document, and `subscribeFeatures` streams
 * whole feature documents to every member on every session, into an offline
 * cache on every device. A megabyte pasted once is re-downloaded by everyone,
 * forever, and past Firestore's 1 MiB ceiling the write fails outright.
 */
describe("what may be stored as an attachment", () => {
  it("accepts the links people actually paste", () => {
    for (const url of [
      "https://example.com",
      "https://docs.google.com/document/d/1a2b3c/edit#heading=h.abc123",
      "https://example.com/search?" + "q=term&".repeat(60),
    ]) {
      expect(rejectAttachmentUrl(url), url.slice(0, 40)).toBeNull();
    }
  });

  it("accepts a URL right up to the cap, and refuses one past it", () => {
    const base = "https://example.com/";
    expect(rejectAttachmentUrl(base.padEnd(MAX_ATTACHMENT_URL, "x"))).toBeNull();
    expect(rejectAttachmentUrl(base.padEnd(MAX_ATTACHMENT_URL + 1, "x"))).toBe("too-long");
  });

  it("tells someone pasting a file to link to it instead", () => {
    // "Too long" is a true but useless answer to a pasted image; the useful one
    // names the actual fix.
    const dataUri = "data:image/png;base64," + "A".repeat(MAX_ATTACHMENT_URL);
    expect(rejectAttachmentUrl(dataUri)).toBe("file-not-link");
  });

  it("still allows a data: URI small enough to be harmless", () => {
    // The distinction is size, not scheme: a tiny inline SVG costs nothing, and
    // rejecting by scheme would also break attachments already stored.
    expect(rejectAttachmentUrl("data:image/svg+xml,<svg/>")).toBeNull();
  });

  it("caps below Firestore's document ceiling by a wide margin", () => {
    // A feature document holds subtasks, assignments and history besides its
    // attachments, so the cap has to leave room for the rest of it.
    expect(MAX_ATTACHMENT_URL).toBeLessThan(1_048_576 / 100);
  });
});
