import { Suspense } from "react";
import { IdeasDashboard } from "@/components/showcase/IdeasDashboard";

export default function DashboardPage() {
  return <Suspense fallback={<div className="showcase showcase-route-loading" role="status">…</div>}><IdeasDashboard /></Suspense>;
}
