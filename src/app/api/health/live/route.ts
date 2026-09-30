import { randomUUID } from "node:crypto";

export async function GET() {
  return Response.json(
    {
      data: { status: "ok", service: "abai-ideas" },
      meta: { requestId: randomUUID() },
    },
    { status: 200 },
  );
}
