import type { IdeaStatus } from "@/contracts";

export type IdeaActionActor = "AUTHOR" | "STAFF" | "DONE";

export interface IdeaGuidance {
  actor: IdeaActionActor;
  actorLabel: string;
  citizenNextStep: string;
  staffNextStep: string;
  citizenActionLabel: string;
}

const GUIDANCE: Record<IdeaStatus, IdeaGuidance> = {
  DRAFT: {
    actor: "AUTHOR", actorLabel: "Автор идеи",
    citizenNextStep: "Дополните черновик, проверьте данные и отправьте идею на рассмотрение.",
    staffNextStep: "Автор готовит черновик. На рассмотрение он ещё не поступил.",
    citizenActionLabel: "Продолжить черновик",
  },
  RECEIVED: {
    actor: "STAFF", actorLabel: "Сотрудник направления",
    citizenNextStep: "Идея отправлена. От вас сейчас действий не требуется; следите за началом рассмотрения.",
    staffNextStep: "Назначьте ответственного и начните рассмотрение.",
    citizenActionLabel: "Следить за рассмотрением",
  },
  UNDER_REVIEW: {
    actor: "STAFF", actorLabel: "Сотрудник направления",
    citizenNextStep: "Дождитесь ответа специалиста. Если понадобятся подробности, в карточке появится вопрос.",
    staffNextStep: "Рассмотрите предложение, запросите необходимые уточнения или сообщите следующий этап.",
    citizenActionLabel: "Следить за рассмотрением",
  },
  NEEDS_INFO: {
    actor: "AUTHOR", actorLabel: "Автор идеи",
    citizenNextStep: "Прочитайте вопрос специалиста и отправьте уточнение в диалоге идеи.",
    staffNextStep: "Ожидается ответ автора на запрос уточнений. После ответа продолжите рассмотрение.",
    citizenActionLabel: "Ответить на вопрос",
  },
  IN_PROGRESS: {
    actor: "STAFF", actorLabel: "Сотрудник направления",
    citizenNextStep: "Следите за сообщениями специалиста и итогом рассмотрения. Новое предложение отправлять не нужно.",
    staffNextStep: "Продолжите работу с идеей и сообщите автору о результате.",
    citizenActionLabel: "Посмотреть ход работы",
  },
  COMPLETED: {
    actor: "DONE", actorLabel: "Рассмотрение завершено",
    citizenNextStep: "Прочитайте итог рассмотрения и ответ специалиста.",
    staffNextStep: "Рассмотрение завершено. Итоговый ответ и история доступны в карточке.",
    citizenActionLabel: "Прочитать итог",
  },
  REJECTED: {
    actor: "DONE", actorLabel: "Рассмотрение завершено",
    citizenNextStep: "Прочитайте причину отклонения и ответ специалиста.",
    staffNextStep: "Рассмотрение завершено. Причина отклонения и история доступны в карточке.",
    citizenActionLabel: "Прочитать причину",
  },
};

export function getIdeaGuidance(status: IdeaStatus): IdeaGuidance {
  return GUIDANCE[status];
}

/** Display only fields exposed by the scoped API, without category-based guesses. */
export interface IdeaRoutingDisplay {
  organizationCode?: string | null;
  assigneeDisplayName?: string | null;
  assignee?: { name: string } | null;
  routing?: {
    organizationCode?: string | null;
    explanation?: string | null;
    mode?: string;
    source?: string;
  } | null;
}

export function getIdeaRoutingContext(idea: IdeaRoutingDisplay) {
  const text = (value?: string | null) => value?.trim() || null;
  return {
    organizationCode: text(idea.organizationCode) ?? text(idea.routing?.organizationCode),
    assigneeName: text(idea.assigneeDisplayName) ?? text(idea.assignee?.name),
    explanation: text(idea.routing?.explanation),
  };
}
