# Sevens location map integration

Implemented for task C-12 in the isolated `sevens-map` checkout. No commits, shared package edits, or page integration were made by this task.

## Component contract

```tsx
import { LocationMap, type LocationGeometry } from "@/components/location/LocationMap";

<LocationMap
  value={locationGeometry}
  onChange={setLocationGeometry}
  title="Место идеи"
/>

// Citizen/staff detail or the final review step:
<LocationMap value={idea.locationGeometry ?? null} readOnly />
```

Props: `value: LocationGeometry | null`; `onChange?: (value: LocationGeometry | null) => void`; `readOnly?: boolean`; `title?: string`. Missing `onChange` also makes the component read-only. The exported geometry is structurally compatible with GeoJSON: Point `[longitude, latitude]`, LineString 2–128 coordinates, Polygon one closed ring of 4–129 coordinates including the closing coordinate. No holes. Importing a compatible shared DTO does not require runtime conversion.

Keep territory and location-description inputs outside this component, visible even when the map is unavailable. Persist the confirmed value through existing draft/create/update DTOs. A confirmation means a local form selection; the component does not call the API or claim that the server saved it. The server must enforce the actual Abai polygon, the entire selected line/polygon, topology, permissions and persistence. The map center is Semey; it is not an administrative boundary validation.

## Interaction and lifecycle

- Choose «Точка», «Участок», or «Зона». One selection replaces the previous selection only after «Подтвердить место». «Отменить» restores the previous geometry. «Очистить» also requires confirmation.
- Lines finish with a tap/click on the last vertex; polygons finish on the first vertex. This is the plugin's documented closing-point interaction. No double click is needed. Russian instructions remain next to the map.
- Completed shapes enter selection mode. Point/vertices can be dragged and midpoints add vertices. Selection uses an enlarged 24-pixel hit distance. Controls are at least 44 pixels tall.
- Read-only mode fits the full geometry with padding. Changing `value` updates the existing SDK instance, not the map container. Equal-value rerenders do not reset an unfinished edit.
- SDK and drawing libraries import only in the client effect when a key exists. Unmount and retry destroy the drawing session and SDK instance, remove listeners and cancel timers. A late load completion cannot recreate a destroyed map.
- A first tile-render `idle` event and initialized drawing tools are both required before enabling controls. Missing key, rejected tile key, style failure, SDK rejection, raster tile failure, lost WebGL context, offline event or 20-second loading timeout produce an explicit unavailable state. Saved input is retained. No sample or alternative map provider replaces 2GIS.
- `enableTwoFingerDragging` is enabled for page scrolling on touch devices. Real touch scrolling/gesture behavior still requires a browser with the valid key and a physical mobile check if that claim is needed.

## Configuration

Supply a valid browser key through `NEXT_PUBLIC_DGIS_MAP_KEY` and restart/rebuild Next.js after changing it. No example/documentation key is embedded. A browser key is visible to users; configure its allowed origins and usage limits in the 2GIS account. This task did not obtain or validate a key.

Dependencies found in the installed checkout: `@2gis/mapgl` 1.78.1 (BSD-2-Clause), `@2gis/mapgl-terra-draw` 0.4.0 (MIT), `terra-draw` 1.35.0 (MIT). The adapter declares `terra-draw: ^1.8.0`; 1.8.0 is the lower bound, not the installed version. The component imports TerraDraw directly, so the integrating owner should retain/add it as a direct dependency at the tested version when consolidating package changes. No dependency files were modified in this task.

## Evidence and limitations

Checked 2026-09-30:

- PASS: `npm run typecheck`.
- PASS: `npm run test:unit -- tests/unit/frontend/location-map.test.ts` — 15 tests. Uses the actual installed TerraDraw point/line/polygon/select modes with mocked MapGL renderer and event adapter. Covers line/polygon tap completion, point drag editing, cancel/confirm/clear, self-intersection rejection, coordinate constraints, read-only behavior, `fitBounds`, map preservation on controlled updates, missing/late SDK lifetime, timeout and map error handling.
- NOT RUN: live 2GIS SDK/tile rendering, valid-key authorization, network-to-tile behavior, desktop/mobile visual review, physical touch, and backend persistence. Mock tests cannot establish these. Page integration and end-to-end API checks belong to the integrating owner.

## Primary sources

- [2GIS: React lifecycle](https://docs.2gis.com/en/mapgl/start/react)
- [2GIS: drawing tools and custom adapter UI](https://docs.2gis.com/en/mapgl/map/tools/drawing)
- [2GIS adapter modes: tap to finish lines and polygons](https://github.com/2gis/mapgl-terra-draw/blob/main/MODES.md)
- [2GIS geometries](https://docs.2gis.com/en/mapgl/objects/geometries)
- Installed SDK declaration files and adapter source were checked for lifecycle, supported error events, `fitBounds`, drawing validation and selection flags.
