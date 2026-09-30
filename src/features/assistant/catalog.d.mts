import type { AssistantAction, AssistantContext, AssistantLanguage, AssistantPage, AssistantReply, AssistantRole } from "./types";
export const ASSISTANT_PAGES: readonly ["home", "how", "dashboard", "dashboard-detail", "login", "register", "my", "idea-new", "idea-detail", "notifications", "staff", "staff-detail", "settings"];
export const ASSISTANT_TARGETS: readonly string[];
export function pageForPath(pathname: string): AssistantPage;
export function availableActions(role: AssistantRole | string, context: AssistantContext, language: AssistantLanguage): AssistantAction[];
export function buildKnowledge(role: AssistantRole | string): string;
export function fallbackReply(message: string, role: AssistantRole | string, context: AssistantContext, language: AssistantLanguage): AssistantReply;
export function quickQuestions(role: AssistantRole | string, context: AssistantContext, language: AssistantLanguage): string[];
