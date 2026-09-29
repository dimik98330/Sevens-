// B-draft of src/contracts from doc 03 v1.0. Owner: A (version stamp).
// B implements the server against these DTOs; changes require A sign-off.
export const ROLES = ['CITIZEN', 'STAFF', 'ADMIN'];

export const IDEA_STATUSES = [
  'DRAFT',
  'RECEIVED',
  'UNDER_REVIEW',
  'NEEDS_INFO',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
];

export const CATEGORY_CODES = [
  'TRANSPORT',
  'UTILITIES',
  'EDUCATION',
  'ECOLOGY',
  'SAFETY',
  'HEALTH',
  'TOURISM',
  'ACCESSIBILITY',
  'OTHER',
];

export const COMMENT_VISIBILITIES = ['PUBLIC', 'INTERNAL'];
export const COMMENT_KINDS = [
  'STATUS_COMMENT',
  'CLARIFICATION_QUESTION',
  'CLARIFICATION_ANSWER',
  'NOTE',
];
export const ROUTING_MODES = ['ASSIGNED', 'TRIAGE'];
export const CONFIDENCE_BANDS = ['HIGH', 'MEDIUM', 'LOW'];
export const RESOLUTION_TYPES = [
  'ANSWER_PROVIDED',
  'PILOT_PLANNED',
  'IMPLEMENTED',
  'FORWARDED_EXTERNALLY',
];
export const ROUTING_SOURCES = ['RULES', 'HUMAN'];

export const IDEA_EVENT_TYPES = [
  'CREATED',
  'SUBMITTED',
  'ASSIGNED',
  'UNASSIGNED',
  'STATUS_CHANGED',
  'COMMENT_PUBLIC',
  'COMMENT_INTERNAL',
  'CLARIFICATION_REQUESTED',
  'CLARIFICATION_ANSWERED',
  'REROUTED',
  'ATTACHMENT_ADDED',
  'ATTACHMENT_REMOVED',
];

export const NOTIFICATION_KINDS = [
  'IDEA_REGISTERED',
  'CLARIFICATION_REQUESTED',
  'PUBLIC_REPLY',
  'STATUS_CHANGED',
  'REROUTED',
  'ASSIGNED',
];

export const IDEMPOTENCY_OPERATIONS = [
  'idea.create',
  'idea.update',
  'idea.submit',
  'idea.clarify',
  'idea.upload',
  'idea.attachment-delete',
  'idea.assign',
  'idea.status',
  'idea.comment',
  'idea.reroute',
];

export const SORTABLE_IDEA_FIELDS = [
  'createdAt',
  'updatedAt',
  'submittedAt',
  'publicNumber',
  'title',
];

export const CONSENT_VERSION = 'consent-v1';
export const RULE_VERSION = 'rules-v1';
export const IDEMPOTENCY_TTL_HOURS = 24;
export const SESSION_TTL_HOURS = 12;
