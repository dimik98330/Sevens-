"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/features/shared/api-client";
import { resolveTerritoryId, store } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { ErrorNotice, InfoNotice } from "@/components/ui/Feedback";
import { previewRoute } from "@/features/shared/route-preview";
import type { PreviewInput } from "@/features/shared/route-preview";
import type { RoutingDecision } from "@/domain/routing/types";
import ru from "@/locales/ru.json";

interface DraftData {
  title: string;
  problem: string;
  solution: string;
  expectedBenefit: string;
  territoryId: string;
  locationText: string;
  requested: string; // AUTO или код
}

interface Catalog {
  categories: string[];
  territories: Array<{ id?: string; code: string; nameRu: string }>;
}

// B принимает territoryId UUID из catalogs[].id (d37aeab); правило — в фасаде данных.
const territoryValue = resolveTerritoryId;

const CATEGORIES = ru.categories as Record<string, string>;

function Wizard() {
  const router = useRouter();
  const params = useSearchParams();
  const draftId = params.get("draft");
  const [step, setStep] = useState(1);
  const [id, setId] = useState<string | null>(draftId);
  const [version, setVersion] = useState<number | null>(null);
  const [data, setData] = useState<DraftData>({
    title: "",
    problem: "",
    solution: "",
    expectedBenefit: "",
    territoryId: "",
    locationText: "",
    requested: "AUTO",
  });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [key] = useState(() => api.key());
  const [intentKey, setIntentKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Array<{ name: string; size: number; status: string; attachmentId?: string }>>([]);
  const [done, setDone] = useState<{ publicNumber: string; routing: RoutingDecision; id: string } | null>(null);

  useEffect(() => {
    store.catalogs().then(({ data: c }) => setCatalog(c as Catalog)).catch(() => {});
    if (draftId) {
      store
        .get(draftId)
        .then((res) => {
          const data = res.data as Record<string, unknown>;
          setData({
            title: (data.title as string) ?? "",
            problem: (data.problem as string) ?? "",
            solution: (data.solution as string) ?? "",
            expectedBenefit: (data.expectedBenefit as string) ?? "",
            territoryId: (data.territoryId as string) ?? (data.territoryCode as string) ?? "",
            locationText: (data.locationText as string) ?? "",
            requested: ((data.requestedCategoryCode as string) ?? "AUTO") as string,
          });
          setVersion(data.version as number);
        })
        .catch((err) => setError(err as ApiError));
    }
  }, [draftId]);

  const set = (k: keyof DraftData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setData((d) => ({ ...d, [k]: e.target.value }));

  const fail = (err: ApiError) => {
    setError(err);
    setFieldErrors(err.detail?.fields ?? {});
    focusFirstInvalid();
  };

  const focusFirstInvalid = () => {
    requestAnimationFrame(() => {
      const t = document.querySelector("[aria-invalid='true']") as HTMLElement | null;
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
    setError(null);
    setFieldErrors({});
    const fe: Record<string, string> = {};
    if ([...data.title.trim()].length < 10) fe.title = "Название короче 10 символов";
    if ([...data.problem.trim()].length < 30) fe.problem = "Нужно минимум 30 символов — опишите подробнее";
    if ([...data.solution.trim()].length < 30) fe.solution = "Нужно минимум 30 символов — опишите подробнее";
    if (Object.keys(fe).length) {
      setFieldErrors(fe);
      focusFirstInvalid();
      return;
    }
    setBusy(true);
    try {
      if (!id) {
        const { data: r } = await store.createDraft(
          { title: data.title, problem: data.problem, solution: data.solution, expectedBenefit: data.expectedBenefit },
          key,
        );
        setId((r as { id: string }).id);
        setVersion((r as { version: number }).version);
      } else {
        const { data: r } = await store.patchDraft(id, {
          title: data.title,
          problem: data.problem,
          solution: data.solution,
          expectedBenefit: data.expectedBenefit,
          expectedVersion: version,
        });
        setVersion((r as { version: number }).version);
      }
      setStep(2);
    } catch (err) {
      fail(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const saveStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
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
        territoryId: data.territoryId,
        locationText: data.locationText,
        requestedCategoryCode: data.requested === "AUTO" ? null : data.requested,
        expectedVersion: version,
      });
      setVersion((r as { version: number }).version);
      setStep(3);
    } catch (err) {
      fail(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async (list: FileList | File[]) => {
    if (!id || version === null) return;
    for (const f of Array.from(list)) {
      if (files.length >= 3) {
        setError(new ApiError({ http: 400, code: "VALIDATION_ERROR", message: "Максимум 3 активных файла", fields: {} }));
        break;
      }
      const row = { name: f.name, size: f.size, status: "Загрузка…" };
      setFiles((prev) => [...prev, row]);
      try {
        const { data: r } = await store.attach(id, f, version, api.key());
        const rr = r as { attachment: { id: string }; ideaVersion: number };
        setVersion(rr.ideaVersion);
        setFiles((prev) => prev.map((x) => (x === row ? { ...x, status: "Загружен на сервер", attachmentId: rr.attachment.id } : x)));
      } catch (err) {
        const d = (err as ApiError).detail;
        const msg =
          d?.code === "FILE_TOO_LARGE"
            ? "больше 5 MiB"
            : d?.code === "UNSUPPORTED_FILE_TYPE"
              ? "тип не поддерживается"
              : "не загрузился";
        setFiles((prev) => prev.map((x) => (x === row ? { ...x, status: `Ошибка: ${msg}` } : x)));
      }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const consent = (document.getElementById("consent") as HTMLInputElement | null)?.checked;
    if (!consent) {
      setError(new ApiError({ http: 400, code: "VALIDATION_ERROR", message: "Отметьте согласие перед отправкой", fields: {} }));
      return;
    }
    if (!id || version === null) return;
    setBusy(true);
    setError(null);
    const ikey = intentKey ?? api.key();
    if (!intentKey) setIntentKey(ikey);
    try {
      const { data: r } = await store.submit(id, { expectedVersion: version, consentAccepted: true }, ikey);
      const d = r as { publicNumber: string; routing: RoutingDecision; id: string; version: number };
      setVersion(d.version);
      setDone({ publicNumber: d.publicNumber, routing: d.routing, id: d.id });
    } catch (err) {
      if ((err as ApiError).detail?.code === "VERSION_CONFLICT") setIntentKey(api.key());
      fail(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const selectedTerritory = catalog?.territories.find((t) => territoryValue(t) === data.territoryId);
  const previewInput: PreviewInput = {
    title: data.title,
    problem: data.problem,
    solution: data.solution,
    requestedCategoryCode: (data.requested === "AUTO" ? null : data.requested) as PreviewInput["requestedCategoryCode"],
    territoryCode: selectedTerritory?.code ?? data.territoryId ?? "DEMO_SEMEY",
  };
  const preview = data.title && data.problem && data.solution ? previewRoute(previewInput) : null;

  return (
    <div className="narrow">
      <div className="card">
        <h1 ref={headingRef} tabIndex={-1}>
          Новая идея
        </h1>
        <ol className="steps" aria-label="Шаги подачи">
          <li aria-current={step === 1 ? "step" : undefined}>1. Что предлагаете</li>
          <li aria-current={step === 2 ? "step" : undefined}>2. Где и направление</li>
          <li aria-current={step === 3 ? "step" : undefined}>3. Проверка и отправка</li>
        </ol>
        {error && <ErrorNotice error={error} id="send-error" />}
        {step === 1 && (
          <form onSubmit={saveStep1} noValidate>
            <div className="field">
              <label htmlFor="title">Название идеи</label>
              <input
                id="title"
                type="text"
                value={data.title}
                onChange={set("title")}
                aria-invalid={fieldErrors.title ? "true" : undefined}
                aria-describedby={fieldErrors.title ? "title-h title-e" : "title-h"}
              />
              <p className="hint" id="title-h">
                10–120 символов. Например: «Умные светофоры рядом со школой».
              </p>
              {fieldErrors.title && (
                <p className="field-error" id="title-e" role="alert">
                  {fieldErrors.title}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="problem">Что сейчас неудобно? (проблема)</label>
              <textarea
                id="problem"
                value={data.problem}
                onChange={set("problem")}
                aria-invalid={fieldErrors.problem ? "true" : undefined}
                aria-describedby={fieldErrors.problem ? "problem-h problem-e" : "problem-h"}
              />
              <p className="hint" id="problem-h">
                Минимум 30 символов. Опишите проблему, а не решение.
              </p>
              {fieldErrors.problem && (
                <p className="field-error" id="problem-e" role="alert">
                  {fieldErrors.problem}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="solution">Как цифровая технология может помочь? (решение)</label>
              <textarea
                id="solution"
                value={data.solution}
                onChange={set("solution")}
                aria-invalid={fieldErrors.solution ? "true" : undefined}
                aria-describedby={fieldErrors.solution ? "solution-h solution-e" : "solution-h"}
              />
              <p className="hint" id="solution-h">
                Минимум 30 символов.
              </p>
              {fieldErrors.solution && (
                <p className="field-error" id="solution-e" role="alert">
                  {fieldErrors.solution}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="benefit">Ожидаемая польза (необязательно)</label>
              <textarea id="benefit" rows={2} value={data.expectedBenefit} onChange={set("expectedBenefit")} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Сохраняем…" : "Далее"}
            </button>
          </form>
        )}
        {step === 2 && (
          <form onSubmit={saveStep2} noValidate>
            <div className="field">
              <label htmlFor="territory">Населённый пункт / территория</label>
              <select
                id="territory"
                value={data.territoryId}
                onChange={set("territoryId")}
                aria-invalid={fieldErrors.territoryId ? "true" : undefined}
                aria-describedby={fieldErrors.territoryId ? "terr-h terr-e" : "terr-h"}
              >
                <option value="">— выберите из справочника —</option>
                {catalog?.territories.map((t) => (
                  <option key={t.code} value={territoryValue(t)}>
                    {t.nameRu}
                  </option>
                ))}
              </select>
              <p className="hint" id="terr-h">
                Справочник, а не карта.
              </p>
              {fieldErrors.territoryId && (
                <p className="field-error" id="terr-e" role="alert">
                  {fieldErrors.territoryId}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="location">Место подробнее (необязательно)</label>
              <input id="location" type="text" value={data.locationText} onChange={set("locationText")} maxLength={320} />
              <p className="hint">До 300 символов. Домашний адрес не требуется.</p>
            </div>
            <div className="field">
              <label htmlFor="category">Категория</label>
              <select id="category" value={data.requested} onChange={set("requested")}>
                <option value="AUTO">Определить автоматически</option>
                {catalog?.categories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c] ?? c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="files">Материалы</label>
              <p className="hint">{ru.fileLimits} Файл привязывается к серверной идее после создания черновика.</p>
              <input
                id="files"
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
              <div aria-live="polite">
                {files.map((f, i) => (
                  <div key={i} className="file-row">
                    <span>
                      {f.name} · {(f.size / 1024).toFixed(0)} КБ · {f.status}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        if (f.attachmentId && id && version !== null) {
                          try {
                            const { data: r } = await store.deleteAttachment(id, f.attachmentId, version, api.key());
                            // Настоящий B отвечает {ideaVersion} (C-04 real DTO).
                            const nv = (r as { ideaVersion?: number }).ideaVersion;
                            if (typeof nv === "number") setVersion(nv);
                          } catch (err) {
                            setError(err as ApiError);
                            return;
                          }
                        }
                        setFiles((prev) => prev.filter((x) => x !== f));
                      }}
                    >
                      Убрать
                    </button>
                  </div>
                ))}
                <p className="muted">Осталось мест: {3 - files.length}.</p>
              </div>
            </div>
            {preview && (
              <InfoNotice>
                Предпросмотр маршрута (правила, не решение):{" "}
                <strong>{CATEGORIES[preview.effectiveCategoryCode]}</strong> ·{" "}
                {preview.confidenceBand === "HIGH" ? "определено уверенно" : preview.confidenceBand === "MEDIUM" ? "стоит проверить" : "нужен специалист"}
                {preview.mode === "TRIAGE" ? ` · ${ru.triageExplain}` : ""}
              </InfoNotice>
            )}
            <p className="btn-row">
              <button className="btn btn-secondary" type="button" onClick={() => setStep(1)}>
                Назад
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Сохраняем…" : "Далее"}
              </button>
            </p>
          </form>
        )}
        {step === 3 && !done && (
          <div>
            <h2>Проверка перед отправкой</h2>
            <dl>
              <dt>
                <strong>Название</strong>
              </dt>
              <dd>{data.title}</dd>
              <dt>
                <strong>Проблема</strong>
              </dt>
              <dd>{data.problem}</dd>
              <dt>
                <strong>Решение</strong>
              </dt>
              <dd>{data.solution}</dd>
              <dt>
                <strong>Территория</strong>
              </dt>
              <dd>{selectedTerritory?.nameRu ?? data.territoryId}</dd>
              <dt>
                <strong>Категория</strong>
              </dt>
              <dd>{data.requested === "AUTO" ? "Определить автоматически" : (CATEGORIES[data.requested] ?? "")}</dd>
            </dl>
            {preview && (
              <InfoNotice>
                Предполагаемый маршрут: <strong>{CATEGORIES[preview.effectiveCategoryCode]}</strong>. {preview.explanation}
              </InfoNotice>
            )}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="consent" className="check-row">
                  <input
                    id="consent"
                    type="checkbox"
                    aria-describedby={error ? "send-error" : undefined}
                  />
                  <span>
                    Подтверждаю отправку идеи (согласие на обработку в демо-сервисе). Публикация отдельно не
                    выполняется.
                  </span>
                </label>
              </div>
              <p className="btn-row">
                <button className="btn btn-secondary" type="button" onClick={() => setStep(2)}>
                  Назад
                </button>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? ru.sending : "Отправить идею"}
                </button>
              </p>
            </form>
          </div>
        )}
        {done && (
          <div className="notice" role="status">
            <strong>
              Идея зарегистрирована на платформе. Номер {done.publicNumber}.
            </strong>
            <br />
            Статус: Получена · Направление: {CATEGORIES[done.routing.effectiveCategoryCode]}. {done.routing.explanation}
            {done.routing.mode === "TRIAGE" && (
              <>
                <br />
                {ru.triageExplain}
              </>
            )}
            <br />
            <Link className="btn btn-primary btn-sm" href={`/ideas/${done.id}`}>
              Открыть идею
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NewIdeaPage() {
  const { user, checked } = useSessionRedirect();
  if (!checked || !user) return null;
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
    if (s.checked && !s.user) router.replace("/login");
  }, [s.checked, s.user, router]);
  return s;
}
