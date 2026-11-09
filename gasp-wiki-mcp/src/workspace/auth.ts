/**
 * GASP Workspace sign-in: the bearer token check and the protected-resource
 * metadata. The hosted server is an OAuth 2.1 resource server in the MCP
 * authorization flow; WorkOS AuthKit is the authorization server the MCP
 * client registers with and signs in through, so this module only verifies
 * the access tokens AuthKit issues against its published keys. A token names
 * the user (`sub`) and the organisation (`org_id`); the organisation is the
 * company whose workspace the call reads and writes.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export interface AuthConfig {
  /** The authorization server, the WorkOS AuthKit domain such as https://<tenant>.authkit.app; a token's `iss` must equal it. */
  issuer: string;
  /** The key set; default `<issuer>/oauth2/jwks`. */
  jwksUrl?: string;
  /** The `aud` a token must carry, when set. */
  audience?: string;
  /** A key getter in place of the remote key set (tests use a local one). */
  keys?: JWTVerifyGetKey;
}

/** A token the server refuses, with the reason the client is told. */
export class AuthError extends Error {}

/** The default key set URL for an AuthKit issuer. */
export const defaultJwksUrl = (issuer: string): string => `${issuer.replace(/\/+$/, "")}/oauth2/jwks`;

// One remote key set per URL for the process: jose caches the keys and refetches on an unknown kid.
const remoteKeys = new Map<string, JWTVerifyGetKey>();
function keysFor(config: AuthConfig): JWTVerifyGetKey {
  if (config.keys) return config.keys;
  const url = config.jwksUrl ?? defaultJwksUrl(config.issuer);
  let keys = remoteKeys.get(url);
  if (!keys) { keys = createRemoteJWKSet(new URL(url)); remoteKeys.set(url, keys); }
  return keys;
}

/** Why jose refused a token, in words a user can act on. */
function reason(err: unknown, config: AuthConfig): string {
  const e = err as { code?: string; claim?: string; message?: string };
  if (e.code === "ERR_JWT_EXPIRED") return "The token has expired: sign in again.";
  if (e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && e.claim === "iss") return `The token was not issued by ${config.issuer}.`;
  if (e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && e.claim === "aud") return `The token is not for this server: its audience is not ${config.audience}.`;
  if (e.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" || e.code === "ERR_JWKS_NO_MATCHING_KEY") return "The token's signature does not verify against the issuer's keys.";
  if (e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED") return `The token's ${e.claim ?? "claims"} claim is not valid.`;
  return "The token is not a valid access token.";
}

/** The access token verified (signature, issuer, expiry, audience when configured) and read into the SDK's AuthInfo, or an AuthError. */
export async function verifyBearer(token: string, config: AuthConfig): Promise<AuthInfo> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keysFor(config), { issuer: config.issuer, ...(config.audience ? { audience: config.audience } : {}) }));
  } catch (err) {
    // A token jose read and refused is the caller's problem; the key set unreachable or unreadable is the server's, and surfaces as an error.
    const code = (err as { code?: string }).code ?? "";
    if (!/^ERR_JW/.test(code) || code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_INVALID") throw err;
    throw new AuthError(reason(err, config));
  }
  if (payload.exp === undefined) throw new AuthError("The token has no expiry.");
  const orgId = typeof payload.org_id === "string" && payload.org_id ? payload.org_id : undefined;
  if (!orgId) throw new AuthError("The token names no organisation: sign in to GASP Workspace as a member of your company's organisation.");
  if (!payload.sub) throw new AuthError("The token names no user.");
  const clientId = typeof payload.client_id === "string" ? payload.client_id : typeof payload.azp === "string" ? payload.azp : "unknown";
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
  const email = typeof payload.email === "string" ? payload.email : undefined;
  return { token, clientId, scopes, expiresAt: payload.exp, extra: { sub: payload.sub, org_id: orgId, ...(email ? { email } : {}) } };
}

/** The OAuth 2.0 protected-resource metadata (RFC 9728) the MCP client reads to find the authorization server. */
export function protectedResourceMetadata(config: { issuer: string; resource: string }): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [],
    resource_documentation: "https://koinedata.com/workspace",
  };
}

/** Where the metadata is served: the resource's origin plus the well-known path, the URL the `WWW-Authenticate` challenge names. */
export const metadataUrl = (resource: string): string => `${new URL(resource).origin}/.well-known/oauth-protected-resource`;

/** The company and user a verified call carries, or undefined for an anonymous call. */
export function callerOf(auth: AuthInfo | undefined): { orgId: string; userId: string; email?: string } | undefined {
  const x = auth?.extra;
  if (!x || typeof x.org_id !== "string" || typeof x.sub !== "string") return undefined;
  return { orgId: x.org_id, userId: x.sub, ...(typeof x.email === "string" ? { email: x.email } : {}) };
}
