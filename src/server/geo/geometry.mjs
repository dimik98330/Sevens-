// GeoJSON uses straight segments in WGS84 longitude/latitude (RFC 7946 §3.1.1).
// EPS is numerical tolerance in degrees, not a buffer around the region.
const EPS = 1e-10;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const minus = (a, b) => [a[0] - b[0], a[1] - b[1]];
const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const samePosition = (a, b) => a[0] === b[0] && a[1] === b[1];

function onSegment(p, a, b) {
  const d = minus(b, a);
  return Math.abs(cross(d, minus(p, a))) <= EPS * Math.hypot(...d)
    && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

// Return parameters on AB where it meets CD, including both ends of overlap.
// Disjoint edge boxes skip work only; boxes never decide region membership.
function intersectionParameters(a, b, c, d) {
  if (Math.max(a[0], b[0]) + EPS < Math.min(c[0], d[0])
    || Math.max(c[0], d[0]) + EPS < Math.min(a[0], b[0])
    || Math.max(a[1], b[1]) + EPS < Math.min(c[1], d[1])
    || Math.max(c[1], d[1]) + EPS < Math.min(a[1], b[1])) return [];
  const r = minus(b, a);
  const s = minus(d, c);
  const q = minus(c, a);
  const denominator = cross(r, s);
  // Relative machine precision here avoids classifying shallow crossings as
  // parallel. The on-segment test separately tolerates roundoff at vertices.
  const parallel = Math.abs(denominator) <= Number.EPSILON * 8 * Math.hypot(...r) * Math.hypot(...s);
  if (!parallel) {
    const t = cross(q, s) / denominator;
    const u = cross(q, r) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [t];
  }
  const axis = Math.abs(r[0]) >= Math.abs(r[1]) ? 0 : 1;
  const result = [];
  if (onSegment(c, a, b)) result.push((c[axis] - a[axis]) / r[axis]);
  if (onSegment(d, a, b)) result.push((d[axis] - a[axis]) / r[axis]);
  if (onSegment(a, c, d)) result.push(0);
  if (onSegment(b, c, d)) result.push(1);
  return result.map((t) => Math.max(0, Math.min(1, t)));
}

// -1 outside, 0 boundary, 1 inside; ring is explicitly closed.
export function classifyPointInRing(point, ring) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    if (onSegment(point, a, b)) return 0;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : -1;
}

export function pointInPolygon(point, rings) {
  const exterior = classifyPointInRing(point, rings[0]);
  if (exterior <= 0) return exterior === 0;
  for (const hole of rings.slice(1)) {
    const state = classifyPointInRing(point, hole);
    if (state === 0) return true;
    if (state === 1) return false;
  }
  return true;
}

export function segmentInPolygon(a, b, rings) {
  if (!pointInPolygon(a, rings) || !pointInPolygon(b, rings)) return false;
  const cuts = [0, 1];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) cuts.push(...intersectionParameters(a, b, ring[i - 1], ring[i]));
  }
  cuts.sort((x, y) => x - y);
  // Membership cannot change between boundary intersections. Checking every
  // interval also detects narrow concavities that fixed sampling would miss.
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] > cuts[i - 1] && !pointInPolygon(interpolate(a, b, (cuts[i] + cuts[i - 1]) / 2), rings)) return false;
  }
  return true;
}

export function pathTopologyError(positions, closed) {
  const edgeCount = positions.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    if (Math.hypot(...minus(positions[i + 1], positions[i])) <= EPS) return 'Последовательные точки должны различаться';
  }
  // Consecutive collinear edges may continue forward, but cannot fold back.
  const vertexCount = closed ? edgeCount : edgeCount - 1;
  for (let i = 0; i < vertexCount; i++) {
    const a = positions[i];
    const b = positions[i + 1];
    const c = positions[(i + 2) % edgeCount];
    const next = closed ? c : positions[i + 2];
    const ab = minus(b, a);
    const bc = minus(next, b);
    if (Math.abs(cross(ab, bc)) <= EPS * Math.hypot(...ab)
      && ab[0] * bc[0] + ab[1] * bc[1] < 0) return 'Контур не должен проходить обратно по тому же участку';
  }
  for (let i = 0; i < edgeCount; i++) {
    for (let j = i + 2; j < edgeCount; j++) {
      if (closed && i === 0 && j === edgeCount - 1) continue;
      if (intersectionParameters(positions[i], positions[i + 1], positions[j], positions[j + 1]).length) {
        return 'Линия или граница зоны не должна пересекать или касаться самой себя';
      }
    }
  }
  if (closed) {
    // Translate before summing to preserve precision for small local zones.
    const origin = positions[0];
    let twiceArea = 0;
    for (let i = 1; i < edgeCount; i++) twiceArea += cross(minus(positions[i], origin), minus(positions[i + 1], origin));
    if (Math.abs(twiceArea) <= 2e-12) return 'Зона должна иметь ненулевую площадь';
  }
  return null;
}

export function geometryInPolygon(geometry, rings) {
  if (geometry.type === 'Point') return pointInPolygon(geometry.coordinates, rings);
  const positions = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates;
  for (let i = 1; i < positions.length; i++) {
    if (!segmentInPolygon(positions[i - 1], positions[i], rings)) return false;
  }
  // A simple polygon with all edges inside a hole-free polygon is contained.
  // If a future boundary has holes, also forbid enclosing a whole hole.
  if (geometry.type === 'Polygon') {
    for (const hole of rings.slice(1)) {
      if (hole.some((p) => classifyPointInRing(p, positions) === 1)) return false;
      for (let i = 1; i < hole.length; i++) {
        if (classifyPointInRing(interpolate(hole[i - 1], hole[i], 0.5), positions) === 1) return false;
      }
      // Coincident rings can have every vertex/midpoint on the boundary and
      // still enclose excluded land. Take a scanline strictly between vertex
      // latitudes to obtain an interior witness for that remaining case.
      const latitudes = [...new Set(hole.map((p) => p[1]))].sort((a, b) => a - b);
      const y = (latitudes[0] + latitudes[1]) / 2;
      const crossings = [];
      for (let i = 1; i < hole.length; i++) {
        const a = hole[i - 1];
        const b = hole[i];
        if ((a[1] > y) !== (b[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      crossings.sort((a, b) => a - b);
      if (crossings.length >= 2 && classifyPointInRing([(crossings[0] + crossings[1]) / 2, y], positions) === 1) return false;
    }
  }
  return true;
}
