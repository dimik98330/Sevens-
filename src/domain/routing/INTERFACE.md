# Routing interface: rules-v2 with optional server LLM

The active production path is `src/server/routing/adapter.mjs` with
`ROUTING_CLASSIFIER_VERSION=rules-v2` and `CLASSIFIER_MODE=llm`.
`CLASSIFIER_MODE=rules` disables paid calls. A missing key, invalid provider
result, deadline, busy instance or exhausted shared budget uses rules-v2.
Network/provider work runs before the submit transaction. Inside that
transaction, reserve idempotency, lock the idea, check access/version, then
apply analysis only when its text hash matches the locked text. Resolve the
organization from the current catalog there. Never call the model while
holding idea-row locks.

The pure v2 engine exposes `analyzeRoutingText`, `routeAnalyzed` and
`routeIdea`; v1 remains available for historical fixtures and rollback.
The catalog's `rules-v1` is its routing-matrix version, independent of the
classifier's `rules-v2` / `hybrid-v2` version.

`POST /api/v1/ideas/routing-preview` is authenticated and non-persistent.
Preview and submit use the same server engine and reusable prepared result.
It cannot guarantee a later official route if text or catalog changes.
Public DTO adds `detectedCategoryCode`, `classificationSource`,
`classificationMethod`, `classifierStatus` and `catalogVersion`; it omits
analysis internals, raw model quotations and numeric scores.
The actor's selected category is preserved; conflicts and uncertainty go to
TRIAGE. A HIGH band is not a calibrated probability. Manual reroutes stay
`source=HUMAN` and require a reason.

## Legacy rules-v1 reference

Owner: D. Reviewer: B. No AI key, network or database is used or required
anywhere in this module.

## Files

- `src/domain/routing/types.ts` — input/output types, `RoutingInputError`.
- `src/domain/routing/features.ts` — explicit rules-v1 dictionary.
- `src/domain/routing/normalize.ts` — NFC/lowercase/ё→е/tokenizer.
- `src/domain/routing/rules.ts` — `routeIdea`, `manualReroute`, `confidenceLabel`.

## B calls

```ts
import { routeIdea, manualReroute } from '@/domain/routing/rules';

const decision = routeIdea(
  {
    title,                 // raw user text, trimmed by B
    problem,               // raw user text
    solution,              // raw user text
    requestedCategoryCode, // CategoryCode | null (null = AUTO; never 'AUTO')
    territoryCode,         // active territory code, validated here again
  },
  catalogSnapshot, // built by B from DB: territories, organizations, rules
);
```

Run the pure route function **inside** the submit transaction on the locked
row after checking access and `expectedVersion`. No LLM call exists in this
pure module; `AI_ENABLED` is not the classifier switch.

## Persistence mapping (B)

- `routing_decisions`: source=`RULES`, mode, effective_category_code,
  organization_id (resolve `organizationCode` → UUID, same region),
  tags_json=`tags`, confidence_band, scores_json=`scores`,
  reason_codes_json=`reasonCodes`, explanation, rule_version=`rules-v1`.
- `ideas`: effective_category_code, organization_id (triage included:
  a submitted idea always has both, 03 section 3.3).
- `manualReroute` result: source=`HUMAN`; `reason` → history payload
  (10–1000 chars enforced here, B enforces again at the API boundary);
  assignee reset and status rules stay in B's service. Confidence for a
  changed category is `LOW` unless the caller passes the prior same-category
  band through.

## Error mapping (B)

| Thrown                       | HTTP                                   |
| ---------------------------- | -------------------------------------- |
| `RoutingInputError` + field  | 400 `VALIDATION_ERROR`, `fields[field]`|
| `Error: no active triage…`   | 500/503 catalog misconfiguration, alert|

`requestedCategoryCode: 'AUTO'` (string) throws: C must send `null`,
B must reject the string at the DTO boundary (03 section 2).
Unknown/inactive `territoryCode` throws: B keeps the draft, returns 400.

## Guarantees for C (via B's DTO)

- `explanation` is plain RU text from dictionary labels + catalog names;
  render as a text node, never as HTML.
- `confidenceBand` is a relative certainty band, never a percent:
  HIGH → «определено уверенно», MEDIUM → «стоит проверить»,
  LOW → «нужен специалист» (`confidenceLabel`).
- `tags` may contain `SMART_CITY` plus extra category codes; treat as a set.
- `reasonCodes` vocabulary: `CATEGORY_CONFLICT`,
  `RULE_CONFIGURATION_CONFLICT`, `ORGANIZATION_INACTIVE`,
  `NO_MATCHING_ROUTE`, `DIGITAL_COMPONENT_NOT_CLEAR`, `MANUAL_REROUTE`.

## Known rules-v1 limits (do not present as accuracy)

Unlisted word forms, typos and paraphrases may produce LOW/TRIAGE. Negation
is not understood: «не нужен светофор» still matches and can yield HIGH.
Confidence bands describe dictionary scores, not calibrated correctness.
`fixtures/routing-cases.json` checks code behavior on 20 cases, it is not
an accuracy benchmark (04 section 11).
