export const googleIssuer = "https://accounts.google.com";

/**
 * The domain an account belongs to, as far as the provider vouches for it.
 *
 * Google accounts can be registered with any email address, so an email at
 * company.com doesn't prove membership of that Workspace. Google puts the
 * Workspace domain in the `hd` claim, and that is the only thing trusted for
 * Google. Other providers must mark the email as verified.
 */
export const accountDomain = (
  issuer: string,
  claims: Record<string, unknown>,
  emailClaim: string,
): string | undefined => {
  if (issuer === googleIssuer) {
    return typeof claims.hd === "string" ? claims.hd.toLowerCase() : undefined;
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    return undefined;
  }
  const email = claims[emailClaim];
  if (typeof email !== "string") {
    return undefined;
  }
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : undefined;
};

/** An empty allow-list lets everyone the provider accepts through. */
export const isDomainAllowed = (
  allowedDomains: ReadonlyArray<string>,
  domain: string | undefined,
): boolean =>
  allowedDomains.length === 0 ||
  (domain !== undefined && allowedDomains.includes(domain));
