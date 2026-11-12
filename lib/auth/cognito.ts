import "server-only";

import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt, type JWTPayload } from "jose";
import * as oidc from "openid-client";

export const COGNITO_PATH = "/auth/cognito";
export const FLOW_COOKIE = "dashboard_cognito_flow";
export const SESSION_COOKIE = "dashboard_session";
export const FLOW_TTL = 10 * 60;

export type CognitoConfig = {
  issuer: string;
  domain: string;
  clientId: string;
  clientSecret: string;
  origin: string;
  sessionKey: Uint8Array;
};

export type LoginFlow = { state: string; nonce: string; verifier: string };
export type CognitoSession = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  expiresAt: number;
};

// Read lazily so builds do not need live authentication credentials.
export function getCognitoConfig(env: Record<string, string | undefined> = process.env): CognitoConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const issuer = required("COGNITO_ISSUER");
  if (!/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9-]+_[A-Za-z0-9]+$/.test(issuer)) {
    throw new Error("COGNITO_ISSUER must identify an AWS Cognito user pool");
  }
  const domain = new URL(required("COGNITO_DOMAIN"));
  const origin = new URL(required("APP_ORIGIN"));
  for (const url of [domain, origin]) {
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Configure origins without paths, credentials or query strings");
    }
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (domain.protocol !== "https:" || (origin.protocol !== "https:" && !(local && origin.protocol === "http:"))) {
    throw new Error("HTTPS is required except for the local development app");
  }
  const secret = required("COGNITO_SESSION_SECRET");
  const sessionKey = Buffer.from(secret, "base64");
  if (sessionKey.length !== 32 || sessionKey.toString("base64") !== secret) {
    throw new Error("COGNITO_SESSION_SECRET must be 32 random bytes encoded as base64");
  }
  return {
    issuer,
    domain: domain.origin,
    origin: origin.origin,
    clientId: required("COGNITO_CLIENT_ID"),
    clientSecret: required("COGNITO_CLIENT_SECRET"),
    sessionKey,
  };
}

export function callbackUrl(config: CognitoConfig) {
  return `${config.origin}${COGNITO_PATH}/callback`;
}

export function createCognitoClient(config: CognitoConfig) {
  // Fixed endpoints keep the token exchange tied to the configured pool and domain.
  const client = new oidc.Configuration({
    issuer: config.issuer,
    authorization_endpoint: `${config.domain}/oauth2/authorize`,
    token_endpoint: `${config.domain}/oauth2/token`,
    jwks_uri: `${config.issuer}/.well-known/jwks.json`,
  }, config.clientId, { id_token_signed_response_alg: "RS256" }, oidc.ClientSecretBasic(config.clientSecret));
  client.timeout = 10;
  // The library otherwise permits TLS to authenticate token responses. Also check
  // the JWT signature so our application explicitly verifies Cognito's signing key.
  oidc.enableNonRepudiationChecks(client);
  return client;
}

export async function startLogin(config: CognitoConfig) {
  const flow: LoginFlow = {
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    verifier: oidc.randomPKCECodeVerifier(),
  };
  const url = oidc.buildAuthorizationUrl(createCognitoClient(config), {
    redirect_uri: callbackUrl(config),
    scope: "openid email",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
    code_challenge_method: "S256",
  });
  return { url, flow };
}

export async function finishLogin(
  config: CognitoConfig,
  url: URL,
  flow: LoginFlow,
  client = createCognitoClient(config),
): Promise<CognitoSession> {
  if (`${url.origin}${url.pathname}` !== callbackUrl(config)) throw new Error("Unexpected callback URL");
  // state links the callback to this browser; PKCE binds the code to this login;
  // nonce binds the ID token. The library also checks issuer, audience and expiry.
  const tokens = await oidc.authorizationCodeGrant(client, url, {
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    pkceCodeVerifier: flow.verifier,
  });
  const claims = tokens.claims();
  if (!claims || claims.token_use !== "id" || !isUserId(claims.sub)) {
    throw new Error("Expected a Cognito user ID token");
  }
  // Store identity only: the browser never needs the provider's raw tokens.
  // Require login again when the ID token expires; no refresh tokens are stored.
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    emailVerified: claims.email_verified === true,
    expiresAt: claims.exp,
  };
}

function isUserId(value: unknown): value is string {
  // The target PostgreSQL schema uses Cognito sub directly as a UUID.
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function cookieAudience(config: CognitoConfig) {
  // Changing pool/client invalidates existing cookies instead of retaining old identities.
  return createHash("sha256").update(`${config.issuer}|${config.clientId}|${config.origin}`).digest("hex");
}

async function seal(config: CognitoConfig, kind: "flow" | "session", payload: JWTPayload, expiresAt: number) {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(`dashboard:cognito:${kind}`)
    .setAudience(cookieAudience(config))
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .encrypt(config.sessionKey);
}

async function unseal(config: CognitoConfig, kind: "flow" | "session", cookie?: string) {
  if (!cookie) return null;
  try {
    const { payload } = await jwtDecrypt(cookie, config.sessionKey, {
      issuer: `dashboard:cognito:${kind}`,
      audience: cookieAudience(config),
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      requiredClaims: ["exp", "iat"],
    });
    return payload;
  } catch {
    // Expired or altered browser cookies mean "not signed in", not a server error.
    return null;
  }
}

export function sealFlow(config: CognitoConfig, flow: LoginFlow) {
  return seal(config, "flow", flow, Math.floor(Date.now() / 1000) + FLOW_TTL);
}

export async function readFlow(config: CognitoConfig, cookie?: string): Promise<LoginFlow | null> {
  const payload = await unseal(config, "flow", cookie);
  if (!payload || typeof payload.state !== "string" || typeof payload.nonce !== "string" || typeof payload.verifier !== "string") return null;
  return { state: payload.state, nonce: payload.nonce, verifier: payload.verifier };
}

export function sealSession(config: CognitoConfig, session: CognitoSession) {
  return seal(config, "session", { sub: session.sub, email: session.email, emailVerified: session.emailVerified }, session.expiresAt);
}

export async function readSession(config: CognitoConfig, cookie?: string): Promise<CognitoSession | null> {
  const payload = await unseal(config, "session", cookie);
  if (!payload || !isUserId(payload.sub) || typeof payload.exp !== "number") return null;
  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    emailVerified: payload.emailVerified === true,
    expiresAt: payload.exp,
  };
}

export function cookieOptions(config: CognitoConfig, maxAge: number) {
  return {
    httpOnly: true,
    secure: config.origin.startsWith("https:"),
    sameSite: "lax" as const, // Allow the top-level GET callback from Cognito.
    path: COGNITO_PATH, // Only the short-lived login flow needs this scope.
    maxAge,
  };
}

export function sessionCookieOptions(config: CognitoConfig, maxAge: number) {
  return { ...cookieOptions(config, maxAge), path: "/" };
}

export function logoutUrl(config: CognitoConfig) {
  // Cognito uses logout_uri, rather than the OIDC post_logout_redirect_uri parameter.
  const url = new URL("/logout", config.domain);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("logout_uri", `${config.origin}${COGNITO_PATH}`);
  return url;
}

export function isSameOriginPost(request: Request, config: CognitoConfig) {
  // POST forms send Origin. Reject cross-site forms before changing login state.
  return request.method === "POST" && request.headers.get("origin") === config.origin;
}
