import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ readFileSync: vi.fn(() => "test CA bundle") }));
import { databaseConfig } from "../pool";

const env = {
  NODE_ENV: "test" as const,
  DATABASE_HOST: "example.rds.amazonaws.com", DATABASE_NAME: "dashboard", DATABASE_PORT: "5432",
  DATABASE_USER: "dashboard_app", DATABASE_PASSWORD: "private-password",
  SHOWCASE_DATABASE_USER: "dashboard_public", SHOWCASE_DATABASE_PASSWORD: "public-password",
  DATABASE_CA_CERT_PATH: "/test/ca.pem",
};

describe("database configuration", () => {
  it("uses independent limited credentials with verified TLS", () => {
    const app = databaseConfig("app", env);
    const showcase = databaseConfig("showcase", env);
    expect(app.user).toBe("dashboard_app");
    expect(showcase.user).toBe("dashboard_public");
    expect(app.password).toBe("private-password");
    expect(showcase.password).toBe("public-password");
    expect(app.ssl).toEqual({ ca: "test CA bundle", rejectUnauthorized: true });
    expect(showcase.ssl).toEqual(app.ssl);
  });
  it("refuses administrator or owner credentials", () => {
    expect(() => databaseConfig("app", { ...env, DATABASE_USER: "postgres" })).toThrow();
    expect(() => databaseConfig("showcase", { ...env, SHOWCASE_DATABASE_USER: "dashboard_app" })).toThrow();
  });
  it("preserves day keys and exact numeric strings", () => {
    const config = databaseConfig("app", env);
    expect(config.types!.getTypeParser(1082, "text")("2026-06-01")).toBe("2026-06-01");
    expect(config.types!.getTypeParser(1700, "text")("188937.0353769999995348158")).toBe("188937.0353769999995348158");
    expect(config.types!.getTypeParser(20, "text")("9223372036854775807")).toBe("9223372036854775807");
  });
});
