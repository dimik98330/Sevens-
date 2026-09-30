# Abai validation boundary

`abai-boundary.json` is a byte-for-byte runtime copy of
`docs/design/geodata/abai.geojson` (7,374 positions, one closed Polygon ring).
It is not the simplified outline used for artwork and is not a bounding box.

- Source: [OpenStreetMap relation 14243026](https://www.openstreetmap.org/relation/14243026), Abai region, `KZ-10`.
- Snapshot retrieval date recorded in the source Feature: 2026-09-30.
- Attribution: **© OpenStreetMap contributors**.
- Database license: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Attribution and reuse guidance: [OpenStreetMap copyright](https://www.openstreetmap.org/copyright).
- SHA-256: `a3ca5dc019e1ae9a0a4e65270fce8012ca069058c1fd2837a11ffcddbd72061e`.

The original downloaded lookup response is retained at
`docs/design/geodata/abai-osm-lookup.json`. The geometry and its provenance
remain distributable with this application under ODbL. OSM is a community
dataset, not a cadastral certification or an official legal boundary. The
service's acceptance rule is containment in this explicitly versioned snapshot.

When updating this snapshot, recheck containment regressions and confirm the
source geometry remains a Polygon. Do not replace it with the art outline.
Keep the frontend boundary attribution visible wherever its outline is shown.
