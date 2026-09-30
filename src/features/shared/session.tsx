"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, setCsrf } from "./api-client";
import { currentMockMode, mockStore } from "./mock";

export interface SessionUser {
  id: string;
  displayName: string;
  role: "CITIZEN" | "STAFF" | "ADMIN";
  organizationId: string | null;
}

interface SessionValue {
  user: SessionUser | null;
  checked: boolean;
  unread: number;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  user: null,
  checked: false,
  unread: 0,
  refresh: async () => {},
  signOut: async () => {},
});

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

// После входа житель идёт в свой кабинет, сотрудник/админ — в очередь (01 §5).
export function postLoginPath(role: string): string {
  return role === "CITIZEN" ? "/my" : "/staff";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      if (currentMockMode()) {
        setUser(mockStore.me() as SessionUser | null);
      } else {
        const { data } = await api.get<{ id: string; displayName: string; role: SessionUser["role"]; organizationId: string | null; csrfToken: string }>(
          "/api/v1/auth/me",
        );
        setCsrf(data.csrfToken, data.id);
        setUser({ id: data.id, displayName: data.displayName, role: data.role, organizationId: data.organizationId });
      }
    } catch {
      setUser(null);
      setCsrf(null);
    } finally {
      setChecked(true);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (currentMockMode()) mockStore.logout();
      else await api.post("/api/v1/auth/logout", {});
    } catch {
      // выход локальный даже при сетевой ошибке
    }
    setUser(null);
    setCsrf(null);
    setUnread(0);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Уведомления: опрос раз в 10 с на активной вкладке (01 §14).
  useEffect(() => {
    if (!user) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      if (document.hidden) return;
      try {
        if (currentMockMode()) {
          if (active) setUnread(mockStore.notifications().filter((n) => !n.readAt).length);
        } else {
          const { data, meta } = await api.get<Array<{ readAt: string | null }>>("/api/v1/notifications");
          if (active) setUnread(typeof meta.unreadCount === "number" ? meta.unreadCount : data.filter((n) => !n.readAt).length);
        }
      } catch {
        // тихий пропуск: ошибка видна на самом экране уведомлений
      }
    };
    poll();
    timer = setInterval(poll, 10000);
    const onVis = () => poll();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user]);

  const value = useMemo(() => ({ user, checked, unread, refresh, signOut }), [user, checked, unread, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
