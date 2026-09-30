import { Suspense } from "react";
import { PublicIdeaDetail } from "@/components/showcase/PublicIdeaDetail";

export default async function PublicIdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<div className="showcase showcase-route-loading" role="status">…</div>}><PublicIdeaDetail id={id} /></Suspense>;
}
