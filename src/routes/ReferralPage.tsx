import { Navigate, useParams } from "react-router-dom";
import { keepReferral } from "@/domain/referral";

/**
 * `/r/{code}` — a referral link (Trials-and-Referrals-Spec TR9). Keeps the code in
 * this browser for 60 days and goes on to the app: the sign-in screen says who
 * invited them, and the code is claimed once the account's workspace exists.
 * Someone already signed in simply lands on their dashboard; the claim refuses
 * them on the server (a workspace older than a day), so nothing here has to.
 */
export function ReferralPage() {
  const { code } = useParams();
  if (code) keepReferral(code);
  return <Navigate to="/" replace />;
}
