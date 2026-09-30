---
name: abai-webgl-art-direction
description: Build the geographic 3D identity of Sevens while keeping the Abai service usable on mobile and without WebGL.
---

# Sevens geographic 3D

Use the selected direction recorded in `docs/design/`. Before a direction is selected, keep experiments clearly labeled as concepts. Three.js with React Three Fiber is the primary intended runtime; do not add Spline as a second renderer.

- For a regional model, use the contemporary Abai administrative polygon with a recorded source, date and reuse license. Never substitute the old East Kazakhstan region, a bounding box, or an invented contour. Label unresolved conceptual geography explicitly.
- Treat thickness, light, materials and elevation as artistic unless actual terrain data is sourced. Do not call the illustration a digital twin.
- HTML headline and primary action render independently of the scene. Lazy-load decorative 3D only on the landing page. Idea forms use 2GIS MapGL, not the decorative renderer.
- Use restrained cursor parallax, selectable example markers and a short entrance. Never require game controls, sound or scroll capture to access the service.
- Respect reduced motion, pause rendering offscreen, cap pixel density, release GPU resources and display a coherent static fallback when WebGL fails.
- Sample idea markers must be labeled examples. Do not expose real private drafts or precise citizen coordinates on the public landing page.
- Test a real WebGL render, fallback and mobile layout separately. Record asset and geography sources in `docs/design/`.
