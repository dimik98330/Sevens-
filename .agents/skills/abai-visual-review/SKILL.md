---
name: abai-visual-review
description: Review Sevens in a real browser across citizen, staff, map and responsive scenarios, with reproducible evidence.
---

# Sevens visual review

Use the live app and record its origin, branch, revision, API mode, viewport and date. Screenshots of concepts are not evidence of implemented features. Store synthetic-data captures in `docs/design/screenshots/` and open the resulting images.

- Cover home, sign-in, three wizard steps, submitted idea, citizen detail, notifications, staff queue and staff detail at 1440, 768 and 390px; additionally check overflow at 360px.
- Check keyboard focus, labels, zoom, long titles, a long PUBLIC reply, loading, empty lists, field and network errors, expired sessions, 403, 409, reduced motion and unavailable maps. Text must survive a failed mutation.
- On isolated synthetic records, exercise citizen submission with location and file, routing, staff assignment, clarification, PUBLIC reply and fresh citizen sign-in. Verify INTERNAL absence in citizen API payloads as well as UI.
- Verify Point, LineString and Polygon persistence through server save, reload and new sign-in; also open old ideas without geometry. With no valid 2GIS key, mark live map checks NOT RUN and test the text-location fallback.
- Preserve existing database volumes and users. Do not run reset-oriented suites on the demonstration database.
- Report PASS, FAIL or NOT RUN per observed requirement. Attach actual screenshots and command results. Keep desktop render, physical mobile testing, map coverage and backend persistence as distinct claims.
