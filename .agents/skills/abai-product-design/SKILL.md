---
name: abai-product-design
description: Design and implement Sevens citizen and staff interfaces in the existing Abai Next.js application.
---

# Sevens product design

Read the affected page, shared components, `src/contracts`, and `docs/design/` before changing behavior. The Sevens brief supersedes the previous visual identity in `docs/05_UX_UI_DESIGN.md`. Preserve its business constraints.

- Use one token system across home, authentication, the idea wizard, lists, details, notifications, and staff queue. Labels and status explanations are Russian; verify Kazakh letters Ә Ғ Қ Ң Ө Ұ Ү Һ І in the actual font.
- The wizard has three steps: problem and solution; location and materials; review and send. Preserve input across steps, failures and 409 conflicts. Report saved only after the server confirms.
- Keep IDs, expectedVersion, idempotency, CSRF and authorization consistent with existing API contracts. A new brand does not change public idea numbers or stored IDs.
- Citizen details show PUBLIC reply bodies and history after fresh sign-in. INTERNAL data must be filtered on the server, not hidden in CSS.
- Staff actions use allowed transitions and catalog UUIDs. Distinguish public replies from internal notes before submission. Queue filters and pagination survive returning from details.
- Keep a visible, concise demonstration notice. Never invent impact metrics, response deadlines, government integration, or public access to private ideas.
- Use meaningful labels, visible focus, a text equivalent for every status, and field-linked errors. At 390px use readable queue cards and touch targets of at least 44px.
- Capture all affected states in a real browser. Build success does not establish visual or behavioral correctness.
