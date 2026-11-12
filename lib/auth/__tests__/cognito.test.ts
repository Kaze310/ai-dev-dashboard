import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import * as oidc from "openid-client";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

import {
  callbackUrl, COGNITO_PATH, cookieOptions, createCognitoClient, finishLogin,
  FLOW_COOKIE, getCognitoConfig, isSameOriginPost, logoutUrl, readFlow, readSession,
  sealFlow, sealSession, SESSION_COOKIE, startLogin, sessionCookieOptions,
} from "@/lib/auth/cognito";
import { GET as callback } from "@/app/auth/cognito/callback/route";
import { POST as login } from "@/app/auth/cognito/login/route";
import { POST as logout } from "@/app/auth/cognito/logout/route";

const env = {
  APP_ORIGIN: "http://localhost:3000",
  COGNITO_ISSUER: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TestPool",
  COGNITO_DOMAIN: "https://test.auth.us-east-2.amazoncognito.com",
  COGNITO_CLIENT_ID: "test-client",
  COGNITO_CLIENT_SECRET: "test-client-secret",
  COGNITO_SESSION_SECRET: Buffer.alloc(32, 7).toString("base64"),
};
const config = getCognitoConfig(env);
const sub = "11111111-2222-4333-8444-555555555555";
const flow = { state: "expected-state", nonce: "expected-nonce", verifier: "a".repeat(43) };
const now = () => Math.floor(Date.now() / 1000);
const responseUrl = () => new URL(`${callbackUrl(config)}?code=test-code&state=${flow.state}`);
let signingKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongKeys: Awaited<ReturnType<typeof generateKeyPair>>;

beforeAll(async () => {
  signingKeys = await generateKeyPair("RS256");
  wrongKeys = await generateKeyPair("RS256");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubConfig() {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

// Real OAuth parsing and signature verification against a fake provider. No AWS requests.
async function provider(overrides: Record<string, unknown> = {}, invalidSignature = false) {
  const idToken = await new SignJWT({
    iss: config.issuer, aud: config.clientId, sub, iat: now(), exp: now() + 3600,
    nonce: flow.nonce, token_use: "id", email: "test@example.com", email_verified: true,
    ...overrides,
  }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(invalidSignature ? wrongKeys.privateKey : signingKeys.privateKey);
  const jwk = await exportJWK(signingKeys.publicKey);
  const fetcher = vi.fn<oidc.CustomFetch>(async (input) => {
    const url = String(input);
    if (url === `${config.domain}/oauth2/token`) {
      return Response.json({ access_token: "test-access", token_type: "Bearer", expires_in: 3600, id_token: idToken, refresh_token: "test-refresh" });
    }
    if (url === `${config.issuer}/.well-known/jwks.json`) return Response.json({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] });
    throw new Error(`Unexpected test URL: ${url}`);
  });
  const client = createCognitoClient(config);
  client[oidc.customFetch] = fetcher;
  return { client, fetcher };
}

describe("Cognito authorization code flow", () => {
  it("requests an authorization code with S256 PKCE, state and nonce", async () => {
    const first = await startLogin(config);
    const second = await startLogin(config);
    expect(first.url.origin).toBe(config.domain);
    expect(first.url.searchParams.get("response_type")).toBe("code");
    expect(first.url.searchParams.get("scope")).toBe("openid email");
    expect(first.url.searchParams.get("redirect_uri")).toBe(callbackUrl(config));
    expect(first.url.searchParams.get("state")).toBe(first.flow.state);
    expect(first.url.searchParams.get("nonce")).toBe(first.flow.nonce);
    expect(first.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.url.searchParams.get("code_challenge")).toBe(await oidc.calculatePKCECodeChallenge(first.flow.verifier));
    expect(first.flow).not.toEqual(second.flow);
    expect(first.url.toString()).not.toContain(config.clientSecret);
  });

  it("verifies a signed token and sends the original PKCE verifier to the token endpoint", async () => {
    const { client, fetcher } = await provider();
    const session = await finishLogin(config, responseUrl(), flow, client);
    expect(session).toMatchObject({ sub, email: "test@example.com", emailVerified: true });
    expect(Object.keys(session).sort()).toEqual(["email", "emailVerified", "expiresAt", "sub"]);
    const tokenRequest = fetcher.mock.calls.find(([url]) => String(url).endsWith("/oauth2/token"))!;
    const body = new URLSearchParams(String(tokenRequest[1]?.body));
    expect(body.get("code_verifier")).toBe(flow.verifier);
    expect(body.get("redirect_uri")).toBe(callbackUrl(config));
    expect(new Headers(tokenRequest[1]?.headers).get("authorization")).toMatch(/^Basic /);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/jwks.json"))).toBe(true);
  });

  it.each(["wrong", ""])("rejects state '%s' before exchanging any code", async (state) => {
    const { client, fetcher } = await provider();
    const url = responseUrl();
    url.searchParams.set("state", state);
    await expect(finishLogin(config, url, flow, client)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["another pool", { iss: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_OtherPool" }],
    ["another client", { aud: "other-client" }],
    ["expired token", { exp: Math.floor(Date.now() / 1000) - 120 }],
    ["wrong nonce", { nonce: "other-nonce" }],
    ["wrong token use", { token_use: "access" }],
    ["invalid user ID", { sub: "not-a-uuid" }],
  ])("rejects %s", async (_name, claims) => {
    const { client } = await provider(claims);
    await expect(finishLogin(config, responseUrl(), flow, client)).rejects.toThrow();
  });

  it("rejects a token signed by an unknown private key", async () => {
    const { client } = await provider({}, true);
    await expect(finishLogin(config, responseUrl(), flow, client)).rejects.toThrow();
  });

  it("rejects an unexpected callback origin without exchanging the code", async () => {
    const { client, fetcher } = await provider();
    const url = responseUrl();
    url.host = "attacker.example";
    await expect(finishLogin(config, url, flow, client)).rejects.toThrow("Unexpected callback");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("encrypted cookies", () => {
  it("round-trips identity and expires at the ID token expiry", async () => {
    const session = { sub, email: "test@example.com", emailVerified: true, expiresAt: now() + 60 };
    const cookie = await sealSession(config, session);
    expect(cookie).not.toContain(session.email);
    expect(await readSession(config, cookie)).toEqual(session);
    vi.useFakeTimers();
    vi.setSystemTime(new Date((session.expiresAt + 1) * 1000));
    expect(await readSession(config, cookie)).toBeNull();
  });

  it("rejects tampering and a different encryption key", async () => {
    const cookie = await sealSession(config, { sub, emailVerified: false, expiresAt: now() + 60 });
    const parts = cookie.split(".");
    parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    expect(await readSession(config, parts.join("."))).toBeNull();
    expect(await readSession({ ...config, sessionKey: Buffer.alloc(32, 9) }, cookie)).toBeNull();
  });

  it("does not reuse a session for another pool or client", async () => {
    const cookie = await sealSession(config, { sub, emailVerified: false, expiresAt: now() + 60 });
    expect(await readSession({ ...config, issuer: `${config.issuer}Other` }, cookie)).toBeNull();
    expect(await readSession({ ...config, clientId: "other" }, cookie)).toBeNull();
  });

  it("expires login flows after ten minutes and keeps flow and session cookies distinct", async () => {
    const cookie = await sealFlow(config, flow);
    expect(await readFlow(config, cookie)).toEqual(flow);
    expect(await readSession(config, cookie)).toBeNull();
    expect(await readFlow(config)).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 601_000));
    expect(await readFlow(config, cookie)).toBeNull();
  });

  it("uses HttpOnly and SameSite=Lax; enables Secure for HTTPS", () => {
    expect(cookieOptions(config, 60)).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: COGNITO_PATH, maxAge: 60 });
    expect(sessionCookieOptions(config, 60).path).toBe("/");
    expect(cookieOptions({ ...config, origin: "https://dashboard.example" }, 60).secure).toBe(true);
  });
});

describe("HTTP handlers", () => {
  it("sets a short-lived flow cookie and redirects a same-origin login POST", async () => {
    stubConfig();
    const response = await login(new NextRequest(`${config.origin}${COGNITO_PATH}/login`, { method: "POST", headers: { origin: config.origin } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(config.domain);
    expect(await readFlow(config, response.cookies.get(FLOW_COOKIE)?.value)).not.toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("completes the real OAuth validation, clears the flow cookie and sets a session", async () => {
    stubConfig();
    const { fetcher } = await provider();
    vi.stubGlobal("fetch", fetcher);
    const response = await callback(new NextRequest(responseUrl(), { headers: { cookie: `${FLOW_COOKIE}=${await sealFlow(config, flow)}` } }));
    expect(response.headers.get("location")).toBe(`${config.origin}/`);
    expect(response.cookies.get(FLOW_COOKIE)?.maxAge).toBe(0);
    expect(await readSession(config, response.cookies.get(SESSION_COOKIE)?.value)).toMatchObject({ sub, email: "test@example.com" });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects a callback without a flow cookie, without making a network request", async () => {
    stubConfig();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await callback(new NextRequest(responseUrl()));
    expect(response.headers.get("location")).toBe(`${config.origin}/login?error=login_failed`);
    expect(response.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose provider errors or issue a session when login is denied", async () => {
    stubConfig();
    const url = new URL(`${callbackUrl(config)}?error=access_denied&error_description=private-detail&state=${flow.state}`);
    const response = await callback(new NextRequest(url, { headers: { cookie: `${FLOW_COOKIE}=${await sealFlow(config, flow)}` } }));
    expect(response.headers.get("location")).toBe(`${config.origin}/login?error=login_failed`);
    expect(response.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("clears local cookies and redirects to Cognito logout", async () => {
    stubConfig();
    const response = await logout(new NextRequest(`${config.origin}${COGNITO_PATH}/logout`, { method: "POST", headers: { origin: config.origin } }));
    expect(response.headers.get("location")).toBe(logoutUrl(config).href);
    expect(response.cookies.get(SESSION_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(FLOW_COOKIE)?.maxAge).toBe(0);
    expect(logoutUrl(config).searchParams.get("logout_uri")).toBe(`${config.origin}${COGNITO_PATH}`);
  });

  it.each([login, logout])("rejects cross-site POSTs before setting cookies", async (handler) => {
    stubConfig();
    const response = await handler(new NextRequest(`${config.origin}${COGNITO_PATH}/login`, { method: "POST", headers: { origin: "https://attacker.example" } }));
    expect(response.status).toBe(403);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("requires a same-origin POST for state-changing requests", () => {
    expect(isSameOriginPost(new Request(config.origin, { method: "POST" }), config)).toBe(false);
    expect(isSameOriginPost(new Request(config.origin, { headers: { origin: config.origin } }), config)).toBe(false);
  });
});

describe("configuration", () => {
  it("fails clearly for missing settings and accepts local HTTP development", () => {
    expect(() => getCognitoConfig({})).toThrow("Missing COGNITO_ISSUER");
    expect(getCognitoConfig(env).origin).toBe("http://localhost:3000");
  });

  it.each([
    { APP_ORIGIN: "http://public.example" },
    { APP_ORIGIN: "https://public.example/callback" },
    { COGNITO_DOMAIN: "http://test.auth.us-east-2.amazoncognito.com" },
    { COGNITO_SESSION_SECRET: "short-secret" },
  ])("rejects invalid configuration %j", (overrides) => {
    expect(() => getCognitoConfig({ ...env, ...overrides })).toThrow();
  });
});
