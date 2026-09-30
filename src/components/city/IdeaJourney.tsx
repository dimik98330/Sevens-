"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { JourneyIllustration } from "./JourneyIllustration";
import styles from "./idea-journey.module.css";
import { useTranslation } from "@/features/i18n/provider";
import { useDestinations } from "@/features/shared/use-destinations";

// Four lifecycle stages, not the three steps of the submission wizard.
const stages = [
  { title: "Опишите и отправьте", description: "Расскажите о проблеме и решении. Укажите место и проверьте идею перед отправкой.",
    status: "Черновик", icon: "file", outcome: "Начните с того, что хотите изменить", detail: "Например, предложите освещение перехода у школы. Черновик можно сохранить и дополнить позже.", caption: "Описание, место и материалы — в одной идее." },
  { title: "Получите направление", description: "Система определит категорию и предложит маршрут рассмотрения. Всё появится в вашем кабинете.",
    status: "Получена", icon: "layers", outcome: "Предложенное направление — транспорт", detail: "После отправки идея получит номер. Система подберёт направление, а специалист сможет его уточнить.", caption: "Номер и направление сохраняются в карточке." },
  { title: "Следите за рассмотрением", description: "Откройте «Мои идеи» и посмотрите статус. Если нужны подробности, ответьте в карточке.",
    status: "На рассмотрении", icon: "clock", outcome: "Специалист изучает предложение", detail: "Статусы и запросы уточнений видны в карточке. О новых ответах сообщат уведомления.", caption: "История помогает понять, что происходит с идеей." },
  { title: "Прочитайте ответ", description: "Ответ специалиста и результат рассмотрения сохранятся в карточке вашей идеи.",
    status: "Завершена", icon: "check", outcome: "Результат и пояснения — рядом с идеей", detail: "Откройте итоговый ответ в своём кабинете. Завершение означает результат рассмотрения, а не обязательно реализацию объекта.", caption: "Ответ остаётся доступным вместе со всей историей." },
] as const satisfies ReadonlyArray<{title:string;description:string;status:string;icon:IconName;outcome:string;detail:string;caption:string}>;

export function IdeaJourney() {
  const { staff, proposalHref } = useDestinations();
  const { t: tr, intlLocale } = useTranslation();
  const [selected, setSelected] = useState(0);
  const stage = stages[selected] ?? stages[0];
  return (
    <section className={`landing-process ${styles.journey}`} id="home-platform" data-assistant-target="home-process" aria-labelledby="platform-title" tabIndex={-1}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}><span />{tr("КАК УСТРОЕН SEVENS")}</p>
          <h2 id="platform-title">{tr("От вашей идеи")}<br /><span>{tr("до ответа.")}</span></h2>
        </div>
        <p className={styles.intro}>{tr("Вы предлагаете улучшение. Sevens помогает направить его на рассмотрение и сохранить весь диалог в одном месте.")}</p>
      </header>
      <div className={styles.grid}>
        <div className={styles.stepsColumn}>
          <p className={styles.instructions}>{tr("Выберите этап и посмотрите, что будет дальше.")}</p>
          <ol className={styles.steps} aria-label={tr("Этапы пути идеи")}>
            {stages.map((item, index) => (
              <li key={item.title}>
                <button type="button" className={styles.step} aria-pressed={selected === index} aria-controls="journey-preview" aria-describedby={`journey-step-${index}`} onClick={() => setSelected(index)}>
                  <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.stepCopy}><span className={styles.stepTitle}>{tr(item.title)}</span><span className={styles.stepDescription} id={`journey-step-${index}`}>{tr(item.description)}</span></span>
                  <span className={styles.stepArrow} aria-hidden="true"><Icon name="arrow" size={19} /></span>
                </button>
              </li>
            ))}
          </ol>
          <p className={styles.reassurance}><Icon name="shield" size={18} />{tr("Ваши идеи и ответы доступны в вашем кабинете.")}</p>
        </div>
        <div className={styles.preview} id="journey-preview" role="region" aria-labelledby="journey-card-title">
          <div className={styles.previewTop}><span className={styles.demoLabel}>{tr("Демонстрационный пример")}</span><span className={styles.status}><span />{tr(stage.status)}</span></div>
          <h3 id="journey-card-title">{tr("Освещение перехода")}<br />{tr("у школы")}</h3>
          <p className={styles.location}><Icon name="pin" size={16} />{tr("Семей · транспорт и безопасность")}</p>
          <div className={styles.illustration}><JourneyIllustration stage={selected} /></div>
          <div className={styles.progress} aria-hidden="true">{stages.map((item, index) => <span key={item.title} data-active={index <= selected}><span>{String(index + 1).padStart(2, "0")}</span></span>)}</div>
          <div className={styles.outcome}>
            <span className={styles.outcomeIcon}><Icon name={stage.icon} size={21} /></span>
            <div><h4>{tr(stage.outcome)}</h4><p>{tr(stage.detail)}</p></div>
          </div>
          <div className={styles.previewBottom}><span>{tr(stage.caption)}</span><button type="button" onClick={() => setSelected((selected + 1) % stages.length)} aria-label={selected === 3 ? tr("Посмотреть путь сначала") : tr("Показать следующий этап")}><Icon name="arrow" size={19} /></button></div>
        </div>
      </div>
      <div className={styles.start}>
        <div><p className={styles.eyebrow}>{tr("СЛЕДУЮЩИЙ ШАГ — ВАШ")}</p><h3>{tr("Есть идея для области Абай?")}</h3><p>{tr("Подача — три шага: описание, место, проверка.")}</p></div>
        <div className={styles.startActions}><Link className="landing-primary" href={proposalHref}><span className="landing-action-label">{tr(staff ? "Кабинет специалиста" : "Предложить идею")}</span><span className="landing-action-icon" aria-hidden="true"><Icon name="arrow" size={19} /></span></Link><Link className={styles.howLink} href="/how">{tr("Подробнее о подаче")}<Icon name="arrow" size={16} /></Link></div>
      </div>
      <span className="sr-only" role="status">{tr("Этап ")}{selected + 1} {tr(" из 4: ")}{tr(stage.title)}{tr(". Пример статуса: ")}{tr(stage.status)}.</span>
    </section>
  );
}
