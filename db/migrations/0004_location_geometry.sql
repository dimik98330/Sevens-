-- Backward compatible: old ideas retain SQL NULL; no extension or rewrite.
ALTER TABLE ideas ADD COLUMN location_geometry JSONB;

-- Envelope and storage guard. The API enforces coordinates, topology and
-- whole-shape inclusion in the versioned Abai boundary on draft and submit.
ALTER TABLE ideas ADD CONSTRAINT ideas_location_geometry_envelope CHECK (
  location_geometry IS NULL OR COALESCE((
    jsonb_typeof(location_geometry) = 'object'
    AND location_geometry->>'type' IN ('Point', 'LineString', 'Polygon')
    AND jsonb_typeof(location_geometry->'coordinates') = 'array'
    AND location_geometry - 'type' - 'coordinates' = '{}'::jsonb
    AND octet_length(location_geometry::text) <= 16384
  ), FALSE)
);

COMMENT ON COLUMN ideas.location_geometry IS
  'Optional GeoJSON Point/LineString/single-ring Polygon, WGS84 [longitude,latitude]; API validates against OSM Abai boundary. NULL leaves textual location usable.';
