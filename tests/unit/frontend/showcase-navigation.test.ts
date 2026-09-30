import { describe, expect, it } from "vitest";
import { authHref, safeNextPath } from "@/features/shared/navigation";

describe("sign-in returns to the public idea", () => {
  it("preserves dashboard filters through the auth link", () => {
    const target = "/dashboard?category=TRANSPORT&q=%D0%A1%D0%B2%D0%B5%D1%82&sort=newest";
    const auth = new URL(authHref("login", target), "https://sevens.local");
    expect(auth.pathname).toBe("/login");
    expect(safeNextPath(auth.searchParams.get("next"), "CITIZEN")).toBe(target);
  });
  it("allows both citizens and staff to return to a public detail", () => {
    const target = "/dashboard/9f5bd361-e48b-48b7-a795-ab7f846d705d";
    expect(safeNextPath(target, "CITIZEN")).toBe(target);
    expect(safeNextPath(target, "STAFF")).toBe(target);
    expect(new URL(authHref("register", target), "https://sevens.local").searchParams.get("next")).toBe(target);
  });
  it("rejects external and encoded destination paths", () => {
    for (const value of ["//evil.example/dashboard", "https://evil.example/dashboard", "/dashboard%2f%2fevil.example", "/dashboard/../settings", "/dashboard\\evil.example"]) {
      expect(safeNextPath(value)).toBeNull();
    }
  });
  it("keeps private cabinet role boundaries", () => {
    expect(safeNextPath("/staff/123", "CITIZEN")).toBe("/my");
    expect(safeNextPath("/ideas/123", "STAFF")).toBe("/staff");
  });
});
