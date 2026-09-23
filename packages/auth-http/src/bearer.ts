/**
 * What the Authorization header says about a bearer token.
 *
 * `missing` covers both an absent header and a header for another scheme such as Basic: either
 * way the request carries no bearer credential, and RFC 6750 answers both with a bare challenge.
 * `malformed` means the caller did try the Bearer scheme and sent something that cannot be a token.
 */
export type BearerToken =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | { readonly kind: "present"; readonly token: string };

// RFC 7235 `credentials = auth-scheme [ 1*SP token68 ]`, with the token68 alphabet from RFC 6750
// section 2.1. A comma cannot appear in a token, so two Authorization headers, which Headers.get
// joins with ", ", fail here rather than silently authenticating as the first one.
const credentials = /^(\S+)(?: +(.*))?$/;
const token68 = /^[A-Za-z0-9\-._~+/]+=*$/;

/**
 * Reads the bearer token from the Authorization header, and from nowhere else.
 *
 * RFC 6750 also allows a form body field and an `access_token` query parameter. Neither is read.
 * A query parameter ends up in access logs, browser history and Referer headers. A form body has
 * to be consumed before the handler sees it, and it turns a cross-site form post into an
 * authenticated request. Cookies belong to `auth-session`, which pairs them with the CSRF
 * defences a cookie needs.
 */
export function readBearerToken(headers: Headers): BearerToken {
  const header = headers.get("authorization");
  if (header === null) return { kind: "missing" };
  const match = credentials.exec(header);
  // The scheme is case-insensitive (RFC 7235 section 2.1).
  if (match?.[1]?.toLowerCase() !== "bearer") return { kind: "missing" };
  const token = match[2];
  if (token === undefined || !token68.test(token)) return { kind: "malformed" };
  return { kind: "present", token };
}
