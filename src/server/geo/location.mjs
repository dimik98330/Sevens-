import boundary from './abai-boundary.json' with { type: 'json' };
import { geometryInPolygon, pathTopologyError, samePosition } from './geometry.mjs';

export const MAX_LOCATION_VERTICES = 128;
const rings = boundary.geometry.coordinates;

function invalid(message) {
  const err = new Error('Проверьте место на карте');
  err.code = 'VALIDATION_ERROR';
  err.fields = { locationGeometry: message };
  throw err;
}

function position(value) {
  if (!Array.isArray(value) || value.length !== 2
    || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    invalid('Каждая точка должна содержать два конечных числа: долготу и широту');
  }
  if (value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) {
    invalid('Координаты вне допустимого диапазона долготы или широты');
  }
}

// This is the authoritative API validator. The client may preflight input,
// but cannot select a different boundary or bypass topology / access checks.
export function validateLocationGeometry(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'type') || !Object.hasOwn(value, 'coordinates')
    || !['Point', 'LineString', 'Polygon'].includes(value.type)) {
    invalid('Укажите одну геометрию Point, LineString или Polygon с полями type и coordinates');
  }
  if (value.type === 'Point') {
    position(value.coordinates);
  } else {
    const closed = value.type === 'Polygon';
    if (closed && (!Array.isArray(value.coordinates) || value.coordinates.length !== 1)) {
      invalid('Зона должна содержать один внешний контур без внутренних колец');
    }
    const positions = closed ? value.coordinates[0] : value.coordinates;
    const min = closed ? 4 : 2;
    const max = closed ? MAX_LOCATION_VERTICES + 1 : MAX_LOCATION_VERTICES;
    if (!Array.isArray(positions) || positions.length < min || positions.length > max) {
      invalid(closed ? `Задайте от 3 до ${MAX_LOCATION_VERTICES} вершин и замкните зону`
        : `Участок должен содержать от 2 до ${MAX_LOCATION_VERTICES} точек`);
    }
    positions.forEach(position);
    if (closed && !samePosition(positions[0], positions.at(-1))) invalid('Контур зоны должен быть замкнут: первая и последняя точки совпадают');
    const topologyError = pathTopologyError(positions, closed);
    if (topologyError) invalid(topologyError);
  }
  if (!geometryInPolygon(value, rings)) invalid('Место должно целиком находиться в области Абай; проверьте точки и участки между ними');
  // Return a detached JSON shape so callers cannot mutate accepted data.
  return { type: value.type, coordinates: structuredClone(value.coordinates) };
}
