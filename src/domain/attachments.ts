/**
 * What may be stored as an attachment.
 *
 * Attachments are links. `Attachments.tsx` offers two text fields and says so
 * ("No attachments — paste a link"), and nothing in the app turns a file into a
 * `data:` URI. But `addAttachment` accepts whatever string it is given, and a
 * `data:` URI pasted into the URL field would be stored verbatim.
 *
 * That is worth stopping for a reason that is not storage. Attachments live
 * inside the feature document, and `subscribeFeatures` streams whole feature
 * documents to every member of the Beat, on every session, into an offline
 * cache on every device. A megabyte pasted once is re-downloaded by everyone,
 * forever — and past Firestore's 1 MiB document ceiling the write simply fails.
 *
 * The cap is generous for any real URL (the longest in common use are a few
 * hundred characters; 2048 is the conventional practical ceiling) and far too
 * small for a file, so it needs no separate rule for `data:` URIs — it only
 * needs to explain itself differently when it sees one.
 */
export const MAX_ATTACHMENT_URL = 2048;

export type AttachmentRejection = "too-long" | "file-not-link";

/** `null` when the URL may be stored. */
export function rejectAttachmentUrl(url: string): AttachmentRejection | null {
  if (url.length <= MAX_ATTACHMENT_URL) return null;
  // Both are too long; saying "too long" about a pasted file is unhelpful when
  // the real answer is "put it somewhere and link to it".
  return /^data:/i.test(url) ? "file-not-link" : "too-long";
}
