export type AuthenticatorAssuranceLevel = "aal1" | "aal2";

/**
 * Reads the AAL only after Supabase Auth has validated the same token with
 * getUser(). The decoded claim is not an authentication check by itself.
 */
export function assuranceLevelFromValidatedJwt(
  token: string | null,
): AuthenticatorAssuranceLevel | null {
  if (!token) return null;
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const aal = (JSON.parse(atob(base64)) as Record<string, unknown>).aal;
    return aal === "aal1" || aal === "aal2" ? aal : null;
  } catch {
    return null;
  }
}
