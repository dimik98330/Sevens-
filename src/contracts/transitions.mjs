// Allowed status transitions (01 FR-08) with entry requirements.
// DRAFT->RECEIVED is handled by the submit service, not the status endpoint.
export const TRANSITIONS = {
  RECEIVED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['NEEDS_INFO', 'IN_PROGRESS', 'REJECTED', 'COMPLETED'],
  NEEDS_INFO: ['UNDER_REVIEW'],
  IN_PROGRESS: ['NEEDS_INFO', 'COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

// Statuses whose entry requires a public comment of 20..2000 chars.
export const REQUIRES_PUBLIC_COMMENT = new Set(['NEEDS_INFO', 'REJECTED', 'COMPLETED']);

// Statuses whose entry requires an active assignee in the current org,
// except the documented UNDER_REVIEW exception (author reply after reroute).
export const REQUIRES_ASSIGNEE = new Set(['UNDER_REVIEW', 'IN_PROGRESS']);

// Reroute is allowed from these statuses; terminal statuses are excluded.
export const REROUTE_FROM = new Set(['RECEIVED', 'UNDER_REVIEW', 'NEEDS_INFO', 'IN_PROGRESS']);

export function isTransitionAllowed(from, to) {
  if (from === to) return false;
  return (TRANSITIONS[from] || []).includes(to);
}
