import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as terra from "terra-draw";
import type { TerraDrawExtend, TerraDrawMouseEvent } from "terra-draw";
import { createMapSession, type MapEditorState, type MapSession } from "@/components/location/map-session";
import { geometryBounds, readGeometry, type LocationGeometry } from "@/components/location/geometry";

const point: LocationGeometry = { type: "Point", coordinates: [80.25, 50.41] };
const sessions: MapSession[] = [];
const maps: TestMap[] = [];
const adapters: TestAdapter[] = [];
const controls: TestZoomControl[] = [];

class TestZoomControl {
  buttons = [{ setAttribute: vi.fn() }, { setAttribute: vi.fn() }];
  destroy = vi.fn();
  constructor(_map: TestMap, _options: { position: string }) { controls.push(this); }
  getContainer() { return { querySelectorAll: () => this.buttons }; }
}

class TestMap {
  handlers = new Map<string, Set<(event: unknown) => void>>();
  fitBounds = vi.fn();
  destroy = vi.fn();
  constructor() { maps.push(this); }
  on(event: string, callback: (event: unknown) => void) {
    const listeners = this.handlers.get(event) ?? new Set();
    listeners.add(callback); this.handlers.set(event, listeners);
  }
  off(event: string, callback: (event: unknown) => void) { this.handlers.get(event)?.delete(callback); }
  emit(event: string, payload: unknown = {}) { this.handlers.get(event)?.forEach((callback) => callback(payload)); }
}

// The drawing modes use the installed TerraDraw. Only rendering and browser events are replaced.
class TestAdapter {
  callbacks?: TerraDrawExtend.TerraDrawCallbacks;
  unregister = vi.fn();
  render = vi.fn();
  setCursor = vi.fn();
  setDoubleClickToZoom = vi.fn();
  constructor() { adapters.push(this); }
  project(lng: number, lat: number) { return { x: lng * 1000, y: lat * 1000 }; }
  unproject(x: number, y: number) { return { lng: x / 1000, lat: y / 1000 }; }
  getLngLatFromEvent() { return null; }
  getMapEventElement() { return {} as HTMLElement; }
  register(callbacks: TerraDrawExtend.TerraDrawCallbacks) { this.callbacks = callbacks; callbacks.onReady?.(); }
  clear() { this.callbacks?.onClear(); }
  getCoordinatePrecision() { return 6; }
  click(lng: number, lat: number) {
    const event: TerraDrawMouseEvent = { lng, lat, containerX: lng * 1000, containerY: lat * 1000, button: "left", heldKeys: [], isContextMenu: false };
    this.callbacks!.onMouseMove(event);
    this.callbacks!.onClick(event);
  }
  drag(from: [number, number], to: [number, number]) {
    const event = ([lng, lat]: [number, number]): TerraDrawMouseEvent => ({ lng, lat, containerX: lng * 1000, containerY: lat * 1000, button: "left", heldKeys: [], isContextMenu: false });
    this.callbacks!.onDragStart(event(from), () => {});
    this.callbacks!.onDrag(event(to), () => {});
    this.callbacks!.onDragEnd(event(to), () => {});
  }
}

type Loader = NonNullable<Parameters<typeof createMapSession>[1]>;
const libraries = { mapgl: { Map: TestMap, ZoomControl: TestZoomControl, isSupported: () => true }, terra, adapter: { TerraDrawMapGlAdapter: TestAdapter } };
const load: Loader = async () => libraries as unknown as Awaited<ReturnType<Loader>>;

async function setup(value: LocationGeometry | null = point, readOnly = false, loader = load) {
  const states: MapEditorState[] = [];
  const onConfirm = vi.fn();
  const session = createMapSession({ container: {} as HTMLElement, key: "synthetic-test-key", value, readOnly,
    onState: (state) => states.push(state), onConfirm }, loader);
  sessions.push(session);
  await Promise.resolve();
  const map = maps.at(-1);
  if (map) { map.emit("styleload"); map.emit("idle"); }
  return { session, states, onConfirm, map: map!, adapter: adapters.at(-1)!, state: () => states.at(-1)! };
}

beforeEach(() => { vi.stubGlobal("window", new EventTarget()); });
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  maps.splice(0); adapters.splice(0); controls.splice(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("2GIS location selection transactions (mock renderer, real TerraDraw)", () => {
  it("labels and disposes the owned SDK zoom control", async () => {
    const test = await setup();
    expect(test.state().availability).toBe("ready");
    expect(controls).toHaveLength(1);
    expect(controls[0]!.buttons[0]!.setAttribute).toHaveBeenCalledWith("aria-label", "Приблизить карту");
    expect(controls[0]!.buttons[1]!.setAttribute).toHaveBeenCalledWith("aria-label", "Отдалить карту");
    test.session.dispose();
    expect(controls[0]!.destroy).toHaveBeenCalledTimes(1);
  });
  it("keeps saved geometry unchanged until confirm and restores it on cancel", async () => {
    const test = await setup();
    expect(test.state().availability).toBe("ready");
    test.session.begin("point");
    test.adapter.click(80.3, 50.5);
    await Promise.resolve();
    expect(test.state().draft).toEqual({ type: "Point", coordinates: [80.3, 50.5] });
    expect(test.onConfirm).not.toHaveBeenCalled();
    test.session.cancel();
    expect(test.state().draft).toEqual(point);
    expect(test.state().editing).toBe(false);
    expect(test.onConfirm).not.toHaveBeenCalled();
  });

  it.each(["linestring", "polygon"] as const)("finishes %s with a single tap on a closing vertex", async (mode) => {
    const test = await setup(null);
    test.session.begin(mode);
    test.adapter.click(80.2, 50.4);
    test.adapter.click(80.3, 50.4);
    test.session.confirm();
    expect(test.onConfirm).not.toHaveBeenCalled();
    if (mode === "polygon") {
      test.adapter.click(80.3, 50.5);
      test.adapter.click(80.2, 50.4);
    } else { test.adapter.click(80.3, 50.4); }
    await Promise.resolve();
    expect(test.state().drawing).toBe(null);
    expect(test.state().draft?.type).toBe(mode === "polygon" ? "Polygon" : "LineString");
    test.session.confirm();
    expect(test.onConfirm).toHaveBeenCalledTimes(1);
    expect(readGeometry(test.onConfirm.mock.calls[0]![0])).not.toBeNull();
  });

  it("clear is reversible and emits null only after confirmation", async () => {
    const test = await setup();
    test.session.clear();
    expect(test.state().draft).toBeNull();
    expect(test.onConfirm).not.toHaveBeenCalled();
    test.session.cancel();
    expect(test.state().draft).toEqual(point);
    test.session.clear(); test.session.confirm();
    expect(test.onConfirm).toHaveBeenCalledWith(null);
  });

  it("edits an existing point and confirms its new coordinates", async () => {
    const test = await setup();
    test.session.edit();
    test.adapter.drag([80.25, 50.41], [80.35, 50.51]);
    await Promise.resolve();
    expect(test.state().draft).toEqual({ type: "Point", coordinates: [80.35, 50.51] });
    expect(test.onConfirm).not.toHaveBeenCalled();
    test.session.confirm();
    expect(test.onConfirm).toHaveBeenCalledWith({ type: "Point", coordinates: [80.35, 50.51] });
  });

  it("rejects a self-intersecting polygon and allows cancellation to the old point", async () => {
    const test = await setup();
    test.session.begin("polygon");
    for (const [lng, lat] of [[80.2, 50.4], [80.4, 50.6], [80.2, 50.6], [80.4, 50.4]]) test.adapter.click(lng!, lat!);
    expect(test.state().error).toContain("пересекает");
    test.session.confirm();
    expect(test.onConfirm).not.toHaveBeenCalled();
    test.session.cancel();
    expect(test.state().draft).toEqual(point);
    expect(test.state().error).toBe("");
  });

  it("updates controlled values without reconstructing the map or disturbing equal-value edits", async () => {
    const test = await setup();
    test.session.begin("point"); test.adapter.click(80.3, 50.5);
    await Promise.resolve();
    test.session.setValue(structuredClone(point));
    expect(test.state().editing).toBe(true);
    const changed: LocationGeometry = { type: "LineString", coordinates: [[80.1, 50.3], [80.4, 50.6]] };
    test.session.setValue(changed);
    expect(test.state().draft).toEqual(changed);
    expect(test.state().editing).toBe(false);
    expect(maps).toHaveLength(1);
    expect(test.map.fitBounds).toHaveBeenLastCalledWith(geometryBounds(changed), expect.objectContaining({ maxZoom: 17 }));
  });

  it("read-only view fits the geometry and rejects all editing actions", async () => {
    const test = await setup(point, true);
    test.session.begin("polygon"); test.session.edit(); test.session.clear(); test.session.confirm();
    expect(test.state().draft).toEqual(point);
    expect(test.onConfirm).not.toHaveBeenCalled();
    expect(test.map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it.each(["invalidtilekey", "rasterTileLoadError", "webglcontextlost"])("reports %s as unavailable and keeps the saved choice", async (type) => {
    const test = await setup();
    test.session.begin("polygon");
    test.map.emit("error", { type });
    expect(test.state().availability).toBe("unavailable");
    expect(test.state().draft).toEqual(point);
    expect(test.map.destroy).toHaveBeenCalledTimes(1);
    expect(test.onConfirm).not.toHaveBeenCalled();
    expect([...test.map.handlers.values()].every((callbacks) => callbacks.size === 0)).toBe(true);
  });

  it("does not construct a map when unmounted before SDK loading completes", async () => {
    let resolve!: (result: Awaited<ReturnType<Loader>>) => void;
    const pending: Loader = () => new Promise((done) => { resolve = done; });
    const test = await setup(point, false, pending);
    test.session.dispose();
    resolve(libraries as unknown as Awaited<ReturnType<Loader>>);
    await Promise.resolve();
    expect(maps).toHaveLength(0);
    expect(test.states).toHaveLength(1);
  });

  it("times out a pending SDK and ignores its eventual completion", async () => {
    vi.useFakeTimers();
    let resolve!: (result: Awaited<ReturnType<Loader>>) => void;
    const test = await setup(point, false, () => new Promise((done) => { resolve = done; }));
    vi.advanceTimersByTime(20_001);
    expect(test.state().availability).toBe("unavailable");
    resolve(libraries as unknown as Awaited<ReturnType<Loader>>);
    await Promise.resolve();
    expect(maps).toHaveLength(0);
  });

  it("rejects SDK failure without an unhandled rejection", async () => {
    const test = await setup(point, false, async () => { throw new Error("network unavailable"); });
    await Promise.resolve();
    expect(test.state().availability).toBe("unavailable");
    expect(maps).toHaveLength(0);
  });
});

describe("geometry boundary", () => {
  it("rejects nonfinite coordinates, unclosed rings, holes and excess vertices", () => {
    expect(readGeometry({ type: "Point", coordinates: [Infinity, 50] })).toBeNull();
    expect(readGeometry({ type: "Point", coordinates: [80, 91] })).toBeNull();
    expect(readGeometry({ type: "Polygon", coordinates: [[[80, 50], [81, 50], [81, 51], [80, 51]]] })).toBeNull();
    const ring = [[80, 50], [81, 50], [81, 51], [80, 50]];
    expect(readGeometry({ type: "Polygon", coordinates: [ring, ring] })).toBeNull();
    expect(readGeometry({ type: "LineString", coordinates: Array.from({ length: 129 }, () => [80, 50]) })).toBeNull();
  });
});
