import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateLocationGeometry } from '../../../src/server/geo/location.mjs';
import { classifyPointInRing, geometryInPolygon, pointInPolygon, segmentInPolygon } from '../../../src/server/geo/geometry.mjs';

const point = { type: 'Point', coordinates: [80.249, 50.411] };
const ring = [[80.249, 50.411], [80.26, 50.411], [80.26, 50.42], [80.249, 50.42], [80.249, 50.411]];
const source = JSON.parse(readFileSync(new URL('../../../src/server/geo/abai-boundary.json', import.meta.url), 'utf8'));

describe('B-05 strict location geometry', () => {
  it('retains the complete licensed source contour in runtime', () => {
    const original = readFileSync(new URL('../../../docs/design/geodata/abai.geojson', import.meta.url));
    const runtime = readFileSync(new URL('../../../src/server/geo/abai-boundary.json', import.meta.url));
    expect(runtime.equals(original)).toBe(true);
    expect(createHash('sha256').update(runtime).digest('hex')).toBe('a3ca5dc019e1ae9a0a4e65270fce8012ca069058c1fd2837a11ffcddbd72061e');
    expect(source.geometry.coordinates[0]).toHaveLength(7374);
  });

  it.each([
    null, point,
    { type: 'LineString', coordinates: ring.slice(0, 3) },
    { type: 'Polygon', coordinates: [ring] },
    { type: 'Polygon', coordinates: [[...ring].reverse()] },
    { type: 'Point', coordinates: source.geometry.coordinates[0][0] },
    { type: 'LineString', coordinates: source.geometry.coordinates[0].slice(0, 2) },
  ])('accepts supported contained geometry including the boundary: %j', (geometry) => {
    expect(validateLocationGeometry(geometry)).toEqual(geometry);
  });

  it('accepts the documented maximum complexity', () => {
    const circle = Array.from({ length: 128 }, (_, i) => [80.249 + .001 * Math.cos(i * Math.PI / 64), 50.411 + .001 * Math.sin(i * Math.PI / 64)]);
    expect(validateLocationGeometry({ type: 'LineString', coordinates: circle })).toBeTruthy();
    expect(validateLocationGeometry({ type: 'Polygon', coordinates: [[...circle, circle[0]]] })).toBeTruthy();
  });

  const bad = [
    undefined, 0, [], {}, { ...point, bbox: [] },
    { type: 'Feature', geometry: point }, { type: 'MultiPoint', coordinates: [point.coordinates] },
    { type: 'Point', coordinates: [80, 50, 2] }, { type: 'Point', coordinates: ['80', 50] },
    { type: 'Point', coordinates: [NaN, 50] }, { type: 'Point', coordinates: [80, Infinity] },
    { type: 'Point', coordinates: [-Infinity, 50] }, { type: 'Point', coordinates: [null, 50] },
    { type: 'Point', coordinates: [181, 50] }, { type: 'Point', coordinates: [80, 91] },
    { type: 'Point', coordinates: [50.411, 80.249] },
    { type: 'LineString', coordinates: [[80.249, 50.411]] },
    { type: 'LineString', coordinates: [[80.249, 50.411], [80.249, 50.411]] },
    { type: 'LineString', coordinates: Array.from({ length: 129 }, (_, i) => [80.249 + i / 10000, 50.411]) },
    { type: 'Polygon', coordinates: [] }, { type: 'Polygon', coordinates: [ring, ring] },
    { type: 'Polygon', coordinates: [ring.slice(0, 4)] },
    { type: 'Polygon', coordinates: [[...Array.from({ length: 129 }, (_, i) => [80.249 + .001 * Math.cos(i * Math.PI * 2 / 129), 50.411 + .001 * Math.sin(i * Math.PI * 2 / 129)]), [80.25, 50.411]]] },
    { type: 'Polygon', coordinates: [[[80.24, 50.41], [80.25, 50.41], [80.26, 50.41], [80.24, 50.41]]] },
    { type: 'Polygon', coordinates: [[[80.24, 50.41], [80.26, 50.43], [80.24, 50.43], [80.26, 50.41], [80.24, 50.41]]] },
    { type: 'Polygon', coordinates: [[...ring.slice(0, 3), ring[1], ...ring.slice(3)]] },
    { type: 'LineString', coordinates: [[80.24, 50.41], [80.26, 50.41], [80.25, 50.41]] },
    { type: 'LineString', coordinates: [[80.24, 50.41], [80.26, 50.43], [80.24, 50.43], [80.26, 50.41]] },
  ];
  it.each(bad.map((geometry, index) => [index, geometry] as const))('rejects malformed/degenerate input #%i with a field error', (_, geometry) => {
    expect(() => validateLocationGeometry(geometry)).toThrowError(expect.objectContaining({
      code: 'VALIDATION_ERROR', fields: { locationGeometry: expect.any(String) },
    }));
  });

  it('rejects a point inside the bbox but outside the original region', () => {
    expect(() => validateLocationGeometry({ type: 'Point', coordinates: [82.611, 49.948] })).toThrow(/место/);
  });

  it('rejects a real Abai boundary chord that goes outside between accepted endpoints', () => {
    const chord = [[76.56013, 49.4136885], [76.584581, 49.3768896]];
    for (const coordinates of chord) {
      expect(classifyPointInRing(coordinates, source.geometry.coordinates[0])).toBe(1);
      expect(validateLocationGeometry({ type: 'Point', coordinates })).toBeTruthy();
    }
    expect(() => validateLocationGeometry({ type: 'LineString', coordinates: chord })).toThrow(/место/);
  });
});

describe('B-05 entire segment and area containment', () => {
  const concave = [[[0, 0], [8, 0], [8, 8], [6, 8], [6, 2], [5, 2], [5, 8], [3, 8], [3, 2], [2, 2], [2, 8], [0, 8], [0, 0]]];
  it('rejects leave/re-enter segments even if endpoints and midpoint are inside', () => {
    for (const p of [[1, 6], [4, 6], [7, 6]]) expect(pointInPolygon(p, concave)).toBe(true);
    expect(segmentInPolygon([1, 6], [7, 6], concave)).toBe(false);
  });
  it('rejects a zone whose vertices are inside but an edge crosses a concavity', () => {
    expect(geometryInPolygon({ type: 'Polygon', coordinates: [[[1, 6], [7, 6], [4, 1], [1, 6]]] }, concave)).toBe(false);
  });
  it('accepts collinear boundary edges and vertex touches without expanding the region', () => {
    expect(segmentInPolygon([0, 0], [8, 0], concave)).toBe(true);
    expect(segmentInPolygon([1, 2], [7, 2], concave)).toBe(true);
    expect(segmentInPolygon([1, 2.000001], [7, 2.000001], concave)).toBe(false);
  });
  it('does not let a contained polygon surround excluded region holes', () => {
    const holed = [[[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]], [[3, 3], [3, 5], [5, 5], [5, 3], [3, 3]]];
    expect(pointInPolygon([4, 4], holed)).toBe(false);
    expect(pointInPolygon([3, 4], holed)).toBe(true);
    expect(segmentInPolygon([1, 4], [7, 4], holed)).toBe(false);
    expect(geometryInPolygon({ type: 'Polygon', coordinates: [[[1, 1], [7, 1], [7, 7], [1, 7], [1, 1]]] }, holed)).toBe(false);
    expect(geometryInPolygon({ type: 'Polygon', coordinates: [holed[1]] }, holed)).toBe(false);
  });
});
