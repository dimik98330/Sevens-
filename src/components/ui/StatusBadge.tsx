import type { IdeaStatus } from "@/contracts";
import ru from "@/locales/ru.json";

const ICONS: Record<IdeaStatus, string> = {
  DRAFT: "✎",
  RECEIVED: "📥",
  UNDER_REVIEW: "👁",
  NEEDS_INFO: "❓",
  IN_PROGRESS: "⚙",
  COMPLETED: "✔",
  REJECTED: "✕",
};

const STATUSES = ru.statuses as Record<IdeaStatus, string>;

// Отображаемые имена демонстрационных направлений (fixtures/demo-seed.json).
// Только display-слой: серверная связь — UUID, код приходит в DTO.
const ORG_NAMES: Record<string, string> = {
  DEMO_TRANSPORT: "Демо: направление транспорта",
  DEMO_UTILITIES: "Демо: направление ЖКХ",
  DEMO_ECOLOGY: "Демо: направление экологии",
  DEMO_SOCIAL: "Демо: социальное направление",
  DEMO_SAFETY: "Демо: направление безопасности",
  DEMO_TRIAGE: "Демо: центр цифровых инициатив",
};

export function orgName(code: string | null | undefined): string {
  if (!code) return "—";
  return ORG_NAMES[code] ?? code;
}

// Статус различается цветом, текстом и пиктограммой (05 §2), никогда одним цветом.
export function StatusBadge({ status }: { status: IdeaStatus }) {
  return (
    <span className="status" data-s={status}>
      <span aria-hidden="true">{ICONS[status]}</span> {STATUSES[status]}
    </span>
  );
}
