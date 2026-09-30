"use client";

import Link from "next/link";
import { loginHref } from "@/features/shared/navigation";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PublicIdea, ShowcaseSummary } from "@/contracts/showcase";
import { CategoryCode, IdeaStatus } from "@/contracts";
import { Icon, type IconName } from "@/components/ui/Icon";
import { api, ApiError } from "@/features/shared/api-client";
import { normalizeCatalogs, type NormalizedCatalog } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { useDestinations } from "@/features/shared/use-destinations";
import { useTranslation } from "@/features/i18n/provider";
import { showcaseApi } from "@/features/showcase/api";
import { useShowcaseMessages } from "@/features/showcase/messages";
import { INITIAL_FILTERS, hasShowcaseFilters, parseShowcaseFilters, showcaseQuery, type ShowcaseFilters, type ShowcaseSort } from "@/features/showcase/model";
import { PublicIdeaCard, ShowcaseDemoNotice, ShowcaseLoading } from "./ShowcaseShared";

function summaryFrom(value: unknown): ShowcaseSummary | null {
  const summary = value as Partial<ShowcaseSummary> | null;
  return summary && [summary.published, summary.inProgress, summary.completed, summary.totalSupports].every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) ? summary as ShowcaseSummary : null;
}

export function IdeasDashboard() {
  const { staff, proposalHref } = useDestinations();
  const { t } = useTranslation();
  const { m, ui, intlLocale } = useShowcaseMessages();
  const { user, checked } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const rawQuery = params.toString();
  const filters = useMemo(() => parseShowcaseFilters(new URLSearchParams(rawQuery)), [rawQuery]);
  const query = showcaseQuery(filters, true);
  const listUrl = `/dashboard${showcaseQuery(filters) ? `?${showcaseQuery(filters)}` : ""}`;
  const [draftQ, setDraftQ] = useState(filters.q);
  const [catalogs, setCatalogs] = useState<NormalizedCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [items, setItems] = useState<PublicIdea[]>([]);
  const [summary, setSummary] = useState<ShowcaseSummary | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadedQuery, setLoadedQuery] = useState("");
  const sequence = useRef(0);
  const followingAllowed = checked && user?.role === "CITIZEN";
  const protectedTab = filters.following && !followingAllowed;

  useEffect(() => { setDraftQ(filters.q); }, [filters.q]);
  useEffect(() => {
    let active = true;
    api.get<unknown>("/api/v1/catalogs").then(({ data }) => { if (active) setCatalogs(normalizeCatalogs(data)); }).catch(() => { if (active) setCatalogError(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const request = ++sequence.current;
    if (!checked) return;
    if (protectedTab) { setLoading(false); setItems([]); setTotal(null); setError(null); return; }
    setLoading(true); setError(null);
    showcaseApi.list(query).then((result) => {
      if (sequence.current !== request) return;
      setItems(result.data); setSummary(summaryFrom(result.meta.summary));
      setTotal(typeof result.meta.total === "number" && Number.isSafeInteger(result.meta.total) ? result.meta.total : null);
      setLoadedQuery(query);
    }).catch((cause) => {
      if (sequence.current !== request) return;
      setError(cause instanceof ApiError ? cause.detail.message : m.error);
      setItems([]); setTotal(null);
    }).finally(() => { if (sequence.current === request) setLoading(false); });
    return () => { sequence.current += 1; };
  }, [query, checked, protectedTab, user?.id, revision, m.error]);

  const navigate = (patch: Partial<ShowcaseFilters>) => {
    const next = { ...filters, q: draftQ.normalize("NFC").trim(), page: 1, ...patch };
    const search = showcaseQuery(next);
    router.push(`/dashboard${search ? `?${search}` : ""}`, { scroll: false });
  };
  const search = (event: FormEvent) => { event.preventDefault(); navigate({}); };
  const changed = (idea: PublicIdea) => { setItems((previous) => previous.map((item) => item.id === idea.id ? idea : item)); setRevision((previous) => previous + 1); };
  const number = new Intl.NumberFormat(intlLocale);
  const stats: Array<{ key: keyof ShowcaseSummary; label: string; icon: IconName }> = [
    { key: "published", label: m.published, icon: "bulb" }, { key: "inProgress", label: m.inProgress, icon: "layers" },
    { key: "completed", label: m.completed, icon: "check" }, { key: "totalSupports", label: m.totalSupports, icon: "users" },
  ];
  const pageCount = total === null ? 1 : Math.max(1, Math.ceil(total / 9));
  const showCards = !protectedTab && loadedQuery === query && items.length > 0;
  const guideSteps = [{ title: m.heroOne, text: m.heroOneText, icon: "bulb" }, { title: m.heroTwo, text: m.heroTwoText, icon: "bell" }, { title: m.heroThree, text: m.heroThreeText, icon: "mail" }];

  return <div className="showcase showcase-dashboard">
    <section className="showcase-hero" aria-labelledby="showcase-heading">
      <div className="showcase-hero-copy"><p className="showcase-eyebrow"><span />{m.eyebrow}</p><h1 id="showcase-heading">{m.title}</h1><p className="showcase-hero-intro">{m.intro}</p><div className="showcase-hero-actions"><Link href={proposalHref} className="showcase-primary"><Icon name="plus" size={19} />{staff ? t("Кабинет специалиста") : m.propose}<Icon name="arrow" size={18} /></Link><a href="#showcase-explanation" className="showcase-hero-link">{m.how}<Icon name="arrow" size={17} /></a></div></div>
      <ol className="showcase-hero-guide" id="showcase-explanation">{guideSteps.map((step, index) => <li key={step.title}><span className="showcase-guide-number">0{index + 1}</span><div><strong>{step.title}</strong><p>{step.text}</p></div><Icon name={step.icon as IconName} size={21} /></li>)}</ol>
      <details className="showcase-mobile-guide"><summary>{m.how}<Icon name="chevron" size={16} /></summary><ol>{guideSteps.map((step, index) => <li key={step.title}><span className="showcase-guide-number">0{index + 1}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></li>)}</ol></details>
    </section>
    <ShowcaseDemoNotice />
    <section className="showcase-stats" aria-label={m.eyebrow}>{stats.map((stat) => <div className="showcase-stat" key={stat.key}><span className="showcase-stat-icon"><Icon name={stat.icon} size={21} /></span><div><strong>{summary ? number.format(summary[stat.key]) : "—"}</strong><span>{stat.label}</span></div></div>)}</section>
    <div className="showcase-list-heading"><div className="showcase-tabs" role="group" aria-label={m.all}><button type="button" aria-pressed={!filters.following} onClick={() => navigate({ following: false })}>{m.all}</button><button type="button" aria-pressed={filters.following} onClick={() => navigate({ following: true })}><Icon name="bell" size={15} />{m.following}</button></div><label className="showcase-sort"><span className="sr-only">{m.sort}</span><select value={filters.sort} onChange={(event) => navigate({ sort: event.target.value as ShowcaseSort })}><option value="popular">{m.popular}</option><option value="newest">{m.newest}</option><option value="updated">{m.updated}</option></select><Icon name="chevron" size={14} /></label></div>
    <form className="showcase-filters" onSubmit={search} aria-label={m.search}>
      <div className="showcase-search"><label className="sr-only" htmlFor="showcase-search">{m.search}</label><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg><input id="showcase-search" type="search" value={draftQ} maxLength={100} placeholder={m.searchPlaceholder} onChange={(event) => setDraftQ(event.target.value)} /><button type="submit">{m.find}<Icon name="arrow" size={16} /></button></div>
      <div className="showcase-filter-selects"><label>{m.category}<select value={filters.category} onChange={(event) => navigate({ category: event.target.value })}><option value="">{m.allCategories}</option>{(catalogs?.categories || CategoryCode).map((code) => <option key={code} value={code}>{ui.categories[code as keyof typeof ui.categories] || code}</option>)}</select></label><label>{m.territory}<select value={filters.territoryId} disabled={!catalogs} onChange={(event) => navigate({ territoryId: event.target.value })}><option value="">{m.allTerritories}</option>{catalogs?.territories.filter((territory) => !!territory.id).map((territory) => <option key={territory.id} value={territory.id}>{territory.nameRu}</option>)}</select></label><label>{m.status}<select value={filters.status} onChange={(event) => navigate({ status: event.target.value })}><option value="">{m.allStatuses}</option>{IdeaStatus.filter((status) => status !== "DRAFT").map((status) => <option key={status} value={status}>{ui.statuses[status]}</option>)}</select></label><button className="showcase-reset" type="button" disabled={!hasShowcaseFilters(filters) && !draftQ} onClick={() => { setDraftQ(""); navigate({ ...INITIAL_FILTERS, following: filters.following, sort: filters.sort }); }}><Icon name="close" size={14} />{m.reset}</button></div>
      {catalogError && <p className="showcase-filter-note" role="status">{m.error}. <button type="button" onClick={() => { setCatalogError(false); api.get<unknown>("/api/v1/catalogs").then(({ data }) => setCatalogs(normalizeCatalogs(data))).catch(() => setCatalogError(true)); }}>{m.retry}</button></p>}
    </form>
    <div className="showcase-results-meta" role="status"><span>{total !== null && !protectedTab ? <>{m.results}: <strong>{number.format(total)}</strong></> : m.all}</span><span>{loading ? m.refreshing : ""}</span></div>
    {protectedTab && checked ? <div className="showcase-empty"><span className="showcase-empty-icon"><Icon name="bell" size={30} /></span><h2>{m.following}</h2><p>{user ? m.citizenOnly : m.authPrompt}</p>{!user && <Link href={loginHref(listUrl)} className="showcase-primary">{m.signIn}<Icon name="arrow" size={17} /></Link>}</div> : error ? <div className="showcase-empty showcase-error" role="alert"><span className="showcase-empty-icon"><Icon name="globe" size={30} /></span><h2>{m.error}</h2><p>{error}</p><button type="button" className="showcase-primary" onClick={() => setRevision((value) => value + 1)}>{m.retry}<Icon name="arrow" size={17} /></button></div> : loading && !showCards ? <ShowcaseLoading cards /> : showCards ? <div className="showcase-grid" aria-busy={loading}>{items.map((idea) => <PublicIdeaCard key={idea.id} idea={idea} listUrl={listUrl} onChanged={changed} />)}</div> : <div className="showcase-empty"><span className="showcase-empty-icon"><Icon name={filters.following ? "bell" : "bulb"} size={32} /></span><h2>{filters.following ? m.emptyFollowing : hasShowcaseFilters(filters) ? m.noResults : m.empty}</h2><p>{filters.following ? m.emptyFollowingText : hasShowcaseFilters(filters) ? m.noResultsText : m.emptyText}</p>{!filters.following && !hasShowcaseFilters(filters) && <Link className="showcase-empty-own-link" href={staff ? "/staff?publication=pending" : user ? "/my" : loginHref("/my")}>{t(staff ? "Проверить заявки на публикацию" : "Открыть мои идеи")}<Icon name="arrow" size={17} /></Link>}{hasShowcaseFilters(filters) ? <button className="showcase-primary" type="button" onClick={() => { setDraftQ(""); navigate({ ...INITIAL_FILTERS, following: filters.following }); }}>{m.reset}<Icon name="arrow" size={17} /></button> : <Link href={proposalHref} className="showcase-primary">{staff ? t("Кабинет специалиста") : m.propose}<Icon name="plus" size={17} /></Link>}</div>}
    {!protectedTab && !error && total !== null && pageCount > 1 && <nav className="showcase-pagination" aria-label={m.page}><button type="button" disabled={filters.page <= 1 || loading} onClick={() => navigate({ page: filters.page - 1 })}>← {m.previous}</button><span>{m.page} <strong>{filters.page}</strong> {m.of} {pageCount}</span><button type="button" disabled={filters.page >= pageCount || loading} onClick={() => navigate({ page: filters.page + 1 })}>{m.next} →</button></nav>}
    <p className="showcase-privacy"><Icon name="lock" size={15} />{m.privacy}</p>
  </div>;
}
