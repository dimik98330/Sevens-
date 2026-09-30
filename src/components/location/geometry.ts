/** GeoJSON uses [longitude, latitude]. Region/topology checks remain authoritative on the server. */
export type Position = [number, number];
export type LocationGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };

export type DrawingMode = "point" | "linestring" | "polygon";

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    Math.abs(value[0]) <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    Math.abs(value[1]) <= 90
  );
}

export function readGeometry(value: unknown): LocationGeometry | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    !("coordinates" in value)
  )
    return null;
  const { type, coordinates } = value;
  if (type === "Point" && isPosition(coordinates))
    return { type, coordinates: [...coordinates] };
  if (
    type === "LineString" &&
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    coordinates.length <= 128 &&
    coordinates.every(isPosition)
  ) {
    return { type, coordinates: coordinates.map((p) => [...p]) };
  }
  if (
    type === "Polygon" &&
    Array.isArray(coordinates) &&
    coordinates.length === 1
  ) {
    const ring: unknown = coordinates[0];
    if (
      !Array.isArray(ring) ||
      ring.length < 4 ||
      ring.length > 129 ||
      !ring.every(isPosition)
    )
      return null;
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) return null;
    return { type, coordinates: [ring.map((p) => [...p])] };
  }
  return null;
}

export function geometryMode(value: LocationGeometry): DrawingMode {
  return value.type === "Point"
    ? "point"
    : value.type === "LineString"
      ? "linestring"
      : "polygon";
}

export function geometryBounds(value: LocationGeometry) {
  const points =
    value.type === "Point"
      ? [value.coordinates]
      : value.type === "Polygon"
        ? value.coordinates[0]!
        : value.coordinates;
  return {
    southWest: [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
    ],
    northEast: [
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ],
  };
}

export function geometrySummary(value: LocationGeometry | null): string {
  const vertices = (count: number) => `${count} ${count % 100 >= 11 && count % 100 <= 14 ? "вершин" : count % 10 === 1 ? "вершина" : count % 10 >= 2 && count % 10 <= 4 ? "вершины" : "вершин"}`;
  if (!value) return "Место на карте не выбрано";
  if (value.type === "Point")
    return `Точка · ${value.coordinates[1].toFixed(5)}° с. ш., ${value.coordinates[0].toFixed(5)}° в. д.`;
  if (value.type === "LineString")
    return `Участок · ${vertices(value.coordinates.length)}`;
  return `Зона · ${vertices(value.coordinates[0]!.length - 1)}`;
}
