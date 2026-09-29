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

// Статус различается цветом, текстом и пиктограммой (05 §2), никогда одним цветом.
export function StatusBadge({ status }: { status: IdeaStatus }) {
  return (
    <span className="status" data-s={status} aria-label={`Статус: ${STATUSES[status]}`}>
      <span aria-hidden="true">{ICONS[status]}</span> {STATUSES[status]}
    </span>
  );
}
