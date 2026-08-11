import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { subscribeBilling } from "@/services/firestore/billing";
import type { BillingDoc } from "@/types";

/**
 * Live `billing/{orgId}` for the signed-in user's organization. The org IS the
 * workspace (PL6), so the id is the user's `personalWorkspaceId`.
 *
 * Resolves to `null` for anyone who isn't the org owner — `firestore.rules`
 * allows the read only for a workspace `owner`, and `subscribeBilling` maps a
 * permission-denied to `null`. That is deliberate, not a failure: entitlements
 * treat an absent doc as Pro, and only the owner can act on billing anyway.
 */
export function useBilling(): { workspaceId: string | null; billing: BillingDoc | null } {
  const workspaceId = useAuthStore((s) => s.userDoc?.personalWorkspaceId ?? null);
  const [billing, setBilling] = useState<BillingDoc | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setBilling(null);
      return;
    }
    return subscribeBilling(workspaceId, setBilling);
  }, [workspaceId]);

  return { workspaceId, billing };
}
