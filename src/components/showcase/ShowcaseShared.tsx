"use client";

import Link from "next/link";
import { loginHref } from "@/features/shared/navigation";
import { useEffect, useRef, useState } from "react";
import { useNavigationBlock } from "@/components/ui/NavigationSafety";
import type { PublicIdea, ShowcaseParticipation } from "@/contracts/showcase";
import type { CategoryCode } from "@/contracts";
import { Icon, type IconName } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ApiError } from "@/features/shared/api-client";
import { useSession } from "@/features/shared/session";
import { showcaseApi } from "@/features/showcase/api";
import { useShowcaseMessages } from "@/features/showcase/messages";
import { publicStages } from "@/features/showcase/model";
import { ShowcaseIllustration } from "./ShowcaseIllustration";

const CATEGORY_ICONS: Record<CategoryCode, IconName> = { TRANSPORT: "bus", UTILITIES: "home", EDUCATION: "bulb", ECOLOGY: "leaf", SAFETY: "shield", HEALTH: "plus", TOURISM: "globe", ACCESSIBILITY: "users", OTHER: "layers" };

export function ShowcaseSymbol({ category }: { category: CategoryCode }) {
  return <span className="showcase-category-symbol" data-category={category}><Icon name={CATEGORY_ICONS[category] || "bulb"} size={27} /></span>;
}
export function SupportIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10v11H3V10h4Zm0 1 5-8c2 0 3 2 2 5l-1 2h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 2H7" /></svg>;
}
export function ShowcaseDemoNotice() {
  const { m } = useShowcaseMessages();
  return <p className="showcase-demo"><Icon name="shield" size={16} /><span>{m.demo}</span></p>;
}
export function ShowcaseDate({ value }: { value: string }) {
  const { intlLocale } = useShowcaseMessages();
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? <span>—</span> : <time dateTime={value}>{new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Qyzylorda" }).format(date)}</time>;
}
export function ShowcaseStages({ idea }: { idea: PublicIdea }) {
  const { m, ui } = useShowcaseMessages();
  const states = publicStages(idea);
  return <div className="showcase-progress" aria-label={`${m.consideration}: ${ui.statuses[idea.status]}`}>
    <div className="showcase-stage-track" aria-hidden="true">{[m.received, m.review, m.work, m.result].map((label, index) => <span key={label} data-state={states[index]}><i /><small>{label}</small></span>)}</div>
    {idea.status === "NEEDS_INFO" && <p className="showcase-stage-note" data-state="paused"><Icon name="clock" size={13} />{m.clarification}</p>}
    {idea.status === "REJECTED" && <p className="showcase-stage-note" data-state="negative"><Icon name="close" size={13} />{m.rejected}</p>}
    {idea.status === "COMPLETED" && <p className="showcase-stage-note"><Icon name="check" size={13} />{showcaseResultLabel(idea, m)}</p>}
  </div>;
}
export function showcaseResultLabel(idea: PublicIdea, m: ReturnType<typeof useShowcaseMessages>["m"]): string {
  return idea.resolutionType ? ({ ANSWER_PROVIDED: m.resultAnswer, PILOT_PLANNED: m.resultPilot, IMPLEMENTED: m.resultImplemented, FORWARDED_EXTERNALLY: m.resultForwarded })[idea.resolutionType] : m.resultUnknown;
}
export function ShowcaseActions({ idea, onChanged, returnTo = "/dashboard" }: { idea: PublicIdea; onChanged: (idea: PublicIdea) => void | Promise<void>; returnTo?: string }) {
  const { m, intlLocale } = useShowcaseMessages();
  const { user, checked } = useSession();
  const [participation, setParticipation] = useState<ShowcaseParticipation>(idea);
  const [pending, setPending] = useState<"support" | "follow" | null>(null);
  useNavigationBlock({ saving: pending !== null });
  const [notice, setNotice] = useState<"auth" | "role" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const locked = useRef(false);
  const identity = useRef("");
  const actor = `${idea.id}:${user?.id || "guest"}`;
  identity.current = actor;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setParticipation(idea); setNotice(null); setError(null); setConfirmation(""); }, [idea.id, idea.supportCount, idea.isSupported, idea.isFollowing, actor]);
  const change = async (kind: "support" | "follow") => {
    if (!checked || locked.current) return;
    if (!user) { setNotice("auth"); return; }
    if (user.role !== "CITIZEN") { setNotice("role"); return; }
    if (kind === "support" && idea.isAuthor) return;
    locked.current = true; setPending(kind); setError(null); setNotice(null); setConfirmation("");
    const currentActor = actor;
    try {
      const result = kind === "support" ? await showcaseApi.support(idea.id, !participation.isSupported) : await showcaseApi.follow(idea.id, !participation.isFollowing);
      if (!mounted.current || identity.current !== currentActor) return;
      // Both the immediate values and the later refresh come from the server.
      setParticipation(result.data);
      await onChanged({ ...idea, ...result.data });
      if (!mounted.current || identity.current !== currentActor) return;
      setConfirmation(m.actionConfirmed);
      const refreshed = await showcaseApi.detail(idea.id).catch(() => null);
      if (refreshed && mounted.current && identity.current === currentActor) {
        setParticipation(refreshed.data); await onChanged(refreshed.data);
      }
    } catch (cause) {
      if (!mounted.current || identity.current !== currentActor) return;
      if (cause instanceof ApiError && cause.detail.http === 401) setNotice("auth");
      else setError(cause instanceof ApiError ? cause.detail.message : m.actionError);
    } finally {
      locked.current = false;
      if (mounted.current) setPending(null);
    }
  };
  return <div className="showcase-participation">
    <div className="showcase-actions">
      <button className="showcase-support" type="button" aria-pressed={participation.isSupported} aria-label={`${participation.isSupported ? m.supported : m.support}. ${m.supports}: ${participation.supportCount}`} disabled={!checked || !!pending || idea.isAuthor} title={idea.isAuthor ? m.ownIdea : undefined} onClick={() => void change("support")}><SupportIcon /><span>{pending === "support" ? m.refreshing : participation.isSupported ? m.supported : m.support}</span><strong>{new Intl.NumberFormat(intlLocale).format(participation.supportCount)}</strong></button>
      <button className="showcase-follow" type="button" aria-pressed={participation.isFollowing} disabled={!checked || !!pending} onClick={() => void change("follow")}><Icon name={participation.isFollowing ? "check" : "bell"} size={17} /><span>{pending === "follow" ? m.refreshing : participation.isFollowing ? m.followingAction : m.follow}</span></button>
    </div>
    {idea.isAuthor && <p className="showcase-action-help">{m.ownIdea}</p>}
    {notice && <p className="showcase-action-notice" role="status">{notice === "role" ? m.citizenOnly : <>{m.authPrompt} <Link href={loginHref(returnTo)}>{m.signIn} <span aria-hidden="true">→</span></Link></>}</p>}
    {error && <p className="showcase-action-error" role="alert">{error}</p>}
    <span className="sr-only" role="status">{confirmation}</span>
  </div>;
}
export function PublicIdeaCard({ idea, listUrl, onChanged }: { idea: PublicIdea; listUrl: string; onChanged: (idea: PublicIdea) => void | Promise<void> }) {
  const { m, ui } = useShowcaseMessages();
  const detailUrl = `/dashboard/${encodeURIComponent(idea.id)}?returnTo=${encodeURIComponent(listUrl)}`;
  return <article className="showcase-card" data-category={idea.categoryCode}>
    <div className="showcase-card-cover"><ShowcaseIllustration category={idea.categoryCode} /><div className="showcase-card-heading"><div className="showcase-card-category"><Icon name={CATEGORY_ICONS[idea.categoryCode] || "bulb"} size={17} /><span>{ui.categories[idea.categoryCode]}</span></div><StatusBadge status={idea.status} /></div></div>
    <div className="showcase-card-body"><div className="showcase-card-meta"><p className="showcase-number">{idea.publicNumber}</p><span><ShowcaseDate value={idea.publishedAt} /></span></div><h2><Link href={detailUrl}>{idea.title}</Link></h2><p className="showcase-card-solution">{idea.solution}</p><p className="showcase-card-territory"><Icon name="pin" size={17} />{idea.territoryName || m.region}</p><ShowcaseStages idea={idea} /></div>
    {idea.latestReply && <div className="showcase-card-reply"><div><Icon name="mail" size={17} /><span>{m.reply}</span><Icon name="check" size={15} /></div><p>{idea.latestReply.body}</p></div>}
    <footer className="showcase-card-footer"><ShowcaseActions idea={idea} onChanged={onChanged} returnTo={detailUrl} /><Link href={detailUrl} className="showcase-read"><span>{m.read}</span><Icon name="arrow" size={18} /></Link></footer>
  </article>;
}
export function ShowcaseLoading({ cards = false }: { cards?: boolean }) {
  const { m } = useShowcaseMessages();
  return <div role="status" aria-label={m.loading} className={cards ? "showcase-grid showcase-loading" : "showcase-loading"}>{Array.from({ length: cards ? 6 : 1 }, (_, index) => <div className="showcase-skeleton" key={index} aria-hidden="true"><i /><i /><i /><i /></div>)}<span className="sr-only">{m.loading}</span></div>;
}
