"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PublicIdea, ShowcaseEvent } from "@/contracts/showcase";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ApiError } from "@/features/shared/api-client";
import { useSession } from "@/features/shared/session";
import { safeNextPath } from "@/features/shared/navigation";
import { useTranslation } from "@/features/i18n/provider";
import { showcaseApi } from "@/features/showcase/api";
import { useShowcaseMessages } from "@/features/showcase/messages";
import { safeDashboardBack } from "@/features/showcase/model";
import { ShowcaseActions, ShowcaseDate, ShowcaseDemoNotice, ShowcaseLoading, ShowcaseStages, ShowcaseSymbol, showcaseResultLabel } from "./ShowcaseShared";

export function PublicIdeaDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const { m, ui } = useShowcaseMessages();
  const { user, checked } = useSession();
  const params = useSearchParams();
  const destination = safeNextPath(params.get("returnTo"));
  const fromNotifications = destination === "/notifications" || Boolean(destination?.startsWith("/notifications?"));
  const back = fromNotifications && destination ? destination : safeDashboardBack(params.get("returnTo"));
  const [idea, setIdea] = useState<PublicIdea | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const request = ++sequence.current;
    if (!checked) return;
    setLoading(true); setError(null); setIdea(null);
    showcaseApi.detail(id).then(({ data }) => { if (sequence.current === request) setIdea(data); }).catch((cause) => {
      if (sequence.current === request) setError({ message: cause instanceof ApiError ? cause.detail.message : m.error, notFound: cause instanceof ApiError && [403, 404].includes(cause.detail.http) });
    }).finally(() => { if (sequence.current === request) setLoading(false); });
    return () => { sequence.current += 1; };
  }, [id, checked, user?.id, revision, m.error]);

  const nextStep = idea ? ({ RECEIVED: m.nextReceived, UNDER_REVIEW: m.nextReview, NEEDS_INFO: m.nextInfo, IN_PROGRESS: m.nextWork, COMPLETED: m.nextCompleted, REJECTED: m.nextRejected })[idea.status] : "";
  const timeline = [...(idea?.timeline || [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const eventHeading = (event: ShowcaseEvent) => event.type === "PUBLISHED" ? m.publishedEvent : event.type === "REPLY" ? m.replyEvent : event.status ? `${m.statusEvent}: ${ui.statuses[event.status]}` : m.statusEvent;

  return <div className="showcase showcase-detail">
    <Link href={back} className="showcase-back"><span aria-hidden="true">←</span>{fromNotifications ? t("Уведомления") : m.back}</Link>
    <ShowcaseDemoNotice />
    {loading ? <ShowcaseLoading /> : error || !idea ? <div className="showcase-empty" role="alert"><span className="showcase-empty-icon"><Icon name="file" size={30} /></span><h1>{error?.notFound ? m.notFound : m.error}</h1><p>{error?.notFound ? m.notFoundText : error?.message}</p>{!error?.notFound && <button type="button" className="showcase-primary" onClick={() => setRevision((value) => value + 1)}>{m.retry}<Icon name="arrow" size={17} /></button>}</div> : <>
      <header className="showcase-detail-heading"><div className="showcase-detail-category"><ShowcaseSymbol category={idea.categoryCode} /><span>{ui.categories[idea.categoryCode]}</span><span className="showcase-number">{idea.publicNumber}</span></div><h1>{idea.title}</h1><div className="showcase-detail-meta"><span><Icon name="pin" size={16} />{idea.territoryName || m.region}</span><span>{m.publishedOn} <ShowcaseDate value={idea.publishedAt} /></span><span>{m.updatedOn} <ShowcaseDate value={idea.updatedAt} /></span></div></header>
      <div className="showcase-detail-grid"><div className="showcase-detail-main"><article className="showcase-description"><section><span className="showcase-section-number" aria-hidden="true">01</span><div><h2>{m.problem}</h2><p>{idea.problem}</p></div></section><section><span className="showcase-section-number" aria-hidden="true">02</span><div><h2>{m.solution}</h2><p>{idea.solution}</p></div></section>{idea.expectedBenefit && <section><span className="showcase-section-number" aria-hidden="true">03</span><div><h2>{m.benefit}</h2><p>{idea.expectedBenefit}</p></div></section>}</article>
        <section className="showcase-reply-panel" aria-labelledby="showcase-reply-title"><div className="showcase-section-heading"><span><Icon name="mail" size={21} /></span><h2 id="showcase-reply-title">{m.reply}</h2>{idea.latestReply && <Icon name="check" size={18} />}</div>{idea.latestReply ? <><p className="showcase-reply-body">{idea.latestReply.body}</p><p className="showcase-reply-date"><ShowcaseDate value={idea.latestReply.createdAt} /></p></> : <div className="showcase-no-reply"><h3>{m.noReply}</h3><p>{m.noReplyText}</p></div>}</section>
        <section className="showcase-history" aria-labelledby="showcase-history-title"><h2 id="showcase-history-title">{m.history}</h2>{timeline.length ? <ol>{timeline.map((event) => <li key={event.id} data-type={event.type}><span className="showcase-event-marker"><Icon name={event.type === "PUBLISHED" ? "globe" : event.type === "REPLY" ? "mail" : "clock"} size={15} /></span><div><div className="showcase-event-heading"><h3>{eventHeading(event)}</h3><ShowcaseDate value={event.createdAt} /></div>{event.body && <p>{event.body}</p>}</div></li>)}</ol> : <p className="showcase-muted">{m.historyEmpty}</p>}</section>
      </div><aside className="showcase-detail-sidebar"><section className="showcase-status-panel"><p className="showcase-panel-eyebrow">{m.currentStatus}</p><StatusBadge status={idea.status} /><ShowcaseStages idea={idea} />{idea.status === "COMPLETED" && <strong className="showcase-result-title">{showcaseResultLabel(idea, m)}</strong>}<h2>{m.nextStep}</h2><p>{nextStep}</p>{idea.organizationName && <p className="showcase-organization"><Icon name="home" size={15} />{idea.organizationName}</p>}</section><section className="showcase-support-panel"><h2>{m.heroTwo}</h2><p>{m.heroTwoText}</p><ShowcaseActions idea={idea} onChanged={setIdea} returnTo={`/dashboard/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(back)}`} /></section><p className="showcase-detail-privacy"><Icon name="lock" size={16} />{m.privacy}</p></aside></div>
    </>}
  </div>;
}
