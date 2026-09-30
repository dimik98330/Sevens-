import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The public app is ready only when the private API, schema and uploads are.
export async function GET() {
  const requestId = randomUUID();
  try {
    const base = process.env.API_INTERNAL_URL || "http://127.0.0.1:18080";
    const response = await fetch(new URL("/api/health/ready", base), {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      return Response.json({ data: { status: "ready" }, meta: { requestId } }, { status: 200 });
    }
  } catch {
    // A missing or unhealthy API is one readiness failure to the caller.
  }
  return Response.json(
    { error: { code: "SERVICE_UNAVAILABLE", message: "API недоступен" }, meta: { requestId } },
    { status: 503 },
  );
}
