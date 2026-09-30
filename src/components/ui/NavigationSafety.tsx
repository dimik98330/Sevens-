"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAssistantContext } from "@/features/assistant/context";
import { useTranslation } from "@/features/i18n/provider";

type Block = { unsaved?: boolean; saving?: boolean; mapEditing?: boolean };
const NavigationBlocks = createContext<{ block: Block; register: (key: symbol, block: Block) => void; remove: (key: symbol) => void }>({ block: {}, register: () => {}, remove: () => {} });
export function NavigationBlockProvider({ children }: { children: ReactNode }) {
  const [blocks, setBlocks] = useState(new Map<symbol, Block>());
  const register = useCallback((key: symbol, block: Block) => setBlocks((current) => new Map(current).set(key, block)), []);
  const remove = useCallback((key: symbol) => setBlocks((current) => { const next = new Map(current); next.delete(key); return next; }), []);
  const value = useMemo(() => ({ register, remove, block: { unsaved: [...blocks.values()].some((block) => block.unsaved), saving: [...blocks.values()].some((block) => block.saving), mapEditing: [...blocks.values()].some((block) => block.mapEditing) } }), [blocks, register, remove]);
  return <NavigationBlocks.Provider value={value}>{children}</NavigationBlocks.Provider>;
}
/** Add a nested form's flags without replacing its parent page registration. */
export function useNavigationBlock(block: Block) {
  const { register, remove } = useContext(NavigationBlocks);
  const key = useRef(Symbol("navigation-block"));
  const serialized = JSON.stringify(block);
  useEffect(() => { const token = key.current; register(token, JSON.parse(serialized) as Block); return () => remove(token); }, [serialized, register, remove]);
}
function useNavigationState() {
  const context = useAssistantContext();
  const { block } = useContext(NavigationBlocks);
  return { navigationBlocked: context.navigationBlocked || block.unsaved, saving: context.saving || block.saving, mapEditing: context.mapEditing || block.mapEditing };
}

/** The same confirmed/unsaved state used by page actions protects navigation. */
export function useNavigationCheck() {
  const context = useNavigationState();
  const { t } = useTranslation();
  return useCallback(() => {
    if (context.saving) {
      window.alert(t("Дождитесь завершения текущего действия, затем перейдите в другой раздел."));
      return false;
    }
    if (context.mapEditing) {
      window.alert(t("Подтвердите или отмените выбор места перед переходом в другой раздел."));
      return false;
    }
    return !context.navigationBlocked || window.confirm(t("Есть несохранённые изменения. Покинуть страницу без сохранения?"));
  }, [context.saving, context.mapEditing, context.navigationBlocked, t]);
}

export function NavigationSafety() {
  const context = useNavigationState();
  const canLeave = useNavigationCheck();
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.hasAttribute("download") || (target.target && target.target !== "_self")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname.startsWith("/api/")) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!canLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener("click", click, true);
    // Native Back/Forward is cancellable for same-document traversals in
    // Navigation API browsers, without rewriting Next's history entries.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const traverse = (event: Event) => {
      const action = event as Event & { navigationType?: string; destination?: { url: string }; hashChange?: boolean };
      if (action.navigationType !== "traverse" || !event.cancelable || action.hashChange) return;
      if (action.destination) {
        const destination = new URL(action.destination.url);
        if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      }
      if (!canLeave()) event.preventDefault();
    };
    navigation?.addEventListener("navigate", traverse);
    return () => { document.removeEventListener("click", click, true); navigation?.removeEventListener("navigate", traverse); };
  }, [canLeave]);
  useEffect(() => {
    if (!context.navigationBlocked && !context.saving && !context.mapEditing) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [context.navigationBlocked, context.saving, context.mapEditing]);
  return null;
}
