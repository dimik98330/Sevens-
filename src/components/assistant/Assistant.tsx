"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark, Icon } from "@/components/ui/Icon";
import { assistantChatRequest, ApiError } from "@/features/shared/api-client";
import { useSession } from "@/features/shared/session";
import { useAssistantContext } from "@/features/assistant/context";
import { useNavigationCheck } from "@/components/ui/NavigationSafety";
import { availableActions, fallbackReply, quickQuestions } from "@/features/assistant/catalog.mjs";
import type { AssistantAction, AssistantLanguage, AssistantReply, AssistantRole } from "@/features/assistant/types";
import "./assistant.css";
import { useTranslation } from "@/features/i18n/provider";
import { translate } from "@/features/i18n/translations";
import { isLocale, LOCALE_CODES } from "@/features/i18n/locale";

type Message = { id: string; role: "user" | "assistant"; content: string; reply?: AssistantReply };
const HISTORY_KEY = "sevens.assistant.chat.v1";
const INVITE_KEY = "sevens.assistant.invite.v1";
const COPY = {
  ru: {
    name: "Помощник", invite: "Помочь разобраться?",
    inviteText: "Подскажу, где начать и что делать дальше.", open: "Открыть помощника Sevens", close: "Закрыть помощника",
    greeting: "Найдём следующий шаг", greetingText: "Объясню, куда зайти и как пользоваться сайтом. Вы можете спросить своими словами.",
    placeholder: "Например, как прикрепить фото к идее?", label: "Ваш вопрос", send: "Отправить вопрос", cancel: "Отменить", loading: "Готовлю ответ…",
    clear: "Очистить переписку",
    guide: "Встроенная справка", ai: "AI-помощник", retry: "Повторить запрос", cancelled: "Запрос отменён. Можно повторить или задать другой вопрос.",
    unavailable: "AI сейчас недоступен. Ниже — подсказка из справочника сайта.", rate: "Лимит запросов временно исчерпан. Ниже — справочная подсказка.",
    session: "Сеанс изменился. Войдите снова для помощи в кабинете.", offline: "Нет связи с сервером. Ниже — справочная подсказка.",
    blocked: "Сначала сохраните изменения или подтвердите выделение карты. Так вы не потеряете работу.",
    noTarget: "Этот блок пока не отображается на странице. Завершите загрузку или текущий шаг.",
  },
  kk: {
    name: "Көмекші", invite: "Көмек керек пе?",
    inviteText: "Неден бастау және әрі қарай не істеу керегін айтамын.", open: "Sevens көмекшісін ашу", close: "Көмекшіні жабу",
    greeting: "Келесі қадамды табайық", greetingText: "Қай бөлімге өту және сайтты қалай пайдалану керегін түсіндіремін. Сұрағыңызды еркін жазыңыз.",
    placeholder: "Мысалы, идеяға фотоны қалай қосуға болады?", label: "Сұрағыңыз", send: "Сұрақты жіберу", cancel: "Бас тарту", loading: "Жауап дайындап жатырмын…",
    clear: "Хат алмасуды тазалау",
    guide: "Сайт анықтамасы", ai: "AI-көмекші", retry: "Сұрауды қайталау", cancelled: "Сұрау тоқтатылды. Қайта жіберуге немесе басқа сұрақ қоюға болады.",
    unavailable: "AI қазір қолжетімсіз. Төменде сайт анықтамасынан кеңес берілген.", rate: "Сұрау лимиті уақытша таусылды. Төменде анықтамалық кеңес берілген.",
    session: "Сеанс өзгерді. Кабинетте көмек алу үшін қайта кіріңіз.", offline: "Сервермен байланыс жоқ. Төменде анықтамалық кеңес берілген.",
    blocked: "Алдымен өзгерістерді сақтаңыз немесе картадағы таңдауды растаңыз. Осылайша жұмысыңыз жоғалмайды.",
    noTarget: "Бұл блок әлі көрсетілмейді. Жүктелуді немесе ағымдағы қадамды аяқтаңыз.",
  },
};

function id() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }
function readHistory(raw: string | null, owner: string): { messages: Message[]; language: AssistantLanguage; manual: boolean } | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.owner !== owner || !Array.isArray(value.messages)) return null;
    const messages: Message[] = value.messages.filter((m: Message) => m && (m.role === "user" || m.role === "assistant")
      && typeof m.id === "string" && typeof m.content === "string" && m.content.length <= 6000).slice(-30)
      .map((m: Message) => ({ id: m.id, role: m.role, content: m.content, reply: m.reply && typeof m.reply.answer === "string"
        ? { answer: m.content, mode: m.reply.mode === "ai" ? "ai" : "guide", language: isLocale(m.reply.language) ? m.reply.language : "ru",
          actions: Array.isArray(m.reply.actions) ? m.reply.actions.filter((a) => a && typeof a.id === "string").slice(0, 3) : [],
          followups: Array.isArray(m.reply.followups) ? m.reply.followups.filter((f) => typeof f === "string" && f.length <= 160).slice(0, 3) : [] } as AssistantReply : undefined }));
    return { messages, language: isLocale(value.language) ? value.language : "ru", manual: value.manual === true };
  } catch { return null; }
}

export function Assistant() {
  const { locale: siteLocale, setLocale, t: tr } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { user, checked, refresh } = useSession();
  const context = useAssistantContext();
  const canLeave = useNavigationCheck();
  const role: AssistantRole = user?.role ?? "GUEST";
  const owner = `${user?.id ?? "guest"}:${role}`;
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [language, setLanguage] = useState<AssistantLanguage>(siteLocale);
  const [manualLanguage, setManualLanguage] = useState(true);
  const [initializedOwner, setInitializedOwner] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<keyof typeof COPY.ru | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [viewport, setViewport] = useState<CSSProperties>({});
  const dialog = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const highlightCleanup = useRef<(() => void) | null>(null);
  const t = language === "en" ? Object.fromEntries(Object.entries(COPY.ru).map(([key, value]) => [key, translate(value, "en")])) as typeof COPY.ru : COPY[language];
  const ready = checked && initializedOwner === owner;
  const actions = availableActions(role, context, language);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const measure = () => {
      setMobile(query.matches);
      const visual = window.visualViewport;
      setViewport(query.matches && visual ? { height: `${visual.height}px`, top: `${visual.offsetTop}px` } : {});
    };
    measure();
    query.addEventListener("change", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      query.removeEventListener("change", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      request.current?.abort();
      highlightCleanup.current?.();
    };
  }, []);

  useEffect(() => {
    if (!checked) return;
    request.current?.abort(); request.current = null;
    setBusy(false); setNotice(null); setInput(""); setLastQuestion(null);
    let saved: ReturnType<typeof readHistory> = null;
    try { saved = readHistory(sessionStorage.getItem(HISTORY_KEY), owner); } catch { /* Private browsing may disable storage. */ }
    setMessages(saved?.messages ?? []);
    setLanguage(siteLocale); setManualLanguage(true);
    setInitializedOwner(owner);
  }, [checked, owner]);

  useEffect(() => { setLanguage(siteLocale); setManualLanguage(true); }, [siteLocale]);

  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ owner, messages: messages.slice(-30), language, manual: manualLanguage })); } catch { /* Chat still works without storage. */ }
  }, [messages, language, manualLanguage, owner, ready]);

  useEffect(() => {
    const active = request.current;
    if (active) { active.abort(); request.current = null; setBusy(false); setNotice("cancelled"); }
    highlightCleanup.current?.(); highlightCleanup.current = null;
  }, [pathname]);

  const dismissInvite = useCallback(() => {
    setInvite(false);
    try { localStorage.setItem(INVITE_KEY, "dismissed"); } catch { /* No persistent invite when storage is unavailable. */ }
  }, []);
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => (previousFocus.current?.isConnected ? previousFocus.current : launcher.current)?.focus());
  }, []);
  const show = () => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : launcher.current;
    dismissInvite(); setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const focus = requestAnimationFrame(() => mobile ? dialog.current?.querySelector<HTMLButtonElement>("[data-close]")?.focus() : textInput.current?.focus());
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (!mobile || event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), [tabindex='0']") ?? [])
        .filter((el) => el.getClientRects().length > 0);
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", escape);
    const previousOverflow = document.body.style.overflow;
    const background: Array<{ element: HTMLElement; inert: boolean }> = [];
    if (mobile) {
      document.body.style.overflow = "hidden";
      for (const child of Array.from(document.body.children)) {
        if (child instanceof HTMLElement && !child.contains(dialog.current) && child.tagName !== "SCRIPT") {
          background.push({ element: child, inert: child.inert }); child.inert = true;
        }
      }
    }
    return () => {
      cancelAnimationFrame(focus); document.removeEventListener("keydown", escape);
      if (mobile) document.body.style.overflow = previousOverflow;
      for (const item of background) item.element.inert = item.inert;
    };
  }, [open, mobile, close]);

  useEffect(() => {
    if (open) scroller.current?.scrollTo({ top: messages.length || busy || notice ? scroller.current.scrollHeight : 0, behavior: "instant" });
  }, [messages, busy, open, notice]);

  const highlight = (target: string) => {
    if (!context.targets.includes(target)) { setNotice("noTarget"); return; }
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-assistant-target]"))
      .find((item) => item.dataset.assistantTarget === target);
    if (!element) { setNotice("noTarget"); return; }
    let ancestor: HTMLElement | null = element;
    while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
    if (element.getClientRects().length === 0) { setNotice("noTarget"); return; }
    highlightCleanup.current?.(); close(false);
    requestAnimationFrame(() => {
      const oldTabindex = element.getAttribute("tabindex");
      element.classList.add("sevens-assistant-highlight"); element.setAttribute("tabindex", "-1");
      element.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
      element.focus({ preventScroll: true });
      const cleanup = () => {
        element.classList.remove("sevens-assistant-highlight");
        if (oldTabindex === null) element.removeAttribute("tabindex"); else element.setAttribute("tabindex", oldTabindex);
      };
      const timer = window.setTimeout(cleanup, 4000);
      highlightCleanup.current = () => { window.clearTimeout(timer); cleanup(); };
    });
  };

  const act = (actionId: string) => {
    const action = availableActions(role, context, language).find((candidate: AssistantAction) => candidate.id === actionId);
    if (!action) { setNotice("noTarget"); return; }
    if (action.kind === "highlight" && action.target) { highlight(action.target); return; }
    if (context.navigationBlocked || context.saving || context.mapEditing) { setNotice("blocked"); return; }
    if (action.kind === "navigate" && action.path && canLeave()) { close(false); router.push(action.path); }
  };

  const submit = async (question: string, retry = false) => {
    const message = question.trim();
    if (!message || message.length > 1500 || busy || !ready) return;
    let languageForRequest = language;
    if (!manualLanguage && /[әғқңөұүһі]/i.test(message)) languageForRequest = "kk";
    else if (!manualLanguage && /[а-яё]/i.test(message)) languageForRequest = "ru";
    setLanguage(languageForRequest); setInput(""); setNotice(null); setLastQuestion(message);
    const lastUserIndex = messages.map((item) => item.role).lastIndexOf("user");
    const previous = retry && lastUserIndex >= 0 ? messages.slice(0, lastUserIndex) : messages;
    const next: Message[] = [...previous, { id: id(), role: "user" as const, content: message }].slice(-29);
    setMessages(next); setBusy(true);
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 58000);
    try {
      const history: Array<{ role: "user" | "assistant"; content: string }> = [];
      let historyLength = 0;
      for (const item of previous.slice(-10).reverse()) {
        const content = item.content.slice(0, 2400).trim();
        if (!content) continue;
        if (historyLength + content.length > 10000) break;
        history.unshift({ role: item.role, content }); historyLength += content.length;
      }
      const { data, meta } = await assistantChatRequest<AssistantReply>({ message, history, language: languageForRequest, context }, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      if (typeof meta.assistantRole === "string" && meta.assistantRole !== role) {
        setNotice("session");
        await refresh();
        if (request.current !== controller || controller.signal.aborted) return;
        const reply = fallbackReply(message, "GUEST", context, languageForRequest);
        setMessages((current) => [...current, { id: id(), role: "assistant" as const, content: reply.answer, reply }].slice(-30));
        return;
      }
      if (!data || typeof data.answer !== "string" || !data.answer.trim() || data.answer.length > 6000
        || !Array.isArray(data.actions) || !Array.isArray(data.followups) || !["ai", "guide"].includes(data.mode)) throw new Error("Invalid assistant response");
      const allowed = availableActions(role, context, languageForRequest);
      const reply = { ...data, actions: data.actions.map((item) => allowed.find((a: AssistantAction) => a.id === item?.id)).filter(Boolean).slice(0, 3) as AssistantAction[],
        followups: data.followups.filter((f) => typeof f === "string" && f.length <= 160).slice(0, 3) };
      if (reply.mode === "guide") setNotice("unavailable");
      setMessages((current) => [...current, { id: id(), role: "assistant" as const, content: reply.answer, reply }].slice(-30));
    } catch (error) {
      if (request.current !== controller) return;
      if (controller.signal.aborted && controller.signal.reason !== "timeout") { setNotice("cancelled"); return; }
      const detail = error instanceof ApiError ? error.detail : null;
      setNotice(detail?.http === 429 ? "rate" : detail?.http === 401 || detail?.http === 403 ? "session" : detail?.http === 0 ? "offline" : "unavailable");
      const sessionRejected = detail?.http === 401 || detail?.http === 403;
      if (sessionRejected) {
        await refresh();
        if (request.current !== controller || controller.signal.aborted) return;
      }
      const reply = fallbackReply(message, sessionRejected ? "GUEST" : role, context, languageForRequest);
      setMessages((current) => [...current, { id: id(), role: "assistant" as const, content: reply.answer, reply }].slice(-30));
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };

  const onSubmit = (event: FormEvent) => { event.preventDefault(); void submit(input); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(input); }
  };
  const clear = () => { request.current?.abort(); request.current = null; setBusy(false); setMessages([]); setNotice(null); setLastQuestion(null); setInput(""); textInput.current?.focus(); };
  const quick = quickQuestions(role, context, language);
  const followups = messages.at(-1)?.reply?.followups ?? [];
  const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");

  return <div className="sevens-assistant" data-assistant-widget>
    {!open && <>
      {invite && !/^\/(my|ideas|staff|notifications|settings)(\/|$)/.test(pathname) && <div className="sevens-assistant-invite">
        <button type="button" className="sevens-assistant-invite-open" onClick={show}><strong>{t.invite}</strong><span>{t.inviteText}</span></button>
        <button type="button" className="sevens-assistant-icon-button" aria-label={t.close} onClick={dismissInvite}><Icon name="close" size={16} /></button>
      </div>}
      <button type="button" ref={launcher} className="sevens-assistant-launcher" aria-label={t.open} aria-haspopup="dialog" aria-controls="sevens-assistant-dialog" aria-expanded={false} onClick={show}>
        <span className="sevens-assistant-symbol"><BrandMark /></span><span>{t.name}<small>SEVENS</small></span><span className="sevens-assistant-launcher-arrow"><Icon name="arrow" size={18} /></span>
      </button>
    </>}
    {open && <section ref={dialog} id="sevens-assistant-dialog" className="sevens-assistant-panel" style={mobile ? viewport : undefined} role="dialog" aria-modal={mobile || undefined} aria-labelledby="sevens-assistant-title" lang={language}>
      <header className="sevens-assistant-header">
        <span className="sevens-assistant-header-mark"><BrandMark /></span>
        <div className="sevens-assistant-heading"><h2 id="sevens-assistant-title">{t.name} <span>Sevens</span></h2></div>
        <button type="button" data-close className="sevens-assistant-icon-button" aria-label={t.close} onClick={() => close()}><Icon name="close" /></button>
      </header>
      <div className="sevens-assistant-tools">
        <div className="sevens-assistant-language" aria-label={tr("Язык")}>{(["ru", "kk", "en"] as const).map((lang) => <button key={lang} type="button" lang={lang} aria-pressed={language === lang} onClick={() => { setLocale(lang); setLanguage(lang); setManualLanguage(true); }}>{LOCALE_CODES[lang]}</button>)}</div>
        <button type="button" className="sevens-assistant-clear" onClick={clear} disabled={messages.length === 0 && !busy}><Icon name="layers" size={15} />{t.clear}</button>
      </div>
      <div ref={scroller} className="sevens-assistant-conversation">
        {messages.length === 0 && <div className="sevens-assistant-welcome"><h3>{t.greeting}</h3><p>{t.greetingText}</p><div className="sevens-assistant-quick">{quick.map((question) => <button key={question} type="button" disabled={!ready || busy} onClick={() => void submit(question)}>{question}<Icon name="arrow" size={17} /></button>)}</div></div>}
        <div className="sevens-assistant-messages" role="log" aria-label={tr("Переписка")} aria-live="off">{messages.map((message) => <article key={message.id} className="sevens-assistant-message" data-role={message.role}>
          {message.role === "assistant" && <span className="sevens-assistant-message-label"><span className="sevens-assistant-label-dot" />{message.reply?.mode === "guide" ? t.guide : t.ai}</span>}
          <p>{message.content}</p>
          {message.reply && <div className="sevens-assistant-actions">{message.reply.actions.map((item) => actions.find((candidate: AssistantAction) => candidate.id === item.id)).filter(Boolean).slice(0, 3).map((action) => action && <button key={action.id} type="button" onClick={() => act(action.id)}><Icon name={action.kind === "highlight" ? "pin" : "arrow"} size={16} />{action.label}</button>)}</div>}
        </article>)}</div>
        {busy && <div className="sevens-assistant-loading" role="status"><span /><span>{t.loading}</span><button type="button" onClick={() => request.current?.abort()}>{t.cancel}</button></div>}
        {notice && <div className="sevens-assistant-notice" role="status"><p>{typeof t[notice] === "string" ? t[notice] : ""}</p>{lastQuestion && ["unavailable", "rate", "offline", "session", "cancelled"].includes(notice) && <button type="button" disabled={busy || !ready} onClick={() => void submit(lastQuestion, true)}>{t.retry}<Icon name="arrow" size={15} /></button>}</div>}
        {!busy && followups.length > 0 && <div className="sevens-assistant-followups">{followups.map((question) => <button type="button" key={question} disabled={!ready} onClick={() => void submit(question)}>{question}</button>)}</div>}
      </div>
      <form className="sevens-assistant-compose" onSubmit={onSubmit}>
        <div className="sevens-assistant-input-wrap"><label className="sr-only" htmlFor="sevens-assistant-question">{t.label}</label><textarea ref={textInput} id="sevens-assistant-question" placeholder={t.placeholder} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} maxLength={1500} rows={2} disabled={busy || !ready} /><button type="submit" className="sevens-assistant-send" aria-label={t.send} disabled={busy || !ready || !input.trim()}><Icon name="arrow" size={21} /></button></div>
      </form>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{busy ? "" : lastAssistant?.content ?? ""}</span>
    </section>}
  </div>;
}
