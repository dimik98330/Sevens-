"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { IdeaStatus } from "@/contracts";
import styles from "./platform-story.module.css";
import { useTranslation } from "@/features/i18n/provider";
import { useDestinations } from "@/features/shared/use-destinations";

type StatusExplanation = {
  status: IdeaStatus;
  label: string;
  short: string;
  icon: IconName;
  title: string;
  explanation: string;
  action: string;
};

const STATUSES: StatusExplanation[] = [
  {
    status: "RECEIVED", label: "Получена", short: "Идея зарегистрирована", icon: "file",
    title: "Ваша идея успешно отправлена.",
    explanation: "Предложение получило номер и сохранилось на платформе. Его описание, место и приложенные материалы доступны в вашей карточке идеи.",
    action: "Ожидайте начала рассмотрения. Текущий статус и все дальнейшие обновления можно посмотреть в разделе «Мои идеи».",
  },
  {
    status: "UNDER_REVIEW", label: "На рассмотрении", short: "Специалист изучает идею", icon: "clock",
    title: "Предложение изучает специалист.",
    explanation: "Специалист рассматривает проблему и предлагаемое решение. При необходимости он уточняет направление или запрашивает дополнительные сведения у автора.",
    action: "Следите за уведомлениями и комментариями в карточке. Если появится запрос на уточнение, вы сможете ответить на него в кабинете.",
  },
  {
    status: "NEEDS_INFO", label: "Нужны уточнения", short: "Требуется ваш ответ", icon: "bell",
    title: "Нужны дополнительные сведения.",
    explanation: "Специалист оставил вопрос к вашей идее. Чтобы продолжить рассмотрение, ему нужны подробности — например, точное место или более полное описание предложения.",
    action: "Откройте карточку идеи, прочитайте вопрос специалиста и отправьте уточнение. Сам запрос будет сохранён в истории.",
  },
  {
    status: "IN_PROGRESS", label: "В работе", short: "Идеей занимаются дальше", icon: "layers",
    title: "По идее ведётся дальнейшая работа.",
    explanation: "Предложение перешло к дальнейшей проработке. Этот статус сам по себе не означает, что идея уже реализована: конкретные действия и результаты объясняет специалист в комментариях.",
    action: "Следите за обновлениями в карточке. Новые комментарии помогут понять, на каком этапе находится работа и какое решение принято.",
  },
  {
    status: "COMPLETED", label: "Завершена", short: "Есть итоговый результат", icon: "check",
    title: "Рассмотрение завершено.",
    explanation: "В карточке доступен итоговый ответ специалиста. Он объясняет результат рассмотрения; вся предыдущая переписка и история изменений остаются доступными.",
    action: "Прочитайте итоговый комментарий в разделе «Мои идеи». Ориентируйтесь на содержание ответа, чтобы понять, что сделано по предложению.",
  },
  {
    status: "REJECTED", label: "Отклонена", short: "Решение с объяснением", icon: "close",
    title: "В ответе указана причина решения.",
    explanation: "Если предложение не может быть принято к дальнейшей работе, специалист указывает причину. Статус и пояснение сохраняются в карточке вместе с историей рассмотрения.",
    action: "Ознакомьтесь с ответом специалиста. Он поможет понять, почему принято такое решение и какие обстоятельства были учтены.",
  },
];

export function PlatformStory() {
  const { staff, cabinetHref, proposalHref } = useDestinations();
  const { t: tr, intlLocale } = useTranslation();
  const [statusIndex, setStatusIndex] = useState(0);
  const selected = STATUSES[statusIndex] ?? STATUSES[0]!;

  return <div className={`platform-story ${styles.page}`}>
    <section className={styles.statusSection} aria-labelledby="status-title" data-assistant-target="home-process">
      <div className={styles.statusCopy}>
        <p className={styles.kicker}>{tr("О ПЛАТФОРМЕ · СТАТУСЫ ИДЕЙ")}</p>
        <h1 id="status-title">{tr("Вы всегда")}<br />{tr("видите ")}<span>{tr("этап.")}</span></h1>
        <p className={styles.intro}>{tr("После отправки идеи её статус, комментарии и история доступны в вашем кабинете. Выберите статус ниже — объясним, что он означает и что делать дальше.")}</p>
        <div className={styles.mobileSelect}>
          <label htmlFor="explain-status">{tr("Выберите статус")}</label>
          <select id="explain-status" value={statusIndex} onChange={event => setStatusIndex(Number(event.target.value))} aria-controls="status-detail">
            {STATUSES.map((item, i) => <option value={i} key={item.status}>{tr(item.label)}</option>)}
          </select>
        </div>
        <div className={styles.statusOptions} role="group" aria-label={tr("Выберите статус для объяснения")}>
          {STATUSES.map((item, i) => <button type="button" key={item.status} aria-pressed={statusIndex === i} aria-controls="status-detail" onClick={() => setStatusIndex(i)}>
            <span className={styles.optionIcon}><Icon name={item.icon} size={23} /></span>
            <span className={styles.optionCopy}><strong>{tr(item.label)}</strong><span>{item.short}</span></span>
            <span className={styles.optionArrow}><Icon name="arrow" size={18} /></span>
          </button>)}
        </div>
      </div>
      <div id="status-detail" className={styles.statusDetail}>
        <div className={styles.detailHeading}>
          <span className={styles.statusSymbol} data-status={selected.status}><Icon name={selected.icon} size={27} /></span>
          <span className={styles.statusLabel}>{tr(selected.label)}</span>
          <span className={styles.detailTag}>{tr("ЗНАЧЕНИЕ СТАТУСА")}</span>
        </div>
        <div className={styles.statusText} aria-live="polite" aria-atomic="true">
          <h2>{tr(selected.title)}</h2>
          <div className={styles.explanation}><h3>{tr("Что происходит")}</h3><p>{tr(selected.explanation)}</p></div>
          <div className={styles.nextAction}><h3>{tr("Что делать вам")}</h3><p>{tr(selected.action)}</p></div>
        </div>
        <Link className={styles.cabinetLink} href={cabinetHref}>{tr(staff ? "Кабинет специалиста" : "Открыть мои идеи ")}<Icon name="arrow" size={20} /></Link>
      </div>
    </section>
    <section className={styles.start} aria-labelledby="start-title">
      <div><p className={styles.kicker}>{tr("НАЧНЁМ С ВАШЕЙ ИДЕИ")}</p><h2 id="start-title">{tr("Что можно")}<br />{tr("сделать ")}<span>{tr("лучше?")}</span></h2></div>
      <div className={styles.startAction}>
        <p>{tr("Опишите проблему и предложите решение для своего двора, города или области. Укажите место и добавьте материалы, если они помогут понять идею.")}</p>
        <Link className={styles.primaryAction} href={proposalHref}>{tr(staff ? "Кабинет специалиста" : "Предложить идею ")}<span><Icon name="arrow" size={20} /></span></Link>
        <span>{tr("Можно начать с черновика и дополнить его позже.")}</span>
      </div>
    </section>
    <footer className={styles.footer}><span>{tr("SEVENS · ИДЕИ ДЛЯ ОБЛАСТИ АБАЙ")}</span><p>{tr("Идеи регистрируются на платформе Sevens. Отправка в государственные системы не выполняется.")}</p></footer>
  </div>;
}
