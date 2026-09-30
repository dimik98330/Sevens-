"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Publication, PublicationText } from "@/contracts/showcase";
import { showcaseApi } from "@/features/showcase/api";
import { ApiError } from "@/features/shared/api-client";
import { useTranslation } from "@/features/i18n/provider";
import { ErrorNotice } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { useNavigationBlock } from "@/components/ui/NavigationSafety";
import "./publication-panel.css";

const STATE_LABELS: Record<Publication["state"], string> = {
  PRIVATE: "Ещё не опубликована в «Идеях региона»",
  PENDING: "Ожидает проверки сотрудника",
  PUBLISHED: "В общей ленте региона",
  REJECTED: "Нужно подготовить карточку заново",
};

/** A separate, consented projection: private idea text and source comments stay private. */
export function PublicationPanel({ ideaId, source, staff = false, initialOpen = false }: {
  ideaId: string;
  source: PublicationText;
  staff?: boolean;
  initialOpen?: boolean;
}) {
  const { t: tr } = useTranslation();
  const fieldPrefix = useId();
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [publication, setPublication] = useState<Publication | null>(null);
  const [text, setText] = useState<PublicationText>(source);
  const [open, setOpen] = useState(initialOpen);
  const [consent, setConsent] = useState(false);
  const [moderationNote, setModerationNote] = useState("");
  const [reply, setReply] = useState("");
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [replyPrivacyChecked, setReplyPrivacyChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [message, setMessage] = useState("");
  const savedText = useRef(JSON.stringify(source));
  const savedReply = useRef("");
  const savedNote = useRef("");
  useNavigationBlock({ unsaved: JSON.stringify(text) !== savedText.current || reply !== savedReply.current || moderationNote !== savedNote.current, saving: busy });
  const lock = useRef(false);
  const active = useRef(false);
  const loadSequence = useRef(0);
  const currentIdea = useRef(ideaId);
  currentIdea.current = ideaId;
  const load = useCallback(async (replaceText = false) => {
    const requestSequence = ++loadSequence.current;
    try {
      const result = await showcaseApi.publication(ideaId);
      if (!active.current || requestSequence !== loadSequence.current) return;
      setPublication(result.data);
      if (staff && result.data.state === "PENDING") setOpen(true);
      if (replaceText) {
        const projected = result.data;
        const nextText = projected.state === "PRIVATE" ? sourceRef.current : {
          title: projected.title, problem: projected.problem,
          solution: projected.solution, expectedBenefit: projected.expectedBenefit ?? "",
        };
        savedText.current = JSON.stringify(nextText);
        setText(nextText);
      }
      setError(null);
    } catch (failure) {
      if (active.current && requestSequence === loadSequence.current) setError(failure as Error);
    }
  }, [ideaId, staff]);

  useEffect(() => {
    active.current = true;
    setPublication(null);
    void load(true);
    return () => { active.current = false; loadSequence.current += 1; };
  }, [load]);

  async function mutate(work: () => Promise<{ data: Publication }>, success: string, acknowledged?: "reply" | "review") {
    if (lock.current) return;
    lock.current = true;
    const operationIdea = ideaId;
    setBusy(true); setError(null); setMessage("");
    try {
      const result = await work();
      if (!active.current || currentIdea.current !== operationIdea) return;
      const confirmed = result.data;
      if (confirmed.title === text.title && confirmed.problem === text.problem && confirmed.solution === text.solution && (confirmed.expectedBenefit ?? "") === (text.expectedBenefit ?? "")) savedText.current = JSON.stringify(text);
      if (acknowledged === "reply") savedReply.current = reply;
      if (acknowledged === "review") savedNote.current = moderationNote;
      setPublication(result.data); setMessage(success); setConsent(false);
      setPrivacyChecked(false); setReplyPrivacyChecked(false);
    } catch (failure) {
      if (active.current && currentIdea.current === operationIdea) setError(failure as Error);
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }

  const fields = error instanceof ApiError ? error.detail.fields ?? {} : {};
  const update = (key: keyof PublicationText, value: string) => {
    setPrivacyChecked(false);
    setText((current) => ({ ...current, [key]: value }));
  };
  const submitRequest = (event: FormEvent) => {
    event.preventDefault();
    if (!consent || !publication) return;
    void mutate(() => showcaseApi.requestPublication(ideaId, text, publication.version), "Карточка отправлена на проверку. После публикации жители смогут поддержать идею.");
  };
  const review = (decision: "PUBLISH" | "REJECT") => {
    if (!publication || (decision === "PUBLISH" && !privacyChecked)) return;
    void mutate(() => showcaseApi.review(ideaId, decision, text, moderationNote, publication.version),
      decision === "PUBLISH" ? "Карточка опубликована в общей ленте." : "Карточка возвращена автору на подготовку.", "review");
  };
  const submitReply = (event: FormEvent) => {
    event.preventDefault();
    if (!publication || !replyPrivacyChecked) return;
    void mutate(() => showcaseApi.reply(ideaId, reply, publication.version), "Ответ опубликован для всех. Подписчики получат уведомление.", "reply");
  };

  return (
    <section className="publication-panel" id="idea-publication" aria-labelledby={`${fieldPrefix}-title`}>
      <div className="publication-panel-heading">
        <span className="publication-panel-icon"><Icon name="globe" size={23} /></span>
        <div><h2 id={`${fieldPrefix}-title`}>{tr("Публикация в «Идеях региона»")}</h2><p>{tr(publication ? STATE_LABELS[publication.state] : "Проверяем доступ к публикации…")}</p></div>
        <button type="button" className="publication-panel-toggle" disabled={busy} aria-expanded={open} aria-controls={`${fieldPrefix}-body`} onClick={() => setOpen((value) => !value)}>
          {tr(open ? "Свернуть" : staff ? "Публикация и ответы" : "Поделиться идеей")}<Icon name="chevron" size={16} />
        </button>
      </div>
      {publication?.state === "PUBLISHED" && <Link className="publication-open" href={`/dashboard/${ideaId}`}>{tr("Открыть общую карточку")}<Icon name="arrow" size={16} /></Link>}
      {publication?.state === "PRIVATE" && !staff && <p className="publication-flow-note">{tr("Ваша заявка уже доступна в кабинете. Для общей ленты подготовьте публичный текст и дайте отдельное согласие. После проверки сотрудником карточка появится в «Идеях региона».")}</p>}
      {publication?.state === "PENDING" && <p className="publication-flow-note" role="status">{tr(staff ? "Автор дал согласие. Проверьте публичный текст и опубликуйте карточку — после этого она станет видна жителям." : "Запрос на публикацию отправлен сотруднику вашего направления. Пока карточка не прошла проверку, она не отображается в общей ленте. Статус рассмотрения самой идеи отслеживается отдельно.")}</p>}
      {message && <p className="publication-feedback" role="status">{tr(message)}</p>}
      {error && <ErrorNotice error={error} onRetry={() => void load()} />}
      {open && publication && (
        <div className="publication-panel-body" id={`${fieldPrefix}-body`}>
          <p className="publication-privacy"><Icon name="shield" size={18} />{tr("Публикуется отдельная карточка без имени автора, контактов, точного адреса и файлов. Личный диалог остаётся в кабинете.")}</p>
          {publication.moderationNote && <p className="publication-review-note"><strong>{tr("Комментарий к публикации: ")}</strong>{publication.moderationNote}</p>}
          {staff && (publication.state === "PRIVATE" || publication.state === "REJECTED") ? <p>{tr(publication.state === "PRIVATE" ? "Автор пока не предложил идею для общей ленты. Сначала необходимо его согласие." : "Карточка возвращена автору. Дождитесь нового запроса на публикацию.")}</p> : (
            <>
              {(!staff || publication.state === "PENDING") && (
              <form onSubmit={submitRequest} className="publication-form">
                <div className="field"><label htmlFor={`${fieldPrefix}-name`}>{tr("Название для общей ленты")}</label>
                  <input id={`${fieldPrefix}-name`} value={text.title} onChange={(e) => update("title", e.target.value)} maxLength={120} minLength={10} required disabled={busy} aria-invalid={Boolean(fields.title)} aria-describedby={fields.title ? `${fieldPrefix}-name-error` : undefined} />
                  {fields.title && <small id={`${fieldPrefix}-name-error`} role="alert">{fields.title}</small>}</div>
                <div className="field"><label htmlFor={`${fieldPrefix}-problem`}>{tr("Проблема без личных данных")}</label>
                  <textarea id={`${fieldPrefix}-problem`} value={text.problem} onChange={(e) => update("problem", e.target.value)} minLength={30} maxLength={3000} rows={3} required disabled={busy} aria-invalid={Boolean(fields.problem)} aria-describedby={fields.problem ? `${fieldPrefix}-problem-error` : undefined} />
                  {fields.problem && <small id={`${fieldPrefix}-problem-error`} role="alert">{fields.problem}</small>}</div>
                <div className="field"><label htmlFor={`${fieldPrefix}-solution`}>{tr("Предлагаемое решение для жителей")}</label>
                  <textarea id={`${fieldPrefix}-solution`} value={text.solution} onChange={(e) => update("solution", e.target.value)} minLength={30} maxLength={3000} rows={3} required disabled={busy} aria-invalid={Boolean(fields.solution)} aria-describedby={fields.solution ? `${fieldPrefix}-solution-error` : undefined} />
                  {fields.solution && <small id={`${fieldPrefix}-solution-error`} role="alert">{fields.solution}</small>}</div>
                <div className="field"><label htmlFor={`${fieldPrefix}-benefit`}>{tr("Что изменится для жителей")}</label>
                  <textarea id={`${fieldPrefix}-benefit`} value={text.expectedBenefit ?? ""} onChange={(e) => update("expectedBenefit", e.target.value)} maxLength={1000} rows={2} disabled={busy} /></div>
                {!staff ? (
                  <>
                    <label className="publication-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} required />{tr("Согласен на публикацию этой карточки и общедоступное отображение этапа рассмотрения.")}</label>
                    <div className="publication-actions"><button className="btn btn-primary" type="submit" disabled={busy || !consent}>{tr(busy ? "Сохраняем…" : publication.state === "PUBLISHED" ? "Отправить изменения на проверку" : "Отправить на публикацию")}<Icon name="arrow" size={17} /></button>
                      {publication.state !== "PRIVATE" && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void mutate(() => showcaseApi.withdraw(ideaId), "Карточка скрыта из общей ленты. Личная идея сохранена.")}>{tr("Убрать из общей ленты")}</button>}</div>
                  </>
                ) : (
                  <>
                    <div className="field"><label htmlFor={`${fieldPrefix}-moderation`}>{tr("Комментарий автору о публикации")}</label><textarea id={`${fieldPrefix}-moderation`} value={moderationNote} onChange={(e) => setModerationNote(e.target.value)} maxLength={1000} rows={2} disabled={busy} /></div>
                    <p className="hint">{tr("Перед публикацией проверьте, что в тексте нет имён, контактов и точных адресов. Ответы личного диалога не станут общедоступными.")}</p>
                    <label className="publication-consent"><input type="checkbox" checked={privacyChecked} onChange={(e) => setPrivacyChecked(e.target.checked)} disabled={busy} />{tr("Проверил карточку: личные данные, контакты и точные адреса удалены.")}</label>
                    <div className="publication-actions"><button type="button" className="btn btn-primary" disabled={busy || !publication.authorConsent || !privacyChecked} onClick={() => review("PUBLISH")}>{tr(busy ? "Сохраняем…" : "Опубликовать карточку")}<Icon name="check" size={17} /></button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => review("REJECT")}>{tr("Вернуть на подготовку")}</button></div>
                  </>
                )}
              </form>
              )}
              {staff && publication.state === "PUBLISHED" && (
                <form className="publication-reply-form" onSubmit={submitReply}>
                  <h3>{tr("Ответ для общей ленты")}</h3>
                  <p>{tr("Этот ответ увидят все посетители. Он публикуется отдельно от личного диалога с автором.")}</p>
                  <label htmlFor={`${fieldPrefix}-reply`}>{tr("Ответ сотрудника акимата")}</label><textarea id={`${fieldPrefix}-reply`} minLength={20} maxLength={2000} rows={4} value={reply} onChange={(e) => { setReply(e.target.value); setReplyPrivacyChecked(false); }} disabled={busy} required aria-invalid={Boolean(fields.body)} />
                  {fields.body && <small role="alert">{fields.body}</small>}
                  <label className="publication-consent"><input type="checkbox" checked={replyPrivacyChecked} onChange={(e) => setReplyPrivacyChecked(e.target.checked)} disabled={busy} required />{tr("Проверил ответ: он не раскрывает личные данные автора.")}</label>
                  <button type="submit" className="btn btn-primary" disabled={busy || reply.trim().length < 20 || !replyPrivacyChecked}>{tr(busy ? "Публикуем…" : "Опубликовать ответ для всех")}<Icon name="arrow" size={17} /></button>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
