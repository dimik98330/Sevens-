"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  createMapSession,
  type MapEditorState,
  type MapSession,
} from "./map-session";
import {
  geometrySummary,
  type DrawingMode,
  type LocationGeometry,
} from "./geometry";
import "./location-map.css";
import { useTranslation } from "@/features/i18n/provider";

export type { LocationGeometry } from "./geometry";
export interface LocationMapProps {
  value: LocationGeometry | null;
  onChange?: (geometry: LocationGeometry | null) => void;
  onEditingChange?: (editing: boolean) => void;
  readOnly?: boolean;
  title?: string;
}

const TOOLS: Array<{ mode: DrawingMode; label: string; explanation: string }> =
  [
    {
      mode: "point",
      label: "Точка",
      explanation: "Нажмите на конкретное место: остановку, двор или здание.",
    },
    {
      mode: "linestring",
      label: "Участок",
      explanation:
        "Добавьте от 2 точек вдоль улицы. Чтобы завершить, ещё раз нажмите последнюю точку.",
    },
    {
      mode: "polygon",
      label: "Зона",
      explanation:
        "Добавьте от 3 вершин по границе. Чтобы замкнуть зону, нажмите первую точку.",
    },
  ];
const INITIAL: MapEditorState = {
  availability: "loading",
  reason: "",
  editing: false,
  drawing: null,
  draft: null,
  error: "",
};

/** Confirms a local selection only; persistence and text location belong to the enclosing idea form. */
export function LocationMap({
  value,
  onChange,
  onEditingChange,
  readOnly = false,
  title = "Место идеи",
}: LocationMapProps) {
  const { t: tr, intlLocale } = useTranslation();
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const session = useRef<MapSession | null>(null);
  const currentValue = useRef(value);
  const change = useRef(onChange);
  const editingChange = useRef(onEditingChange);
  currentValue.current = value;
  change.current = onChange;
  editingChange.current = onEditingChange;
  const [state, setState] = useState<MapEditorState>({
    ...INITIAL,
    draft: value,
  });
  const [attempt, setAttempt] = useState(0);
  const [clearWithoutMap, setClearWithoutMap] = useState(false);
  const key = process.env.NEXT_PUBLIC_DGIS_MAP_KEY?.trim();
  const viewOnly = readOnly || !onChange;

  useEffect(() => {
    if (!key || !container.current) {
      setState({
        ...INITIAL,
        availability: "unavailable",
        draft: currentValue.current,
        reason:
          "Карта 2ГИС пока недоступна. Укажите территорию и ориентир в текстовых полях.",
      });
      return;
    }
    const instance = createMapSession({
      container: container.current,
      key,
      value: currentValue.current,
      readOnly: viewOnly,
      onState: setState,
      onConfirm: (geometry) => change.current?.(geometry),
    });
    session.current = instance;
    return () => {
      session.current = null;
      instance.dispose();
    };
  }, [key, viewOnly, attempt]);

  useEffect(() => {
    session.current?.setValue(value);
  }, [value]);

  const pendingEditing =
    !viewOnly &&
    (state.editing ||
      (clearWithoutMap && Boolean(value) && state.availability === "unavailable"));

  useEffect(() => {
    editingChange.current?.(pendingEditing);
  }, [pendingEditing]);

  useEffect(() => {
    return () => editingChange.current?.(false);
  }, []);

  const ready = state.availability === "ready";
  const hint = state.drawing
    ? TOOLS.find((tool) => tool.mode === state.drawing)!.explanation
    : state.editing && state.draft
      ? "Перетащите точку или вершины. Нажмите середину отрезка, чтобы добавить вершину. Подтвердите место после изменений."
      : state.editing
        ? "Выбор будет очищен после подтверждения. Отмена вернёт прежнее место."
        : viewOnly
          ? "Место, указанное автором идеи."
          : "Выберите точку, участок улицы или зону. Место попадёт в идею после подтверждения.";

  return (
    <section className="location-map" aria-labelledby={`${id}-title`}>
      <div className="location-map__heading">
        <div>
          <span className="location-map__eyebrow">
            {tr(" ГЕОГРАФИЯ ИДЕИ / ОБЛАСТЬ АБАЙ ")}</span>
          <h3 tabIndex={-1} id={`${id}-title`}>
            {tr(title)}
          </h3>
        </div>
        <span className="location-map__provider">{tr("2ГИС")}</span>
      </div>
      {!viewOnly && (
        <div
          className="location-map__tools"
          role="group"
          aria-label={tr("Способ выбора места")}
        >
          {TOOLS.map((tool) => (
            <button
              type="button"
              key={tool.mode}
              aria-pressed={state.drawing === tool.mode}
              disabled={!ready}
              onClick={() => session.current?.begin(tool.mode)}
            >
              {tr(tool.label)}
            </button>
          ))}
          <button
            type="button"
            disabled={!ready || !state.draft || Boolean(state.drawing)}
            onClick={() => session.current?.edit()}
          >
            {tr(" Редактировать ")}</button>
          <button
            type="button"
            disabled={!ready || (!state.draft && !state.drawing)}
            onClick={() => session.current?.clear()}
          >
            {tr(" Очистить ")}</button>
        </div>
      )}
      <div
        className={`location-map__viewport${ready ? " location-map__viewport--ready" : ""}`}
      >
        <div
          ref={container}
          className="location-map__canvas"
          role="region"
          aria-label={tr("Карта 2ГИС. Выбор места идеи")}
          aria-describedby={`${id}-hint`}
          aria-hidden={!ready}
        />
        {state.availability !== "ready" && (
          <div className="location-map__fallback" role="status">
            <svg
              viewBox="0 0 48 48"
              width="44"
              height="44"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m6 12 12-5 12 5 12-5v29l-12 5-12-5-12 5V12Z M18 7v29 M30 12v29"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle
                cx="25"
                cy="23"
                r="5"
                fill="var(--surface, #f5f2ec)"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="m29 27 6 6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <strong>
              {state.availability === "loading"
                ? tr("Загружаем карту 2ГИС…")
                : viewOnly
                  ? tr("Карта временно недоступна")
                  : tr("Можно указать место текстом")}
            </strong>
            <p>
              {state.availability === "loading"
                ? tr("Карта появится после загрузки.")
                : viewOnly
                  ? tr("Не удалось отобразить карту 2ГИС. Данные выбранного места не изменены.")
                  : state.reason}
            </p>
            {state.availability === "unavailable" && key && (
              <button
                type="button"
                onClick={() => {
                  setClearWithoutMap(false);
                  setAttempt((n) => n + 1);
                }}
              >
                {tr(" Повторить загрузку ")}</button>
            )}
          </div>
        )}
      </div>
      <div className="location-map__footer">
        <p className="location-map__selection" role="status">
          {geometrySummary(state.editing ? state.draft : value)}
        </p>
        <p className="location-map__hint" id={`${id}-hint`}>
          {ready
            ? hint
            : value
              ? tr("Выбранная геометрия не изменится из-за ошибки карты.")
              : tr("Текстовое описание места доступно независимо от карты.")}
        </p>
        {ready && (
          <p className="location-map__gesture">
            {tr(" На телефоне перемещайте карту двумя пальцами. Одним пальцем можно прокручивать форму. ")}</p>
        )}
        {state.error && (
          <p className="location-map__error" role="alert">
            {tr(state.error)}
          </p>
        )}
        {!ready &&
          state.availability === "unavailable" &&
          value &&
          !viewOnly && (
            <div className="location-map__actions">
              {clearWithoutMap ? (
                <>
                  <p>
                    {tr(" Убрать выбранное выделение? Текстовое описание места сохранится. ")}</p>
                  <button
                    type="button"
                    onClick={() => {
                      onChange?.(null);
                      setClearWithoutMap(false);
                      document.getElementById(`${id}-title`)?.focus();
                    }}
                  >
                    {tr(" Убрать выделение ")}</button>
                  <button
                    type="button"
                    onClick={() => setClearWithoutMap(false)}
                  >
                    {tr(" Отменить ")}</button>
                </>
              ) : (
                <button type="button" onClick={() => setClearWithoutMap(true)}>
                  {tr(" Убрать выделение без карты ")}</button>
              )}
            </div>
          )}
        {ready && state.editing && !viewOnly && (
          <div className="location-map__actions">
            <button
              type="button"
              className="location-map__confirm"
              disabled={Boolean(state.drawing || state.error)}
              onClick={() => session.current?.confirm()}
            >
              {tr(" Подтвердить место ")}</button>
            <button type="button" onClick={() => session.current?.cancel()}>
              {tr(" Отменить ")}</button>
          </div>
        )}
      </div>
    </section>
  );
}
