import type { ConfidenceBand, RoutingMode } from "@/contracts";
import ru from "@/locales/ru.json";

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
  organizationCode: string;
  mode: RoutingMode;
  confidenceBand: ConfidenceBand;
  tags?: string[];
  explanation: string;
}

const CATEGORIES = ru.categories as Record<string, string>;

// Узнаваемый элемент «Почему это направление?» (05 §11).
// Объяснение рендерится текстовым узлом; confidence — словами, не процентами.
export function RouteCard({ route }: { route: RouteInfo | null | undefined }) {
  if (!route) return null;
  const triage = route.mode === "TRIAGE";
  return (
    <section className="route-card" aria-labelledby="route-h">
      <h3 id="route-h">Почему это направление?</h3>
      <p>
        <strong>Основная тема:</strong> {CATEGORIES[route.effectiveCategoryCode] ?? route.effectiveCategoryCode} ·{" "}
        <strong>Уверенность правил:</strong> {confidenceLabel(route.confidenceBand)}
      </p>
      {route.tags && route.tags.length > 0 && (
        <p>
          <strong>Дополнительные темы:</strong>{" "}
          {route.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </p>
      )}
      <p>{route.explanation}</p>
      <p className="muted">
        Текущая демонстрационная очередь: {route.organizationCode} · источник:{" "}
        {route.source === "RULES" ? "Правила" : "Исправлено сотрудником"}
        {route.ruleVersion ? ` · версия ${route.ruleVersion}` : ""}.{triage ? ` ${ru.triageExplain}` : ""} Это
        учебное распределение, а не официальный канал органа.
      </p>
    </section>
  );
}
