import type { CategoryCode, IdeaStatus, ResolutionType } from "./index";

export interface ShowcaseReply { body: string; createdAt: string }
export interface ShowcaseEvent {
  id: string;
  type: "PUBLISHED" | "STATUS_CHANGED" | "REPLY";
  body: string | null;
  status: IdeaStatus | null;
  createdAt: string;
}
export interface PublicIdea {
  id: string;
  publicNumber: string;
  title: string;
  problem: string;
  solution: string;
  expectedBenefit: string | null;
  categoryCode: CategoryCode;
  territoryId: string | null;
  territoryName: string | null;
  organizationName: string | null;
  status: Exclude<IdeaStatus, "DRAFT">;
  resolutionType: ResolutionType | null;
  publishedAt: string;
  updatedAt: string;
  supportCount: number;
  isSupported: boolean;
  isFollowing: boolean;
  isAuthor: boolean;
  latestReply: ShowcaseReply | null;
  timeline?: ShowcaseEvent[];
}
export interface ShowcaseSummary {
  published: number;
  inProgress: number;
  completed: number;
  totalSupports: number;
}
export interface Publication {
  state: "PRIVATE" | "PENDING" | "PUBLISHED" | "REJECTED";
  title: string;
  problem: string;
  solution: string;
  expectedBenefit: string | null;
  moderationNote: string | null;
  publishedAt: string | null;
  version: number;
  authorConsent: boolean;
}
export interface PublicationText {
  title: string;
  problem: string;
  solution: string;
  expectedBenefit?: string;
}
export interface ShowcaseParticipation {
  supportCount: number;
  isSupported: boolean;
  isFollowing: boolean;
}
