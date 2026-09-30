# Account and cabinet reference review

Observed on 30 September 2026 in Chromium through the installed Playwright package. Viewport: 1440 × 960. Sevens origin: `http://127.0.0.1:3100/`; branch: `codex/sevens-experience`; starting revision: `d66d2b1` (working tree under active design changes). This task made no application, account or database changes. External screenshots contain public reference content; GOV.UK sample details are its example data.

Evidence is in [screenshots/account-references](screenshots/account-references/). `sources.json`, `retry.json`, `supplement.json` and `sevens-home.json` record URLs and actual outcomes. Initial captures used at most three parallel pages; animation-heavy pages received one bounded retry. Screenshots listed below were opened and visually inspected.

| Reference | Observed evidence | Useful decision for Sevens |
| --- | --- | --- |
| [Sevens home](http://127.0.0.1:3100/) | PASS: `sevens-home.png`, `sevens-home-scroll.png`; public page rendered with its current city illustration and journey section. | Carry forest, paper, copper, Manrope and the clear primary/secondary button relationship into account screens. |
| [Lusion home](https://lusion.co/) | LIMITED: HTTP 200 and DOM content; `lusion-retry.png` remained in the loader transition. Final home scene and motion NOT RUN. | No claim about its final scene rendering. |
| [Lusion Oryzo AI](https://lusion.co/projects/oryzo_ai) | PASS for composition: `lusion-project-retry.png`; large visual, compact factual text, isolated action. Project videos/interactive site NOT RUN. | Separate explanatory content from the working action. Give one action strong visual priority. |
| [Spline Examples](https://spline.design/examples) | PASS for gallery: `spline-scroll.png`; Mini House, Cloner City and other scene previews visible. Individual scene interaction/licence review NOT RUN. | Isometric architecture and soft materials can support regional identity. Do not add a scene to the cabinet just to decorate it. |
| [Mapbox](https://www.mapbox.com/) and [Maps](https://www.mapbox.com/maps) | PASS: `mapbox.png`, `mapbox-maps.png`, `mapbox-maps-scroll.png`; public maps showcase rendered. SDK/account functionality NOT RUN. | Keep basemap colours quiet so labels and the selected place remain readable. A filled primary action and outlined secondary action are easy to distinguish. |
| [Bruno Simon](https://bruno-simon.com/) | LIMITED: HTTP 200; `bruno-retry.png` showed spatial grid/loading artwork. Portfolio controls and final scene NOT RUN. | No claim that its game navigation was tested. Account tasks must be available through ordinary controls. |
| [Linear public home](https://linear.app/) | PASS: `linear-retry.png`; headline and embedded product illustration rendered. Private workspace NOT RUN. | Use compact navigation, quiet separators and a clear content title. Keep activity and properties secondary to the main content. |
| [GOV.UK Question pages](https://design-system.service.gov.uk/patterns/question-pages/) | PASS: guidance and actual public example inspected in `questions-example.png`. | Group related fields; place explanation next to input; show Back and one clear Continue action. |
| [GOV.UK Check answers](https://design-system.service.gov.uk/patterns/check-answers/) | PASS: guidance and public example inspected in `answers-example.png`. | Review sections with local Edit actions. Return to review with existing answers intact. |
| [GOV.UK Confirmation](https://design-system.service.gov.uk/patterns/confirmation-pages/) | PASS: guidance and public example inspected in `confirmation-example.png`. | Confirm server success, show the real reference and a concrete next step. Do not invent a deadline or integration. |

## Palette and hierarchy

Computed current home tokens: forest `#142725`, paper `#f4f3ed`, ink `#1a302b`, copper `#edac83`; Manrope with Inter fallback. Its primary button uses dark text on copper. Keep cabinet navigation forest and work surfaces paper; reserve copper for selection and the primary action.

Calculated WCAG contrast ratios: copper on paper 1.74:1; forest on copper 8.04:1; darker copper `#9a4d2f` on paper 5.43:1; muted ink `#5d6c66` on paper 4.97:1. Copper is unsuitable for small text on paper. These are colour calculations, not a completed accessibility audit.

The current cabinet screenshot repeats the selected idea in two adjacent areas while hiding search. Prefer a visible search and status filter, a readable idea list, and an aside that explains the selected idea's next action and latest update. For a draft, say it has not been sent and offer Continue; a draft does not need a review timeline. Use one filled New idea button and quieter per-record actions. Empty states should explain what to do next.

## Provenance and limits

Only design principles were applied from these references. No third-party code, scene, image, icon or font was imported into application assets. These screenshots are internal reference evidence, not product artwork or permission to reuse the captured assets. GOV.UK pages display the Open Government Licence v3.0 with exceptions; no branded markup or source implementation was copied. A concrete Spline asset would require its own licence check before reuse.

Three.js, React Three Fiber, Drei, Motion and 2GIS implementation examples were outside this account research task: NOT RUN. Physical mobile testing, backend persistence, map interaction and authenticated account behaviour are also NOT RUN here; they belong to implementation validation.
