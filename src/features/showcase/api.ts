import { api } from "@/features/shared/api-client";
import type { PublicIdea, Publication, PublicationText, ShowcaseParticipation } from "@/contracts/showcase";

export const showcaseApi = {
  list: (query = "") => api.get<PublicIdea[]>(`/api/v1/showcase${query ? `?${query}` : ""}`),
  detail: (id: string) => api.get<PublicIdea>(`/api/v1/showcase/${encodeURIComponent(id)}`),
  support: (id: string, enabled: boolean) => enabled
    ? api.put<ShowcaseParticipation>(`/api/v1/showcase/${id}/support`, {})
    : api.del<ShowcaseParticipation>(`/api/v1/showcase/${id}/support`, {}),
  follow: (id: string, enabled: boolean) => enabled
    ? api.put<ShowcaseParticipation>(`/api/v1/showcase/${id}/follow`, {})
    : api.del<ShowcaseParticipation>(`/api/v1/showcase/${id}/follow`, {}),
  publication: (id: string) => api.get<Publication>(`/api/v1/ideas/${id}/publication`),
  requestPublication: (id: string, text: PublicationText, expectedVersion: number) =>
    api.put<Publication>(`/api/v1/ideas/${id}/publication`, { ...text, consentAccepted: true, expectedVersion }),
  withdraw: (id: string) => api.del<Publication>(`/api/v1/ideas/${id}/publication`, {}),
  review: (id: string, decision: "PUBLISH" | "REJECT", text: PublicationText, moderationNote: string, expectedVersion: number) =>
    api.post<Publication>(`/api/v1/ideas/${id}/publication/review`, { ...text, decision, moderationNote, expectedVersion }),
  reply: (id: string, body: string, expectedVersion: number) =>
    api.post<Publication>(`/api/v1/ideas/${id}/publication/replies`, { body, expectedVersion }),
};
