const NAVIGATION_ORIGIN = "https://sevens.local";

function cabinetPath(role: string): string {
  return role === "CITIZEN" ? "/my" : "/staff";
}

/** Validate a return destination before passing it to the client router. */
export function safeNextPath(value: string | null | undefined, role?: string): string | null {
  const fallback = role === undefined ? null : cabinetPath(role);
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;

  try {
    const rawPathname = value.split(/[?#]/, 1)[0] ?? "";
    const pathname = rawPathname === "/" ? "/" : rawPathname.replace(/\/$/, "");
    const allowed = ["/", "/how", "/dashboard", "/my", "/notifications", "/ideas/new", "/staff"].includes(pathname)
      || /^\/(ideas|staff|dashboard)\/[a-zA-Z0-9_-]+$/.test(pathname);
    if (!allowed) return fallback;
    const url = new URL(value, NAVIGATION_ORIGIN);
    if (url.origin !== NAVIGATION_ORIGIN) return fallback;

    const citizenOnly = pathname === "/my" || pathname.startsWith("/ideas/");
    const staffOnly = pathname === "/staff" || pathname.startsWith("/staff/");
    if (role !== undefined && ((role === "CITIZEN" && staffOnly) || (role !== "CITIZEN" && citizenOnly))) return fallback;

    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function authHref(mode: "login" | "register", path?: string | null): string {
  const next = safeNextPath(path);
  return next ? `/${mode}?${new URLSearchParams({ next }).toString()}` : `/${mode}`;
}

export function loginHref(path?: string | null): string {
  return authHref("login", path);
}
