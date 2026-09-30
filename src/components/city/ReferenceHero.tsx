"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useTranslation } from "@/features/i18n/provider";
import { useDestinations } from "@/features/shared/use-destinations";

const examples = [
  {
    marker: "transport",
    icon: "bus",
    category: "Транспорт и безопасность",
    title: "Безопасный переход у школы",
    description: "Освещение и заметная разметка для пешеходов.",
  },
  {
    marker: "ecology",
    icon: "leaf",
    category: "Экология и благоустройство",
    title: "Больше тени на набережной",
    description: "Деревья и места для отдыха вдоль прогулочного маршрута.",
  },
  {
    marker: "safety",
    icon: "shield",
    category: "Безопасность",
    title: "Свет во дворе",
    description: "Освещение на пути к подъездам в вечернее время.",
  },
] as const satisfies ReadonlyArray<{
  marker: "transport" | "ecology" | "safety";
  icon: IconName;
  category: string;
  title: string;
  description: string;
}>;

export function ReferenceHero() {
  const { staff, proposalHref } = useDestinations();
  const { t: tr, intlLocale } = useTranslation();
  const [selected, setSelected] = useState(0);
  const example = examples[selected] ?? examples[0];

  return (
    <section className="landing-hero" aria-labelledby="reference-title">
      <div className="landing-copy">
        <h1 id="reference-title" className="landing-title">
          <span>{tr("Идеи жителей.")}</span>
          <span className="landing-title-accent">{tr("Возможности региона.")}</span>
        </h1>
        <p className="landing-description">
          {tr(" Sevens — платформа идей для области Абай. Предложите, что улучшить, отметьте место и следите за рассмотрением. ")}</p>
        <div className="landing-actions">
          <Link className="landing-primary" href={proposalHref}>
            <span className="landing-action-label">{tr(staff ? "Кабинет специалиста" : "Предложить идею")}</span>
            <span className="landing-action-icon" aria-hidden="true"><Icon name="arrow" size={19} /></span>
          </Link>
          <a className="landing-discover" href="#home-platform">
            <span className="landing-action-label">{tr("Как устроен Sevens")}</span>
            <span className="landing-action-icon" aria-hidden="true"><Icon name="arrow" size={19} /></span>
          </a>
        </div>
      </div>
      <div className="landing-visual">
        <div className="landing-scene" id="hero-scene">
          <img
            src="/sevens/city-illustration.png"
            alt={tr("Иллюстративный городской квартал: зелёные зоны, автобус, набережная и мост через реку")}
            width={1536}
            height={1024}
            fetchPriority="high"
            draggable={false}
          />
          {examples.map((item, index) => (
            <button
              key={item.marker}
              type="button"
              className="landing-marker"
              data-marker={item.marker}
              aria-pressed={selected === index}
              aria-controls="landing-example"
              aria-label={tr("Показать пример идеи: {0}", { "0": tr(item.title) })}
              onClick={() => setSelected(index)}
            >
              <Icon name={item.icon} size={20} />
            </button>
          ))}
        </div>
        <aside className="landing-example" id="landing-example" aria-live="polite" aria-atomic="true">
          <p className="landing-example-label">{tr("Пример идеи")}</p>
          <span className="landing-example-category">{tr(example.category)}</span>
          <h2>{tr(example.title)}</h2>
          <p>{tr(example.description)}</p>
        </aside>
      </div>
    </section>
  );
}
