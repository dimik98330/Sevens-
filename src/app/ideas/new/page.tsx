"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/features/shared/api-client";
import { resolveTerritoryId, store, useMock } from "@/features/shared/data";
import { serverPreviewInput, useRoutingPreview } from "@/features/shared/use-routing-preview";
import { RouteCard } from "@/components/ui/RouteCard";
import { useSession } from "@/features/shared/session";
import { loginHref } from "@/features/shared/navigation";
import { ErrorNotice, InfoNotice } from "@/components/ui/Feedback";
import { previewRoute } from "@/features/shared/route-preview";
import type { PreviewInput } from "@/features/shared/route-preview";
import type { RoutingDecision } from "@/domain/routing/types";
import ru from "@/locales/ru.json";
import {
  LocationMap,
  type LocationGeometry,
} from "@/components/location/LocationMap";
import { Icon } from "@/components/ui/Icon";
import { PublicationPanel } from "@/components/showcase/PublicationPanel";
import { useAssistantPage } from "@/features/assistant/context";
import { useTranslation, useUiMessages } from "@/features/i18n/provider";
import { TerritoryOptions } from '@/components/location/TerritoryOptions';
import { territoryDisplayName, type CatalogTerritory } from '@/features/shared/territories';

interface DraftData {
  title: string;
  problem: string;
  solution: string;
  expectedBenefit: string;
  territoryId: string;
  locationText: string;
  locationGeometry: LocationGeometry | null;
  requested: string; // AUTO или код
}

interface Catalog {
  categories: string[];
  territories: CatalogTerritory[];
}

// B принимает territoryId UUID из catalogs[].id (d37aeab); правило — в фасаде данных.
const territoryValue = resolveTerritoryId;

const CATEGORIES = ru.categories as Record<string, string>;

function emptyDraft(): DraftData {
  return {
    title: "",
    problem: "",
    solution: "",
    expectedBenefit: "",
    territoryId: "",
    locationText: "",
    locationGeometry: null,
    requested: "AUTO",
  };
}

function Wizard() {
  const [territorySearch, setTerritorySearch] = useState('');
  const { locale } = useTranslation();
  const ru = useUiMessages();
  const { t: tr, intlLocale } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const draftId = params.get("draft");
  const requestedReturn = params.get("returnTo");
  const returnTo = requestedReturn === "/my" || requestedReturn?.startsWith("/my?") || requestedReturn === "/notifications" || requestedReturn?.startsWith("/notifications?")
    ? requestedReturn : "/my";
  const returnLabel = returnTo.startsWith("/notifications") ? "← Уведомления" : "← Мои идеи";
  const returnQuery = returnTo === "/my" ? "" : `&returnTo=${encodeURIComponent(returnTo)}`;
  const [step, setStep] = useState(1);
  const [id, setId] = useState<string | null>(draftId);
  const [version, setVersion] = useState<number | null>(null);
  const [data, setData] = useState<DraftData>(emptyDraft);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(() => api.key());
  const [intentKey, setIntentKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mapEditing, setMapEditing] = useState(false);
  const [restoring, setRestoring] = useState(Boolean(draftId));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const restoredDraft = useRef<string | null>(null);
  const queryDraft = useRef(draftId);
  const [files, setFiles] = useState<
    Array<{ name: string; size: number; status: string; attachmentId?: string }>
  >([]);
  const [done, setDone] = useState<{
    publicNumber: string;
    routing: RoutingDecision;
    id: string;
  } | null>(null);
  useAssistantPage({
    page: "idea-new",
    step,
    status: done ? "RECEIVED" : "DRAFT",
    mapEditing,
    saving: busy || restoring,
    navigationBlocked: !done && (dirty || mapEditing || busy || restoring),
    errorCode: error?.detail?.code ?? (Object.keys(fieldErrors).length ? "VALIDATION_ERROR" : undefined),
    targets: done ? [] : ["idea-draft-save", ...(step === 1
      ? ["idea-problem", "idea-solution"]
      : step === 2
        ? ["idea-territory", "idea-location-map", "idea-materials"]
        : ["idea-review"])],
  });

  useEffect(() => {
    let active = true;
    store
      .catalogs()
      .then(({ data: c }) => { if (active) setCatalog(c as Catalog); })
      .catch((err) => { if (active) setError(err as ApiError); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const identityChanged = queryDraft.current !== draftId;
    queryDraft.current = draftId;
    // rememberDraft marks our own freshly saved ID before updating the URL.
    // Other identity changes represent a different idea, not a save response.
    if (identityChanged && !(draftId && restoredDraft.current === draftId)) {
      restoredDraft.current = null;
      setStep(1);
      setId(draftId);
      setVersion(null);
      setData(emptyDraft());
      setFiles([]);
      setDone(null);
      setSavedAt(null);
      setDirty(false);
      setError(null);
      setFieldErrors({});
      setKey(api.key());
      setIntentKey(null);
      setBusy(false);
      setMapEditing(false);
      setRestoring(Boolean(draftId));
    }
    if (draftId && restoredDraft.current !== draftId) {
      let active = true;
      setRestoring(true);
      store
        .get(draftId)
        .then((res) => {
          if (!active) return;
          restoredDraft.current = draftId;
          const data = res.data as Record<string, unknown>;
          setData({
            title: (data.title as string) ?? "",
            problem: (data.problem as string) ?? "",
            solution: (data.solution as string) ?? "",
            expectedBenefit: (data.expectedBenefit as string) ?? "",
            territoryId:
              (data.territoryId as string) ??
              (data.territoryCode as string) ??
              "",
            locationText: (data.locationText as string) ?? "",
            locationGeometry:
              (data.locationGeometry as LocationGeometry) ?? null,
            requested: ((data.requestedCategoryCode as string) ??
              "AUTO") as string,
          });
          setVersion(data.version as number);
          setFiles(
            (
              (data.attachments ?? []) as Array<{
                id: string;
                originalName: string;
                sizeBytes: number;
              }>
            ).map((f) => ({
              name: f.originalName,
              size: f.sizeBytes,
              status: "Загружен на сервер",
              attachmentId: f.id,
            })),
          );
          setSavedAt((data.updatedAt as string) ?? new Date().toISOString());
        })
        .catch((err) => { if (active) setError(err as ApiError); })
        .finally(() => { if (active) setRestoring(false); });
      return () => { active = false; };
    }
  }, [draftId]);

  const set =
    (k: keyof DraftData) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      setDirty(true);
      setData((d) => ({ ...d, [k]: e.target.value }));
    };
  const markSaved = () => {
    setDirty(false);
    setSavedAt(new Date().toISOString());
  };
  const rememberDraft = (draft: string) => {
    restoredDraft.current = draft;
    setId(draft);
    router.replace(`/ideas/new?draft=${draft}${returnQuery}`, { scroll: false });
  };
  const refreshVersion = async () => {
    if (!id || busy || restoring || mapEditing) return;
    setBusy(true);
    try {
      const { data: fresh } = await store.get(id);
      setVersion((fresh as { version: number }).version);
      const attachments =
        (
          fresh as {
            attachments?: Array<{
              id: string;
              originalName: string;
              sizeBytes: number;
            }>;
          }
        ).attachments ?? [];
      setFiles((previous) => [
        ...attachments.map((f) => ({
          name: f.originalName,
          size: f.sizeBytes,
          status: "Загружен на сервер",
          attachmentId: f.id,
        })),
        ...previous.filter((f) => !f.attachmentId),
      ]);
      setError(null);
      setFieldErrors({});
      setIntentKey(null);
      setDirty(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = async () => {
    if (busy || restoring || mapEditing) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const payload = {
      title: data.title,
      problem: data.problem,
      solution: data.solution,
      expectedBenefit: data.expectedBenefit,
      locationText: data.locationText,
      locationGeometry: data.locationGeometry,
      requestedCategoryCode: data.requested === "AUTO" ? null : data.requested,
      ...(data.territoryId ? { territoryId: data.territoryId } : {}),
    };
    try {
      const { data: result } = id
        ? await store.patchDraft(id, { ...payload, expectedVersion: version })
        : await store.createDraft(payload, key);
      const draft = result as { id: string; version: number };
      if (!id) rememberDraft(draft.id);
      setVersion(draft.version);
      markSaved();
    } catch (err) {
      fail(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const fail = (err: ApiError) => {
    setError(err);
    setFieldErrors(err.detail?.fields ?? {});
    focusFirstInvalid();
  };

  const focusFirstInvalid = () => {
    requestAnimationFrame(() => {
      const t = document.querySelector(
        "[aria-invalid='true']",
      ) as HTMLElement | null;
      if (t) {
        t.scrollIntoView({ block: "center" });
        t.focus();
      }
    });
  };

  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const saveStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || restoring || mapEditing) return;
    setError(null);
    setFieldErrors({});
    const fe: Record<string, string> = {};
    if ([...data.title.trim()].length < 10)
      fe.title = "Название короче 10 символов";
    if ([...data.problem.trim()].length < 30)
      fe.problem = "Нужно минимум 30 символов — опишите подробнее";
    if ([...data.solution.trim()].length < 30)
      fe.solution = "Нужно минимум 30 символов — опишите подробнее";
    if (Object.keys(fe).length) {
      setFieldErrors(fe);
      focusFirstInvalid();
      return;
    }
    setBusy(true);
    try {
      if (!id) {
        const { data: r } = await store.createDraft(
          {
            title: data.title,
            problem: data.problem,
            solution: data.solution,
            expectedBenefit: data.expectedBenefit,
            locationText: data.locationText,
            locationGeometry: data.locationGeometry,
            requestedCategoryCode:
              data.requested === "AUTO" ? null : data.requested,
            ...(data.territoryId ? { territoryId: data.territoryId } : {}),
          },
          key,
        );
        rememberDraft((r as { id: string }).id);
        setVersion((r as { version: number }).version);
      } else {
        const { data: r } = await store.patchDraft(id, {
          title: data.title,
          problem: data.problem,
          solution: data.solution,
          expectedBenefit: data.expectedBenefit,
          locationText: data.locationText,
          locationGeometry: data.locationGeometry,
          requestedCategoryCode:
            data.requested === "AUTO" ? null : data.requested,
          ...(data.territoryId ? { territoryId: data.territoryId } : {}),
          expectedVersion: version,
        });
        setVersion((r as { version: number }).version);
      }
      markSaved();
      setStep(2);
    } catch (err) {
      fail(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const saveStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || restoring || mapEditing) return;
    if (!data.territoryId) {
      setFieldErrors({ territoryId: "Выберите территорию из справочника" });
      focusFirstInvalid();
      return;
    }
    if (!id || version === null) return;
    setBusy(true);
    setError(null);
    try {
      const { data: r } = await store.patchDraft(id, {
        title: data.title,
        problem: data.problem,
        solution: data.solution,
        expectedBenefit: data.expectedBenefit,
        territoryId: data.territoryId,
        locationText: data.locationText,
        locationGeometry: data.locationGeometry,
        requestedCategoryCode:
          data.requested === "AUTO" ? null : data.requested,
        expectedVersion: version,
      });
      setVersion((r as { version: number }).version);
      markSaved();
      setStep(3);
    } catch (err) {
      fail(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async (list: FileList | File[]) => {
    if (!id || version === null || busy || restoring || mapEditing) return;
    setBusy(true);
    let uploadVersion = version;
    let activeFiles = files.filter((f) => f.attachmentId).length;
    try {
      for (const f of Array.from(list)) {
        if (activeFiles >= 3) {
          setError(
            new ApiError({
              http: 400,
              code: "VALIDATION_ERROR",
              message: "Максимум 3 активных файла",
              fields: {},
            }),
          );
          break;
        }
        const row = { name: f.name, size: f.size, status: "Загрузка…" };
        setFiles((prev) => [...prev, row]);
        try {
          const { data: r } = await store.attach(
            id,
            f,
            uploadVersion,
            api.key(),
          );
          const rr = r as { attachment: { id: string }; ideaVersion: number };
          setVersion(rr.ideaVersion);
          uploadVersion = rr.ideaVersion;
          activeFiles++;
          setFiles((prev) =>
            prev.map((x) =>
              x === row
                ? {
                    ...x,
                    status: "Загружен на сервер",
                    attachmentId: rr.attachment.id,
                  }
                : x,
            ),
          );
        } catch (err) {
          const d = (err as ApiError).detail;
          const msg =
            d?.code === "FILE_TOO_LARGE"
              ? "больше 5 MiB"
              : d?.code === "UNSUPPORTED_FILE_TYPE"
                ? "тип не поддерживается"
                : "не загрузился";
          setFiles((prev) =>
            prev.map((x) =>
              x === row ? { ...x, status: `Ошибка: ${msg}` } : x,
            ),
          );
          if (d?.code === "VERSION_CONFLICT") {
            fail(err as ApiError);
            break;
          }
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || restoring || mapEditing) return;
    const consent = (
      document.getElementById("consent") as HTMLInputElement | null
    )?.checked;
    if (!consent) {
      setError(
        new ApiError({
          http: 400,
          code: "VALIDATION_ERROR",
          message: "Отметьте согласие перед отправкой",
          fields: {},
        }),
      );
      return;
    }
    if (!id || version === null) return;
    setBusy(true);
    setError(null);
    const ikey = intentKey ?? api.key();
    if (!intentKey) setIntentKey(ikey);
    try {
      // After a conflict refresh the review still contains the resident's local
      // input. Save that full snapshot before registering the server draft.
      let submitVersion = version;
      if (dirty) {
        const { data: saved } = await store.patchDraft(id, {
          title: data.title,
          problem: data.problem,
          solution: data.solution,
          expectedBenefit: data.expectedBenefit,
          territoryId: data.territoryId,
          locationText: data.locationText,
          locationGeometry: data.locationGeometry,
          requestedCategoryCode:
            data.requested === "AUTO" ? null : data.requested,
          expectedVersion: version,
        });
        submitVersion = (saved as { version: number }).version;
        setVersion(submitVersion);
        markSaved();
      }
      const { data: r } = await store.submit(
        id,
        { expectedVersion: submitVersion, consentAccepted: true },
        ikey,
      );
      const d = r as {
        publicNumber: string;
        routing: RoutingDecision;
        id: string;
        version: number;
      };
      setVersion(d.version);
      setDone({ publicNumber: d.publicNumber, routing: d.routing, id: d.id });
    } catch (err) {
      if ((err as ApiError).detail?.code === "VERSION_CONFLICT")
        setIntentKey(api.key());
      fail(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const selectedTerritory = catalog?.territories.find(
    (t) => territoryValue(t) === data.territoryId,
  );
  const previewInput: PreviewInput = {
    title: data.title,
    problem: data.problem,
    solution: data.solution,
    requestedCategoryCode: (data.requested === "AUTO"
      ? null
      : data.requested) as PreviewInput["requestedCategoryCode"],
    territoryCode: selectedTerritory?.code ?? data.territoryId ?? "DEMO_SEMEY",
  };
  const mockMode = useMock();
  const mockPreview =
    mockMode && data.title && data.problem && data.solution
      ? previewRoute(previewInput)
      : null;
  const serverPreview = useRoutingPreview(mockMode ? null : serverPreviewInput(data, catalog),
    !mockMode && step === 3 && !done && !restoring);
  const preview = mockMode ? mockPreview : serverPreview.route;

  return (
    <div className="narrow">
      <Link className="back-link" href={returnTo}>{tr(returnLabel)}</Link>
      <div className="card">
        <p className="eyebrow">{tr("КАБИНЕТ ЖИТЕЛЯ / НОВОЕ ПРЕДЛОЖЕНИЕ")}</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {tr(" Новая идея ")}</h1>
        <ol className="steps" aria-label={tr("Шаги подачи")}>
          <li aria-current={step === 1 ? "step" : undefined}>
            {tr(" 1. Проблема и решение ")}</li>
          <li aria-current={step === 2 ? "step" : undefined}>
            {tr(" 2. Место и материалы ")}</li>
          <li aria-current={step === 3 ? "step" : undefined}>
            {tr(" 3. Проверка и отправка ")}</li>
        </ol>
        {error && <ErrorNotice error={error} id="send-error" />}
        {error?.detail?.code === "VERSION_CONFLICT" && (
          <div className="notice warn">
            <p>
              {tr(" Черновик изменился в другой вкладке. Ваш текст и выбранное место остаются в форме. Обновите версию, проверьте данные и сохраните снова. ")}</p>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || restoring || mapEditing}
              onClick={refreshVersion}
            >
              {tr(" Обновить версию, сохранить ввод ")}</button>
          </div>
        )}
        {!done && (
          <div className="draft-toolbar" data-assistant-target="idea-draft-save">
            <span role="status">
              {restoring
                ? tr("Восстанавливаем черновик…")
                : savedAt
                  ? dirty
                    ? tr("Есть несохранённые изменения")
                    : tr("Сохранено в черновике · {0}", { "0": new Date(savedAt).toLocaleTimeString(intlLocale, { hour: "2-digit", minute: "2-digit" }) })
                  : tr("Черновик ещё не сохранён")}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy || restoring || mapEditing}
              onClick={saveDraft}
            >
              <Icon name="file" size={15} />
              {tr(" Сохранить черновик ")}</button>
          </div>
        )}
        {step === 1 && (
          <form onSubmit={saveStep1} noValidate>
            <fieldset disabled={busy || restoring}>
              <div className="field">
                <label htmlFor="title">{tr("Название идеи")}</label>
                <input
                  id="title"
                  type="text"
                  value={data.title}
                  onChange={set("title")}
                  aria-invalid={fieldErrors.title ? "true" : undefined}
                  aria-describedby={
                    fieldErrors.title ? "title-h title-e" : "title-h"
                  }
                />
                <p className="hint" id="title-h">
                  {tr(" 10–120 символов. Например: «Умные светофоры рядом со школой». ")}</p>
                {fieldErrors.title && (
                  <p className="field-error" id="title-e" role="alert">
                    {fieldErrors.title}
                  </p>
                )}
              </div>
              <div className="field" data-assistant-target="idea-problem">
                <label htmlFor="problem">{tr("Что сейчас неудобно? (проблема)")}</label>
                <textarea
                  id="problem"
                  value={data.problem}
                  onChange={set("problem")}
                  aria-invalid={fieldErrors.problem ? "true" : undefined}
                  aria-describedby={
                    fieldErrors.problem ? "problem-h problem-e" : "problem-h"
                  }
                />
                <p className="hint" id="problem-h">
                  {tr(" Минимум 30 символов. Опишите проблему, а не решение. ")}</p>
                {fieldErrors.problem && (
                  <p className="field-error" id="problem-e" role="alert">
                    {fieldErrors.problem}
                  </p>
                )}
              </div>
              <div className="field" data-assistant-target="idea-solution">
                <label htmlFor="solution">
                  {tr(" Что предлагаете изменить? (решение) ")}</label>
                <textarea
                  id="solution"
                  value={data.solution}
                  onChange={set("solution")}
                  aria-invalid={fieldErrors.solution ? "true" : undefined}
                  aria-describedby={
                    fieldErrors.solution
                      ? "solution-h solution-e"
                      : "solution-h"
                  }
                />
                <p className="hint" id="solution-h">
                  {tr(" Минимум 30 символов. ")}</p>
                {fieldErrors.solution && (
                  <p className="field-error" id="solution-e" role="alert">
                    {fieldErrors.solution}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="benefit">
                  {tr(" Ожидаемая польза (необязательно) ")}</label>
                <textarea
                  id="benefit"
                  rows={2}
                  value={data.expectedBenefit}
                  onChange={set("expectedBenefit")}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy || mapEditing}>
                {busy ? tr("Сохраняем…") : tr("Далее")}
              </button>
            </fieldset>
          </form>
        )}
        {step === 2 && (
          <form onSubmit={saveStep2} noValidate>
            <fieldset disabled={busy || restoring}>
              <div className="field" data-assistant-target="idea-territory">
                <label htmlFor="territory">{tr("Населённый пункт / территория")}</label>
                <input type="search" className="territory-search" value={territorySearch} onChange={event=>setTerritorySearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} aria-label={tr('Поиск населённого пункта')} placeholder={tr('Найти по названию или району')} autoComplete="off" />
                <select
                  id="territory"
                  value={data.territoryId}
                  onChange={set("territoryId")}
                  aria-invalid={fieldErrors.territoryId ? "true" : undefined}
                  aria-describedby={
                    fieldErrors.territoryId ? "terr-h terr-e" : "terr-h"
                  }
                >
                  <option value="">{tr("— выберите из справочника —")}</option>
                  <TerritoryOptions territories={catalog?.territories ?? []} selected={data.territoryId} search={territorySearch} />
                </select>
                <p className="hint" id="terr-h">
                  {tr(" Выберите территорию, к которой относится ваша идея. ")}</p>
                {fieldErrors.territoryId && (
                  <p className="field-error" id="terr-e" role="alert">
                    {fieldErrors.territoryId}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="location">{tr("Уточните место (необязательно)")}</label>
                <input
                  id="location"
                  type="text"
                  value={data.locationText}
                  onChange={set("locationText")}
                  maxLength={300}
                />
                <p className="hint">
                  {tr(" До 300 символов. Домашний адрес не требуется. ")}</p>
              </div>
              <div data-assistant-target="idea-location-map"><LocationMap
                value={data.locationGeometry}
                onEditingChange={setMapEditing}
                onChange={(geometry) => {
                  setData((d) => ({ ...d, locationGeometry: geometry }));
                  setDirty(true);
                }}
              /></div>
              {mapEditing && (
                <p className="notice warn" role="status">
                  {tr(" Подтвердите выделение на карте или отмените его перед сохранением и переходом к другому шагу. ")}</p>
              )}
              {fieldErrors.locationGeometry && (
                <p className="field-error" role="alert">
                  {fieldErrors.locationGeometry}
                </p>
              )}
              <div className="field">
                <label htmlFor="category">{tr("Категория")}</label>
                <select
                  id="category"
                  value={data.requested}
                  onChange={set("requested")}
                >
                  <option value="AUTO">{tr("Определить автоматически")}</option>
                  {catalog?.categories.map((c) => (
                    <option key={c} value={c}>
                      {tr(CATEGORIES[c] ?? c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" data-assistant-target="idea-materials">
                <label htmlFor="files">{tr("Материалы")}</label>
                <p className="hint">
                  {tr(ru.fileLimits)} {tr(" Добавьте фото места или документ, который поможет понять идею. ")}</p>
                <label className="upload-drop" htmlFor="files"><Icon name="file" size={27}/><span><strong>{tr("Добавить фото или документ")}</strong><small>{tr("Выберите до 3 файлов")}</small></span></label>
                <input
                  id="files"
                  type="file"
                  className="sr-only"
                  multiple
                  disabled={busy || mapEditing}
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files ?? []);
                    e.currentTarget.value = "";
                    void addFiles(selected);
                  }}
                />
                <div aria-live="polite">
                  {files.map((f, i) => (
                    <div key={i} className="file-row">
                      <span>
                        {f.name} · {(f.size / 1024).toFixed(0)} {tr(" КБ · ")}{f.status}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || mapEditing}
                        onClick={async () => {
                          if (busy || restoring || mapEditing) return;
                          setBusy(true);
                          setError(null);
                          try {
                            if (f.attachmentId && id && version !== null) {
                              const { data: r } = await store.deleteAttachment(
                                id,
                                f.attachmentId,
                                version,
                                api.key(),
                              );
                              // Настоящий B отвечает {ideaVersion} (C-04 real DTO).
                              const nv = (r as { ideaVersion?: number })
                                .ideaVersion;
                              if (typeof nv === "number") setVersion(nv);
                            }
                            setFiles((prev) => prev.filter((x) => x !== f));
                          } catch (err) {
                            fail(err as ApiError);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {tr(" Убрать ")}</button>
                    </div>
                  ))}
                  <p className="muted">
                    {tr(" Осталось мест:")}{" "}
                    {Math.max(
                      0,
                      3 - files.filter((f) => f.attachmentId).length,
                    )}
                    .
                  </p>
                </div>
              </div>
              {mockMode && preview && (
                <InfoNotice>
                  {tr(" Предварительное направление:")}{" "}
                  <strong>{tr(CATEGORIES[preview.effectiveCategoryCode])}</strong> ·{" "}
                  {preview.confidenceBand === "HIGH"
                    ? tr("определено уверенно")
                    : preview.confidenceBand === "MEDIUM"
                      ? tr("стоит проверить")
                      : tr("нужен специалист")}
                  {preview.mode === "TRIAGE" ? ` · ${tr(ru.triageExplain)}` : ""}
                </InfoNotice>
              )}
              {!mockMode && <p className="hint">{tr("Предварительное направление появится на шаге проверки перед отправкой.")}</p>}
              <p className="btn-row">
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy || restoring || mapEditing}
                  onClick={() => {
                    if (!busy && !restoring && !mapEditing) setStep(1);
                  }}
                >
                  {tr(" Назад ")}</button>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={busy || mapEditing}
                >
                  {busy ? tr("Сохраняем…") : tr("Далее")}
                </button>
              </p>
            </fieldset>
          </form>
        )}
        {step === 3 && !done && (
          <div data-assistant-target="idea-review">
            <h2>{tr("Проверка перед отправкой")}</h2>
            <dl>
              <dt>
                <strong>{tr("Название")}</strong>
              </dt>
              <dd>{data.title}</dd>
              <dt>
                <strong>{tr("Проблема")}</strong>
              </dt>
              <dd>{data.problem}</dd>
              <dt>
                <strong>{tr("Решение")}</strong>
              </dt>
              <dd>{data.solution}</dd>
              <dt>
                <strong>{tr("Территория")}</strong>
              </dt>
              <dd>{selectedTerritory ? territoryDisplayName(selectedTerritory,locale) : data.territoryId}</dd>
              <dt>
                <strong>{tr("Категория")}</strong>
              </dt>
              <dd>
                {data.requested === "AUTO"
                  ? tr("Определить автоматически")
                  : (CATEGORIES[data.requested] ?? "")}
              </dd>
            </dl>
            <section className="review-location">
              <h3>{tr("Место и материалы")}</h3>
              <p>{data.locationText || tr("Точное место не уточнено")}</p>
              {data.locationGeometry && (
                <LocationMap
                  value={data.locationGeometry}
                  readOnly
                  title={tr("Выбранное место")}
                />
              )}
              <ul>
                {files
                  .filter((f) => f.attachmentId)
                  .map((f) => (
                    <li key={f.attachmentId}>
                      {f.name} · {(f.size / 1024).toFixed(0)} {tr(" КБ ")}</li>
                  ))}
              </ul>
              {!files.some((f) => f.attachmentId) && (
                <p className="muted">{tr("Материалы не добавлены.")}</p>
              )}
            </section>
            <div aria-live="polite" aria-busy={!mockMode && serverPreview.status === "waiting"}>
              {preview && <RouteCard route={preview} />}
              {!mockMode && serverPreview.status === "waiting" && <InfoNotice>{tr("Определяем предварительное направление… Можно отправить идею, не дожидаясь подсказки.")}</InfoNotice>}
              {!mockMode && serverPreview.status === "incomplete" && <InfoNotice>{tr("Для подсказки заполните название, проблему и решение и выберите территорию из справочника.")}</InfoNotice>}
              {!mockMode && serverPreview.status === "unavailable" && <InfoNotice>{tr("Предварительная подсказка сейчас недоступна. Заполненные поля остаются в форме; можно отправить идею.")}</InfoNotice>}
            </div>
            <form onSubmit={submit}>
              <fieldset disabled={busy}>
                <div className="field">
                  <label htmlFor="consent" className="check-row">
                    <input
                      id="consent"
                      type="checkbox"
                      aria-describedby={error ? "send-error" : undefined}
                    />
                    <span>
                      {tr("Подтверждаю отправку идеи на рассмотрение и обработку данных в демо-сервисе.")}</span>
                  </label>
                </div>
                <p className="btn-row">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy || restoring || mapEditing}
                    onClick={() => {
                      if (!busy && !restoring && !mapEditing) setStep(2);
                    }}
                  >
                    {tr(" Назад ")}</button>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy || mapEditing}
                  >
                    {busy ? ru.sending : tr("Отправить идею")}
                  </button>
                </p>
              </fieldset>
            </form>
          </div>
        )}
        {done && (
          <>
          <div className="notice" role="status">
            <strong>
              {tr(" Идея зарегистрирована на платформе. Номер ")}{done.publicNumber}.
            </strong>
            <br />
            {tr(" Статус: Получена · Направление:")}{" "}
            {tr(CATEGORIES[done.routing.effectiveCategoryCode])}.{" "}
            {done.routing.explanation}
            {done.routing.mode === "TRIAGE" && (
              <>
                <br />
                {tr(ru.triageExplain)}
              </>
            )}
            <br />
            <Link className="btn btn-primary btn-sm" href={`/ideas/${done.id}${returnTo === "/my" ? "" : `?returnTo=${encodeURIComponent(returnTo)}`}`}>
              {tr(" Открыть идею ")}</Link>
          </div>
          <section className="idea-publication-next" aria-labelledby="publication-next-title">
            <h2 id="publication-next-title">{tr("Хотите показать идею жителям?")}</h2>
            <p>{tr("Отправка заявки и публикация — разные шаги. Ниже можно подготовить отдельную карточку для «Идей региона». Она появится на витрине после вашего согласия и проверки сотрудником.")}</p>
            <PublicationPanel ideaId={done.id} source={{ title: data.title, problem: data.problem, solution: data.solution, expectedBenefit: data.expectedBenefit }} initialOpen />
          </section>
          </>
        )}
      </div>
    </div>
  );
}

export default function NewIdeaPage() {
  const ru = useUiMessages();
  const { user, checked } = useSessionRedirect();
  if (!checked || user?.role !== "CITIZEN") return null;
  return (
    <Suspense>
      <Wizard />
    </Suspense>
  );
}

function useSessionRedirect() {
  const router = useRouter();
  const s = useSession();
  useEffect(() => {
    if (!s.checked) return;
    if (!s.user) {
      router.replace(loginHref(window.location.pathname + window.location.search + window.location.hash));
    } else if (s.user.role !== "CITIZEN") {
      router.replace("/staff");
    }
  }, [s.checked, s.user, router]);
  return s;
}
