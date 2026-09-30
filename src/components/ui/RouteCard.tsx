"use client";
import type { ConfidenceBand, RoutingMode } from "@/contracts";
import { orgName } from "./StatusBadge";
import ru from "@/locales/ru.json";
import { useTranslation, useUiMessages } from "@/features/i18n/provider";

// Wording — опубликованная гарантия для C (INTERFACE.md §Guarantees),
// не дублирование движка D: HIGH → «определено уверенно» и т.д. Процентов нет.
function confidenceLabel(band: ConfidenceBand): string {
  if (band === "HIGH") return "определено уверенно";
  if (band === "MEDIUM") return "стоит проверить";
  return "нужен специалист";
}

export interface RouteInfo {
  source: "RULES" | "HUMAN";
  ruleVersion?: string;
  effectiveCategoryCode: string;
  detectedCategoryCode?: string | null;
  classificationSource?: "MODEL" | "RULES";
  classifierStatus?: "READY" | "FALLBACK";
  catalogVersion?: string;
  organizationCode: string;
  mode: RoutingMode;
  confidenceBand: ConfidenceBand;
  tags?: string[];
  explanation: string;
}

const CATEGORIES = ru.categories as Record<string, string>;

// Теги жителю — словами, без технических кодов (05 §11): категории по ru.json,
// SMART_CITY — «Умный город».
const TAG_LABELS: Record<string, string> = { ...CATEGORIES, SMART_CITY: "Умный город" };

// Узнаваемый элемент «Почему это направление?» (05 §11).
// Объяснение рендерится текстовым узлом; confidence — словами, не процентами.
export function RouteCard({ route, showHeading = true }: { route: RouteInfo | null | undefined; showHeading?: boolean }) {
  const ru = useUiMessages();
  const { t: tr, intlLocale } = useTranslation();
  if (!route) return null;
  const triage = route.mode === "TRIAGE";
  const hasDetection = route.source !== "HUMAN" && route.ruleVersion !== "rules-v1" && Object.hasOwn(route, "detectedCategoryCode");
  const detected = route.detectedCategoryCode;
  const differs = Boolean(detected && detected !== route.effectiveCategoryCode);
  return (
    <section className="route-card" aria-labelledby={showHeading ? "route-h" : undefined} aria-label={showHeading ? undefined : tr("Почему это направление?")}>
      {showHeading && <h3 id="route-h">{tr("Почему это направление?")}</h3>}
      <p>
        <strong>{tr("Категория заявки:")}</strong> {tr(CATEGORIES[route.effectiveCategoryCode] ?? route.effectiveCategoryCode)}
      </p>
      {hasDetection ? (
        <p><strong>{tr("Тема по тексту:")}</strong>{" "}
          {detected ? tr(CATEGORIES[detected] ?? detected) : tr("нужна оценка специалиста")}
          {detected && <> · <strong>{tr("Уверенность подсказки:")}</strong> {tr(confidenceLabel(route.confidenceBand))}</>}
        </p>
      ) : route.source === "HUMAN" ? <p>{tr("Маршрут уточнён специалистом.")}</p>
        : <p><strong>{tr("Классификация:")}</strong> {tr(confidenceLabel(route.confidenceBand))}</p>}
      {differs && <p>{route.source === "HUMAN"
        ? tr("Категория уточнена сотрудником. Подсказка относится к тексту идеи.")
        : tr("Категория заявки отличается от подсказки. Направление уточнит специалист.")}</p>}
      {route.classifierStatus === "FALLBACK" && <p className="muted">{tr("Сейчас подсказка построена по правилам. Специалист может уточнить тему.")}</p>}
      {route.tags && route.tags.length > 0 && (
        <p>
          <strong>{tr("Дополнительные темы:")}</strong>{" "}
          {route.tags.map((t) => (
            <span key={t} className="tag">
              {tr(TAG_LABELS[t] ?? t)}
            </span>
          ))}
        </p>
      )}
      <p>{route.source === "RULES" ? route.explanation.replace(/Демо:\s*/g, "") : route.explanation}</p>
      <p className="muted">
        {tr(" Направление: ")}<strong>{tr(orgName(route.organizationCode))}</strong>.{" "}
        {route.source === "RULES" ? tr("Определено автоматически. Специалист может уточнить направление.") : tr("Направление уточнено сотрудником.")}
        {triage ? tr(" Направление требует уточнения. Специалист рассмотрит идею.") : ""}
      </p>
    </section>
  );
}
