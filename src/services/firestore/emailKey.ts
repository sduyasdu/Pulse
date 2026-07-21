/** Canonical form used as both the invite document ID and the value
 * compared against `request.auth.token.email.lower()` in firestore.rules. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}
