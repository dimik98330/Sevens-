# Location geometry contract (B-05)

## API and persistence

`POST /api/v1/ideas` and `PATCH /api/v1/ideas/:id` accept optional
`locationGeometry`. Authenticated detail and idea-list DTOs return
`locationGeometry: LocationGeometry | null`. TypeScript types are exported
from `src/contracts/index.ts`.

```json
{"type":"Point","coordinates":[80.249,50.411]}
```

The exact object has only `type` and `coordinates`; Feature wrappers, bbox,
properties, altitude, custom CRS and multi-geometries are not accepted.
Coordinates are WGS84 `[longitude, latitude]` in degrees, following
[RFC 7946](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.1).

| Type | Accepted coordinates |
| --- | --- |
| Point | Exactly two finite numbers; longitude -180..180, latitude -90..90 |
| LineString | 2..128 positions forming one simple path |
| Polygon | Exactly one ring, 3..128 distinct vertices plus the repeated first position (4..129 positions total) |

Polygon closure is exact. Both winding orders are accepted and stored without
reordering. Holes are deliberately outside this one-selection product contract.
Duplicate consecutive vertices, backtracking/overlapping edges, nonadjacent
edge intersections or touches are rejected. Polygon area must exceed
`1e-12` square degrees (numerical degeneracy threshold, not a land area claim).

Omission on create stores SQL NULL; omission on PATCH preserves the current
value. Explicit `null` clears only the geometry. `locationText` remains the
existing optional description/landmark field (300 Unicode code points); no
second description field is introduced. Text-only ideas stay valid when the
map is unavailable. Old rows acquire NULL through migration
`0004_location_geometry.sql`, which neither deletes nor rewrites idea content.

Geometry is validated before a draft write and revalidated before submit.
Submit keeps its existing `{expectedVersion, consentAccepted}` body: save
geometry in the draft first, upload materials, then submit with the latest
version returned by those operations. Geometry and attachments survive submit
unchanged. Mutation responses retain the existing compact id/version format;
GET detail supplies the saved geometry.

Invalid geometry returns HTTP 400 `VALIDATION_ERROR` with a Russian field
message at `error.fields.locationGeometry`. Existing ownership, role/region/
organization scopes, CSRF, expectedVersion and idempotency rules remain in
force. Geometry is private idea data; it is not exposed by a public map API.

## Boundary policy

The entire selected shape must be covered by the original OSM Abai Polygon
snapshot (relation 14243026, retrieved 2026-09-30). Boundary points and edges
are accepted. It is the same region-wide rule regardless of the selected
territory catalogue entry; no unverified municipal polygons are inferred.
The data, source and ODbL attribution are packaged in `src/server/geo/`.

Segments are straight in longitude/latitude, as defined by GeoJSON, not
geodesic arcs. The validator computes boundary intersections and checks every
interval between them. It therefore rejects a line or polygon edge that
leaves and re-enters the region, even when all input vertices are inside.
Bounding boxes only skip disjoint segment comparisons. They never substitute
for the contour. Ring containment also excludes enclosed holes should a future
boundary include them; the current source has no holes.

Boundary comparisons use `1e-10` degrees of numerical tolerance (less than
0.02 mm), without adding a product-level buffer. Coordinate precision is
preserved. The supported shape cap bounds quadratic topology checks and
boundary intersection work; the existing HTTP body cap is unchanged and the
database additionally caps the JSONB representation at 16 KiB.

## Focused verification

Run without any live demo database:

```powershell
npx vitest run tests/unit/geo/location.test.ts
npm run routing:build
node --test tests/integration/backend/b05-location.test.mjs
```

The integration suite explicitly opens in-memory PGlite, upgrades old rows,
exercises real HTTP save/reload for all three shapes, clears a selection,
checks invalid inputs and versions/access, uploads a file and submits an idea,
then checks citizen and scoped staff reads after a new session.
This establishes local PostgreSQL-engine behavior; production PostgreSQL and
the external 2GIS SDK require their separate integration/visual gates.

### Author verification, 2026-09-30

Task B-05, isolated `sevens-location` worktree, base `d66d2b1` plus the existing
uncommitted project snapshot. No commit was created. This is ready for independent
review and selective integration; it is not a team DONE/release declaration.

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/geo/location.test.ts` | PASS, 43 tests |
| `npm run routing:build` | PASS |
| `npm run typecheck` | PASS |
| `node --test tests/integration/backend/b05-location.test.mjs` | PASS, 11 tests |
| `node --test tests/integration/backend/b03-ideas.test.mjs` | PASS, 12 regression tests |
| `node --test tests/integration/backend/b01-schema.test.mjs` | PASS, 14 regression tests |
| Production PostgreSQL / real 2GIS / browser end-to-end | NOT RUN in this backend task |

All database tests above used isolated in-memory PGlite. No migration/reset
command was run against the demo database. The app/workflow query changes only
add `locationGeometry` to existing authorized DTOs; scope filters are unchanged.
