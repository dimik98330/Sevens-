"use client";
import { useTranslation, useUiMessages } from "@/features/i18n/provider";
import type { IdeaStatus } from "@/contracts";
import ru from "@/locales/ru.json";
import {Icon, type IconName} from "./Icon";

const ICONS: Record<IdeaStatus, IconName> = {
  DRAFT: "file",
  RECEIVED: "file",
  UNDER_REVIEW: "clock",
  NEEDS_INFO: "bell",
  IN_PROGRESS: "layers",
  COMPLETED: "check",
  REJECTED: "close",
};

const STATUSES = ru.statuses as Record<IdeaStatus, string>;

// Отображаемые имена демонстрационных направлений (fixtures/demo-seed.json).
// Только display-слой: серверная связь — UUID, код приходит в DTO.
const ORG_NAMES: Record<string, string> = {
  DEMO_TRANSPORT: "Транспорт",
  DEMO_UTILITIES: "ЖКХ",
  DEMO_ECOLOGY: "Экология",
  DEMO_SOCIAL: "Социальные инициативы",
  DEMO_SAFETY: "Безопасность",
  DEMO_TRIAGE: "Центр цифровых инициатив",
};

export function orgName(code: string | null | undefined): string {
  if (!code) return "—";
  return ORG_NAMES[code] ?? code;
}

// Статус различается цветом, текстом и пиктограммой (05 §2), никогда одним цветом.
export function StatusBadge({ status }: { status: IdeaStatus }) {
  const { t: tr } = useTranslation();
  const ru = useUiMessages();
  return (
    <span className="status" data-s={status}>
      <Icon name={ICONS[status]} size={14}/> {tr(STATUSES[status])}
    </span>
  );
}
