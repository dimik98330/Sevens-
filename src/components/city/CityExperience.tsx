"use client";
import dynamic from "next/dynamic";
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "@/components/ui/Icon";
import { useTranslation } from "@/features/i18n/provider";
const Scene = dynamic(() => import("./CityCanvas"), { ssr: false });
class SceneBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
export function CityExperience({initialModel=false,embedded=false}:{initialModel?:boolean;embedded?:boolean}={}) {
  const { t: tr, intlLocale } = useTranslation();
  const [active, setActive] = useState(0),
    [running, setRunning] = useState(false),
    [reduced, setReduced] = useState(true),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [exploring, setExploring] = useState(initialModel);
  const container = useRef<HTMLDivElement>(null);
  const onReady = useCallback(() => setReady(true), []),
    onError = useCallback(() => setFailed(true), []);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(motion.matches);
    update();
    motion.addEventListener("change", update);
    let visible = false;
    const visibility = () => setRunning(visible && !document.hidden);
    const observer = new IntersectionObserver(
      ([e]) => {
        visible = e?.isIntersecting ?? false;
        visibility();
      },
      { rootMargin: "100px" },
    );
    if (container.current) observer.observe(container.current);
    document.addEventListener("visibilitychange", visibility);
    if (new URLSearchParams(location.search).has("no3d")) setFailed(true);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <div
      className={`city-experience${exploring ? " is-exploring" : ""}`}
      ref={container}
    >
      {!embedded && <div className="city-coordinate">
        <span>
          <i />
          {tr(" SMART CITY / СЕМЕЙ / АБАЙ ")}</span>
        <button
          className="scene-toggle"
          type="button"
          onClick={() => setExploring((v) => !v)}
          aria-pressed={exploring}
        >
          {exploring ? tr("Вернуться к иллюстрации") : tr("Открыть 3D-модель")}
          <Icon name="layers" size={12} />
        </button>
      </div>}
      <div
        className="city-render"
        data-render={
          failed
            ? "fallback"
            : !exploring
              ? "illustration"
              : ready
                ? "webgl"
                : "loading"
        }
        role="img"
        aria-label={
          exploring
            ? tr("Интерактивная 3D-модель городского квартала")
            : tr("Иллюстрация городских идей: здания, река, мост, транспорт и зелёные зоны")
        }
      >
        {(!exploring || !ready || failed) && (
          <img
            className="city-fallback city-art"
            src="/sevens/city-illustration.png"
            alt=""
            fetchPriority="high"
          />
        )}
        {exploring && !failed && (
          <SceneBoundary onError={onError}>
            <Scene
              active={active}
              onSelect={setActive}
              running={running}
              reduced={reduced}
              onReady={onReady}
              onError={onError}
            />
          </SceneBoundary>
        )}
      </div>
      {!embedded && <p className="city-caption">{tr("Иллюстративная модель Семея. Здания и связи условные.")}</p>}
    </div>
  );
}
