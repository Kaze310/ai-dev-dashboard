import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ cookie: "", withUserDatabase: vi.fn(), query: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock("@/lib/db/pool", () => ({ withUserDatabase: mocks.withUserDatabase }));
import { getCognitoConfig, sealSession } from "../cognito";
import { GET as budgetGet, PUT as budgetPut } from "@/app/api/budget/route";
import { PUT as providerBudgetPut } from "@/app/api/budget/[providerId]/route";
import { GET as costGet } from "@/app/api/cost-summary/route";
import { POST as saveOpenAI } from "@/app/api/providers/openai/route";
import { POST as saveAnthropic } from "@/app/api/providers/anthropic/route";
import { POST as syncOpenAI } from "@/app/api/sync/openai/route";
import { POST as syncAnthropic } from "@/app/api/sync/anthropic/route";

const origin = "http://localhost:3000";
const sub = "11111111-2222-4333-8444-555555555555";
const other = "22222222-2222-4333-8444-555555555555";
const params = { params: Promise.resolve({ providerId: other }) };
const writes = [
  ["budget", (r: Request) => budgetPut(r), "PUT"],
  ["provider budget", (r: Request) => providerBudgetPut(r, params), "PUT"],
  ["OpenAI key", saveOpenAI, "POST"], ["Anthropic key", saveAnthropic, "POST"],
  ["OpenAI sync", syncOpenAI, "POST"], ["Anthropic sync", syncAnthropic, "POST"],
] as const;

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("COGNITO_ISSUER", "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_Test");
  vi.stubEnv("COGNITO_DOMAIN", "https://test.auth.us-east-2.amazoncognito.com");
  vi.stubEnv("COGNITO_CLIENT_ID", "test-client");
  vi.stubEnv("COGNITO_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("COGNITO_SESSION_SECRET", Buffer.alloc(32, 7).toString("base64"));
  mocks.cookie = "";
  mocks.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  mocks.withUserDatabase.mockReset().mockImplementation(async (_user, work) => work({ query: mocks.query }));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network allowed in this test"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function signIn(exp = Math.floor(Date.now() / 1000) + 600) {
  mocks.cookie = await sealSession(getCognitoConfig(), { sub, emailVerified: true, expiresAt: exp });
}
function request(method: string, body: unknown = {}, source = origin) {
  return new Request(`${origin}/api/test`, { method, headers: { origin: source, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("Cognito gates on all business APIs", () => {
  it.each(writes)("rejects unauthenticated %s before DB or provider access", async (_name, handler, method) => {
    expect((await handler(request(method))).status).toBe(401);
    expect(mocks.withUserDatabase).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(writes)("rejects cross-site %s before DB or provider access", async (_name, handler, method) => {
    await signIn();
    expect((await handler(request(method, {}, "https://attacker.example"))).status).toBe(403);
    expect(mocks.withUserDatabase).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects private read APIs without a session", async () => {
    expect((await budgetGet()).status).toBe(401);
    expect((await costGet(new NextRequest(`${origin}/api/cost-summary`))).status).toBe(401);
    expect(mocks.withUserDatabase).not.toHaveBeenCalled();
  });
  it("rejects expired or tampered sessions", async () => {
    await signIn(Math.floor(Date.now() / 1000) - 1);
    expect((await budgetGet()).status).toBe(401);
    mocks.cookie = "forged-cookie";
    expect((await budgetGet()).status).toBe(401);
    expect(mocks.withUserDatabase).not.toHaveBeenCalled();
  });
  it("takes identity only from the verified cookie, ignoring submitted user_id", async () => {
    await signIn();
    const response = await budgetPut(request("PUT", { user_id: other, monthly_limit_cents: null }));
    expect(response.status).toBe(200);
    expect(mocks.withUserDatabase.mock.calls[0][0]).toBe(sub);
    expect(mocks.query).toHaveBeenCalledWith("DELETE FROM public.budgets WHERE user_id = $1", [sub]);
  });
  it("does not clear a budget for an empty request", async () => {
    await signIn();
    expect((await budgetPut(request("PUT"))).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("never falls back to an administrator if DB access fails", async () => {
    await signIn();
    mocks.withUserDatabase.mockRejectedValue(new Error("password and private SQL detail"));
    const response = await budgetGet();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private SQL detail");
    expect(mocks.withUserDatabase).toHaveBeenCalledOnce();
  });
});
