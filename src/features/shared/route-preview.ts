// DEV-ONLY route preview для мастера подачи (C-02).
// Словарь и нормализация — D (read-only импорт листьев features/normalize:
// features.ts не имеет runtime-импортов, только `import type`, который стирается
// при сборке; normalize.ts без импортов вообще). Алгоритм выбора — текст 04 §4.
// Согласие с движком D проверено тестом c02 на routing-cases (vitest).
// Production-решение всегда приходит с сервера B (routeIdea); этот модуль
// уходит из production-сценария вместе с mock (03 §9).
import { CATEGORY_NAMES_RU, DIGITAL_MARKERS, FEATURES } from "@/domain/routing/features";
import { containsPhrase, normalizeText, tokenize } from "@/domain/routing/normalize";
import type { CategoryCode, ConfidenceBand, RoutingDecision, RoutingEvidence } from "@/domain/routing/types";
import { DEV_CATALOG } from "./mock";

const DIGITAL_SET = new Set<string>(DIGITAL_MARKERS);

export interface PreviewInput {
  title: string;
  problem: string;
  solution: string;
  requestedCategoryCode: CategoryCode | null; // null = AUTO; строка AUTO сюда не доходит
  territoryCode: string;
}

export function previewRoute(input: PreviewInput): RoutingDecision {
  const docs = [input.title, input.problem, input.solution].map((f) => {
    const normalized = normalizeText(f);
    return { tokens: tokenize(normalized) };
  });
  const tokenSet = new Set<string>();
  for (const doc of docs) for (const t of doc.tokens) tokenSet.add(t);

  const evidence: RoutingEvidence[] = [];
  const scores = new Map<CategoryCode, number>();
  for (const feature of FEATURES) {
    let hit = feature.tokens.some((a) => tokenSet.has(a));
    if (!hit) {
      for (const doc of docs) {
        if (feature.phrases.some((p) => containsPhrase(doc.tokens, p))) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      evidence.push({ featureId: feature.id, categoryCode: feature.category, weight: feature.weight });
      scores.set(feature.category, (scores.get(feature.category) ?? 0) + feature.weight);
    }
  }
  evidence.sort((a, b) => (a.featureId < b.featureId ? -1 : 1));

  let digitalFound = false;
  for (const t of tokenSet) {
    if (DIGITAL_SET.has(t)) {
      digitalFound = true;
      break;
    }
  }

  const ranked = [...scores.entries()]
    .map(([code, score]) => ({ code, score }))
    .sort((a, b) => b.score - a.score || (a.code < b.code ? -1 : 1));
  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const band: ConfidenceBand =
    (top?.score ?? 0) >= 3 && (top?.score ?? 0) - (second?.score ?? 0) >= 2
      ? "HIGH"
      : (top?.score ?? 0) >= 2
        ? "MEDIUM"
        : "LOW";

  const requested = input.requestedCategoryCode;
  const reasonCodes: string[] = [];
  if (!digitalFound) reasonCodes.push("DIGITAL_COMPONENT_NOT_CLEAR");

  const orgName = (code: string) => DEV_CATALOG.organizations.find((o) => o.code === code)?.name ?? code;
  const triageCode = DEV_CATALOG.organizations.find((o) => o.isTriage && o.active)?.code ?? "DEMO_TRIAGE";
  const orgFor = (cat: CategoryCode): string =>
    DEV_CATALOG.rules.find((r) => r.active && r.categoryCode === cat)?.organizationCode ?? triageCode;

  let effective: CategoryCode;
  let organizationCode: string;
  let mode: RoutingDecision["mode"];
  if (requested === null) {
    if (band === "HIGH" && top) {
      effective = top.code;
      organizationCode = orgFor(effective);
      mode = "ASSIGNED";
    } else {
      effective = "OTHER";
      organizationCode = triageCode;
      mode = "TRIAGE";
    }
  } else if (requested === "OTHER") {
    effective = "OTHER";
    organizationCode = triageCode;
    mode = "TRIAGE";
  } else if (band === "HIGH" && top && top.code !== requested) {
    effective = requested;
    organizationCode = triageCode;
    mode = "TRIAGE";
    reasonCodes.push("CATEGORY_CONFLICT");
  } else {
    effective = requested;
    organizationCode = orgFor(effective);
    mode = organizationCode === triageCode ? "TRIAGE" : "ASSIGNED";
  }

  const tagCats = ranked.filter((s) => s.code !== effective).map((s) => s.code);
  const tags: string[] = [...tagCats];
  if (digitalFound) tags.push("SMART_CITY");

  const labelById = new Map(FEATURES.map((f) => [f.id, f.label] as const));
  const matched = evidence.map((e) => labelById.get(e.featureId) ?? e.featureId);
  const parts: string[] = [];
  if (matched.length) parts.push(`Признаки ${matched.map((l) => `«${l}»`).join(", ")} указывают на тему «${CATEGORY_NAMES_RU[effective].toLowerCase()}».`);
  else parts.push(`Уверенных тематических признаков нет, установлена тема «${CATEGORY_NAMES_RU[effective].toLowerCase()}».`);
  if (tagCats.length) parts.push(`Дополнительно учтены темы: ${tagCats.map((c) => `«${CATEGORY_NAMES_RU[c].toLowerCase()}»`).join(", ")}.`);
  if (mode === "ASSIGNED") parts.push(`Направлено в ${orgName(organizationCode)}.`);
  else parts.push("Передано в центр разбора: маршрут уточнит сотрудник.");

  const scoresOut: Partial<Record<CategoryCode, number>> = {};
  for (const [code, value] of scores) scoresOut[code] = value;

  return {
    source: "RULES",
    ruleVersion: "rules-v1",
    effectiveCategoryCode: effective,
    organizationCode,
    mode,
    confidenceBand: band,
    tags,
    scores: scoresOut,
    evidence,
    reasonCodes,
    explanation: parts.join(" "),
  };
}
