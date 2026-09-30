"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { pageForPath } from "./catalog.mjs";
import type { AssistantContext } from "./types";

type PageRegistration = { token: symbol; pathname: string; context: AssistantContext };
const AssistantContextValue = createContext<{
  context: AssistantContext;
  register: (value: PageRegistration) => void;
  unregister: (token: symbol) => void;
}>({ context: { page: "home", targets: [] }, register: () => {}, unregister: () => {} });

export function AssistantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [page, setPage] = useState<PageRegistration | null>(null);
  const register = useCallback((value: PageRegistration) => setPage(value), []);
  const unregister = useCallback((token: symbol) => setPage((value) => value?.token === token ? null : value), []);
  const context = useMemo<AssistantContext>(() => page?.pathname === pathname
    ? page.context : { page: pageForPath(pathname), targets: [] }, [page, pathname]);
  const value = useMemo(() => ({ context, register, unregister }), [context, register, unregister]);
  return <AssistantContextValue.Provider value={value}>{children}</AssistantContextValue.Provider>;
}

export function useAssistantContext() {
  return useContext(AssistantContextValue).context;
}

/** Supply screen state only, never user-entered form fields or private records. */
export function useAssistantPage(context: AssistantContext) {
  const pathname = usePathname();
  const { register, unregister } = useContext(AssistantContextValue);
  const token = useRef(Symbol("assistant-page"));
  // Pages can pass an inline object without creating a provider update loop.
  const serialized = JSON.stringify(context);
  useEffect(() => {
    const identity = token.current;
    register({ token: identity, pathname, context: JSON.parse(serialized) as AssistantContext });
    return () => unregister(identity);
  }, [pathname, serialized, register, unregister]);
}

export function AssistantPageContext({ context }: { context: AssistantContext }) {
  useAssistantPage(context);
  return null;
}
