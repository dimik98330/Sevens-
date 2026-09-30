import type { Map as MapGLMap } from "@2gis/mapgl/types";
import type {
  GeoJSONStoreFeatures,
  TerraDraw,
  TerraDrawEventListeners,
} from "terra-draw";
import {
  geometryBounds,
  geometryMode,
  readGeometry,
  type DrawingMode,
  type LocationGeometry,
} from "./geometry";

export type MapAvailability = "loading" | "ready" | "unavailable";
export interface MapEditorState {
  availability: MapAvailability;
  reason: string;
  editing: boolean;
  drawing: DrawingMode | null;
  draft: LocationGeometry | null;
  error: string;
}
export interface MapSession {
  setValue(value: LocationGeometry | null): void;
  begin(mode: DrawingMode): void;
  edit(): void;
  clear(): void;
  cancel(): void;
  confirm(): void;
  dispose(): void;
}

async function loadLibraries() {
  const [loader, terra, adapter] = await Promise.all([
    import("@2gis/mapgl"),
    import("terra-draw"),
    import("@2gis/mapgl-terra-draw"),
  ]);
  return { mapgl: await loader.load(), terra, adapter };
}

interface SessionOptions {
  container: HTMLElement;
  key: string;
  value: LocationGeometry | null;
  readOnly: boolean;
  onState(state: MapEditorState): void;
  onConfirm(value: LocationGeometry | null): void;
}

/** Only the SDK loader is injectable, so lifecycle/transaction tests can run without a public key. */
export function createMapSession(
  options: SessionOptions,
  load = loadLibraries,
): MapSession {
  let active = true;
  let map: MapGLMap | undefined;
  let draw: TerraDraw | undefined;
  let selectedId: string | number | undefined;
  let mutating = false;
  let receivedTiles = false;
  let saved = readGeometry(options.value);
  let state: MapEditorState = {
    availability: "loading",
    reason: "",
    editing: false,
    drawing: null,
    draft: saved,
    error: "",
  };
  const cleanups: Array<() => void> = [];

  function publish(changes: Partial<MapEditorState>) {
    if (!active) return;
    state = { ...state, ...changes };
    options.onState({ ...state, draft: readGeometry(state.draft) });
  }

  function destroyMap() {
    for (const cleanup of cleanups.splice(0)) cleanup();
    try {
      draw?.stop();
    } finally {
      draw = undefined;
      map?.destroy();
      map = undefined;
    }
  }

  function unavailable(reason: string) {
    if (!active || state.availability === "unavailable") return;
    clearTimeout(timer);
    publish({
      availability: "unavailable",
      reason,
      editing: false,
      drawing: null,
      draft: saved,
      error: "",
    });
    destroyMap();
  }

  const timer = setTimeout(
    () =>
      unavailable(
        "Карта 2ГИС не ответила. Проверьте подключение или укажите место текстом.",
      ),
    20_000,
  );
  const offline = () =>
    unavailable(
      "Нет соединения с интернетом. Укажите место текстом или повторите загрузку карты.",
    );
  window.addEventListener("offline", offline);
  cleanups.push(() => window.removeEventListener("offline", offline));

  function showGeometry(value: LocationGeometry | null, fit = false) {
    if (!draw) return;
    mutating = true;
    try {
      draw.setMode("static");
      draw.clear();
      selectedId = undefined;
      if (value) {
        const id = draw.getFeatureId();
        const result = draw.addFeatures([
          {
            type: "Feature",
            id,
            geometry: value,
            properties: { mode: geometryMode(value) },
          },
        ]);
        if (result.some((item) => !item.valid))
          throw new Error("Geometry rejected by drawing library");
        selectedId = id;
        if (fit)
          map?.fitBounds(geometryBounds(value), {
            padding: { top: 48, right: 40, bottom: 48, left: 40 },
            maxZoom: value.type === "Point" ? 16 : 17,
            animation: { animate: false },
          });
      }
    } finally {
      mutating = false;
    }
  }

  function canEdit() {
    return (
      active &&
      state.availability === "ready" &&
      !options.readOnly &&
      Boolean(draw)
    );
  }

  const session: MapSession = {
    setValue(value) {
      if (!active || JSON.stringify(value) === JSON.stringify(saved)) return;
      saved = readGeometry(value);
      showGeometry(saved, true);
      publish({ draft: saved, editing: false, drawing: null, error: "" });
    },
    begin(mode) {
      if (!canEdit()) return;
      showGeometry(null);
      publish({ editing: true, drawing: mode, draft: null, error: "" });
      draw!.setMode(mode);
    },
    edit() {
      if (!canEdit() || !state.draft || selectedId === undefined) return;
      publish({ editing: true, drawing: null, error: "" });
      draw!.selectFeature(selectedId);
    },
    clear() {
      if (!canEdit()) return;
      showGeometry(null);
      publish({ editing: true, drawing: null, draft: null, error: "" });
    },
    cancel() {
      if (!canEdit()) return;
      showGeometry(saved);
      publish({ editing: false, drawing: null, draft: saved, error: "" });
    },
    confirm() {
      if (!canEdit() || !state.editing || state.drawing || state.error) return;
      saved = readGeometry(state.draft);
      showGeometry(saved);
      publish({ editing: false, draft: saved });
      options.onConfirm(readGeometry(saved));
    },
    dispose() {
      active = false;
      clearTimeout(timer);
      destroyMap();
    },
  };

  publish({});
  void load()
    .then(({ mapgl, terra, adapter }) => {
      if (!active || state.availability === "unavailable") return;
      if (!mapgl.isSupported()) {
        unavailable(
          "Браузер не поддерживает карту 2ГИС. Укажите место текстом.",
        );
        return;
      }
      map = new mapgl.Map(options.container, {
        key: options.key,
        center: [80.249, 50.411],
        zoom: 12,
        lang: "ru",
        enableTrackResize: true,
        // Keep ordinary page scrolling available; touch panning uses two fingers.
        disableDragging: window.matchMedia?.("(pointer: coarse)").matches ?? false,
        enableTwoFingerDragging: true,
        disableZoomOnScroll: true,
        disablePitchByUserInteraction: true,
        disableRotationByUserInteraction: true,
        zoomControl: false,
        scaleControl: "bottomLeft",
        floorControl: false,
      });
      // Own the native control so labels cannot touch attribution or other buttons.
      const zoomControl = new mapgl.ZoomControl(map, { position: "topRight" });
      cleanups.push(() => zoomControl.destroy());
      const zoomButtons = zoomControl.getContainer().querySelectorAll("button");
      // The SDK's ZoomControl contains zoom-in followed by zoom-out.
      if (zoomButtons.length === 2) {
        ["Приблизить карту", "Отдалить карту"].forEach((label, index) => {
          zoomButtons[index]!.setAttribute("aria-label", label);
          zoomButtons[index]!.setAttribute("title", label);
        });
      }
      const ready = () => {
        if (draw && receivedTiles && state.availability === "loading") {
          clearTimeout(timer);
          publish({ availability: "ready" });
        }
      };
      const idle = () => {
        receivedTiles = true;
        ready();
      };
      const error = (event: { type: string }) =>
        unavailable(
          event.type === "invalidtilekey"
            ? "2ГИС отклонил доступ к карте. Укажите место текстом."
            : event.type === "webglcontextlost"
              ? "Отображение карты прервано. Повторите загрузку или укажите место текстом."
              : "Не удалось загрузить карту 2ГИС. Укажите место текстом или повторите загрузку.",
        );
      const styleError = () =>
        unavailable(
          "Не удалось загрузить оформление карты 2ГИС. Укажите место текстом.",
        );
      const style = () => {
        if (!active || !map || draw || state.availability === "unavailable")
          return;
        try {
          const validate = (
            feature: GeoJSONStoreFeatures,
            context: { updateType: string },
          ) => {
            if (
              context.updateType !== "finish" &&
              context.updateType !== "commit"
            )
              return { valid: true };
            const geometry = readGeometry(feature.geometry);
            if (!geometry) {
              publish({
                error:
                  "Участок: от 2 до 128 точек. Зона: от 3 до 128 вершин, один замкнутый контур.",
              });
              return {
                valid: false,
                reason: "Unsupported geometry or complexity limit exceeded",
              };
            }
            const result =
              feature.geometry.type === "Point"
                ? { valid: true }
                : terra.ValidateNotSelfIntersecting(feature);
            publish({
              error: result.valid
                ? ""
                : "Контур пересекает сам себя. Измените вершины или начните заново.",
            });
            return result;
          };
          const editableCoordinates = {
            draggable: true,
            coordinates: { draggable: true, midpoints: true, deletable: true },
            validation: validate,
          };
          draw = new terra.TerraDraw({
            adapter: new adapter.TerraDrawMapGlAdapter({
              map,
              mapgl,
              coordinatePrecision: 6,
              style: {
                fillColor: "#9c654333",
                outlineColor: "#965333",
                outlineWidth: 3,
                pointCap: "round",
              },
            }),
            modes: [
              new terra.TerraDrawPointMode({ validation: validate }),
              new terra.TerraDrawLineStringMode({
                pointerDistance: 24,
                validation: validate,
                keyEvents: null,
              }),
              new terra.TerraDrawPolygonMode({
                pointerDistance: 24,
                validation: validate,
                keyEvents: null,
              }),
              new terra.TerraDrawSelectMode({
                pointerDistance: 24,
                keyEvents: null,
                flags: {
                  point: { feature: { draggable: true, validation: validate } },
                  linestring: { feature: editableCoordinates },
                  polygon: { feature: editableCoordinates },
                },
              }),
            ],
          });
          const change: TerraDrawEventListeners["change"] = () => {
            if (
              !active ||
              mutating ||
              !state.editing ||
              state.drawing ||
              selectedId === undefined
            )
              return;
            publish({
              draft: readGeometry(
                draw?.getSnapshotFeature(selectedId)?.geometry,
              ),
            });
          };
          const finish: TerraDrawEventListeners["finish"] = (id) => {
            if (!active || options.readOnly || mutating || !state.editing)
              return;
            const geometry = readGeometry(
              draw?.getSnapshotFeature(id)?.geometry,
            );
            if (!geometry) return;
            selectedId = id;
            publish({ draft: geometry, drawing: null, error: "" });
            // A mode must finish its own callback before select stops that mode.
            queueMicrotask(() => {
              if (!active || !draw || selectedId !== id || !state.editing)
                return;
              const extras = draw
                .getSnapshot()
                .filter(
                  (feature) =>
                    feature.id !== id && feature.properties.mode !== "select",
                )
                .map((feature) => feature.id!)
                .filter((other) => other !== undefined);
              if (extras.length) draw.removeFeatures(extras);
              draw.selectFeature(id);
            });
          };
          draw.on("finish", finish);
          draw.on("change", change);
          const instance = draw;
          cleanups.push(() => {
            instance.off("finish", finish);
            instance.off("change", change);
          });
          draw.start();
          showGeometry(saved, true);
          ready();
        } catch {
          unavailable(
            "Инструменты карты не загрузились. Укажите место текстом.",
          );
        }
      };
      map.on("styleload", style);
      map.on("styleloaderror", styleError);
      map.on("error", error);
      map.on("idle", idle);
      const instance = map;
      cleanups.push(() => {
        instance.off("styleload", style);
        instance.off("styleloaderror", styleError);
        instance.off("error", error);
        instance.off("idle", idle);
      });
    })
    .catch(() =>
      unavailable(
        "Не удалось подключиться к 2ГИС. Укажите место текстом или повторите загрузку.",
      ),
    );
  return session;
}
