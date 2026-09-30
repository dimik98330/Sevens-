export type AssistantLanguage = "ru" | "kk" | "en";
export type AssistantRole = "GUEST" | "CITIZEN" | "STAFF" | "ADMIN";
export type AssistantPage = "home" | "how" | "dashboard" | "dashboard-detail" | "login" | "register" | "my" | "idea-new" | "idea-detail" | "notifications" | "staff" | "staff-detail" | "settings";
export interface AssistantContext {
  page: AssistantPage;
  targets: string[];
  step?: number;
  status?: string;
  mapEditing?: boolean;
  mapAvailable?: boolean;
  navigationBlocked?: boolean;
  saving?: boolean;
  errorCode?: string;
}
export interface AssistantAction {
  id: string;
  kind: "navigate" | "highlight";
  label: string;
  path?: string;
  target?: string;
}
export interface AssistantReply {
  answer: string;
  actions: AssistantAction[];
  followups: string[];
  language: AssistantLanguage;
  mode: "ai" | "guide";
}
export interface AssistantHistoryItem { role: "user" | "assistant"; content: string }
export interface AssistantRequest {
  message: string;
  history: AssistantHistoryItem[];
  language: AssistantLanguage;
  context: AssistantContext;
}
