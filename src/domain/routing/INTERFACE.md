# D-01 → B: routing interface contract (rules-v1)

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

Run **before** the submit transaction on the submitted text version; inside
the transaction only check `expectedVersion` (02 section 6). No LLM call
exists on this path, so `AI_ENABLED=false` changes nothing here.

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

Unlisted word forms, typos, negations («не нужен светофор» still matches)
and paraphrases are not understood; such ideas go LOW/TRIAGE by design.
`fixtures/routing-cases.json` checks code behavior on 20 cases, it is not
an accuracy benchmark (04 section 11).
