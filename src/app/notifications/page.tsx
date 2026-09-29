"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/features/shared/api-client";
import { useSession } from "@/features/shared/session";
import { currentMockMode, mockStore } from "@/features/shared/mock";
import { api } from "@/features/shared/api-client";
import { EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";

interface Notif {
  id: string;
  ideaId: string;
  title: string;
  readAt: string | null;
  at: string;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user, checked, refresh } = useSession();
  const [items, setItems] = useState<Notif[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (checked && !user) router.replace("/login");
  }, [checked, user, router]);

  useEffect(() => {
    if (!checked || !user) return;
    const load = async () => {
      try {
        const list = currentMockMode()
          ? mockStore.notifications()
          : (await api.get<Notif[]>("/api/v1/notifications")).data;
        setItems(list);
      } catch (err) {
        setItems([]);
        setError(err as ApiError);
      }
    };
    load();
  }, [checked, user]);

  if (!checked || !user) return null;

  const open = async (n: Notif) => {
    try {
      if (currentMockMode()) {
        const all = mockStore.notifications() as Array<Record<string, unknown>>;
        const found = all.find((x) => x.id === n.id);
        if (found) found.readAt = new Date().toISOString();
      } else {
        await api.post(`/api/v1/notifications/${n.id}/read`, {});
      }
    } catch {
      // прочтение идемпотентно и не блокирует переход
    }
    refresh();
    router.push(`/ideas/${n.ideaId}`);
  };

  return (
    <div className="card">
      <h1>Уведомления</h1>
      <div aria-live="polite">
        {error && <ErrorNotice error={error} />}
        {items === null && <Skeleton lines={3} />}
        {items !== null && !items.length && !error && (
          <EmptyState title="Уведомлений пока нет" text="Новые события по вашим идеям появятся здесь." />
        )}
        {items?.map((n) => (
          <div key={n.id} className="idea-row">
            <div>
              <Link href={`/ideas/${n.ideaId}`} onClick={() => open(n)} style={{ fontWeight: 700, color: "inherit" }}>
                {n.title}
              </Link>
              <p className="meta">
                {new Date(n.at).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })} {n.readAt ? "· прочитано" : "· новое"}
              </p>
            </div>
            {!n.readAt && <span className="tag">новое</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
