"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useTranslation } from "@/features/i18n/provider";
import type { Locale } from "@/features/i18n/locale";
import styles from "./MessageThread.module.css";

export interface ThreadMessage {
  id: string;
  visibility: "PUBLIC" | "INTERNAL";
  author: string;
  body: string;
  at: string;
  authorId?: string;
  authorRole?: "CITIZEN" | "STAFF" | "ADMIN" | null;
  kind?: string;
}

export interface MessageThreadProps {
  comments: readonly ThreadMessage[];
  currentUserId?: string | null;
  visibility?: "PUBLIC" | "INTERNAL";
}

const COPY = {
  ru: {
    publicThread: "Диалог по идее", internalThread: "Внутренние заметки сотрудников",
    emptyPublic: "Сообщений пока нет. Ответы и уточнения появятся здесь.", emptyInternal: "Внутренних заметок пока нет.",
    unknownAuthor: "Автор не указан", you: "Вы", message: "Сообщение", question: "Запрос уточнения",
    residentReply: "Ответ жителя", staffReply: "Ответ сотрудника", internal: "Внутренняя заметка · только сотрудникам",
    noDate: "Дата не указана", submission: "Идея от жителя", CITIZEN: "Житель", STAFF: "Сотрудник", ADMIN: "Администратор",
  },
  kk: {
    publicThread: "Идея бойынша диалог", internalThread: "Қызметкерлердің ішкі жазбалары",
    emptyPublic: "Әзірге хабарлама жоқ. Жауаптар мен нақтылаулар осында пайда болады.", emptyInternal: "Әзірге ішкі жазба жоқ.",
    unknownAuthor: "Автор көрсетілмеген", you: "Сіз", message: "Хабарлама", question: "Нақтылау сұрауы",
    residentReply: "Тұрғынның жауабы", staffReply: "Қызметкердің жауабы", internal: "Ішкі жазба · тек қызметкерлерге",
    noDate: "Күні көрсетілмеген", submission: "Тұрғынның идеясы", CITIZEN: "Тұрғын", STAFF: "Қызметкер", ADMIN: "Әкімші",
  },
  en: {
    publicThread: "Conversation about this idea", internalThread: "Internal staff notes",
    emptyPublic: "No messages yet. Replies and requests for clarification will appear here.", emptyInternal: "No internal notes yet.",
    unknownAuthor: "Author not specified", you: "You", message: "Message", question: "Request for clarification",
    residentReply: "Resident’s reply", staffReply: "Staff reply", internal: "Internal note · staff only",
    noDate: "Date not specified", submission: "Resident’s idea", CITIZEN: "Resident", STAFF: "Staff member", ADMIN: "Administrator",
  },
} satisfies Record<Locale, Record<string, string>>;

const ROLE_ICONS: Record<NonNullable<ThreadMessage["authorRole"]>, IconName> = {
  CITIZEN: "user", STAFF: "users", ADMIN: "shield",
};

function messageDate(value: string): Date | null {
  // The API supplies a timestamp with its offset. Do not guess a timezone or
  // replace malformed/legacy values with today's date.
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59) return null;
  const day = new Date(`${parts[1]}T00:00:00Z`);
  const date = new Date(value);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === parts[1]
    && Number.isFinite(date.getTime()) ? date : null;
}

function authorName(value: string, fallback: string, verified = false): string {
  const name = typeof value === "string" ? value.trim() : "";
  // Earlier DTOs sometimes exposed a UUID or its first eight hex characters.
  // These are identifiers, not a person's name.
  return !name || !verified && /^[a-f\d]{8}(?:-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})?$/i.test(name) ? fallback : name;
}

export function MessageOrigin({ name, own = false }: { name?: string | null; own?: boolean }) {
  const { locale } = useTranslation();
  const t = COPY[locale];
  return <div className={styles.origin}>
    <span className={styles.avatar} aria-hidden="true"><Icon name="user" size={19} /></span>
    <div className={styles.identity}><span className={styles.role}>{t.submission}</span><div className={styles.author}><strong>{authorName(name ?? "", t.unknownAuthor, true)}</strong>{own && <span className={styles.you}>{t.you}</span>}</div></div>
  </div>;
}

export function MessageThread({ comments, currentUserId, visibility = "PUBLIC" }: MessageThreadProps) {
  const { locale, intlLocale } = useTranslation();
  const t = COPY[locale];
  // This is a rendering safeguard. Server authorization and filtering remain
  // responsible for ensuring that residents never receive INTERNAL bodies.
  const messages = comments.filter((comment) => comment.visibility === visibility);
  const label = visibility === "INTERNAL" ? t.internalThread : t.publicThread;
  if (!messages.length) return <p className={styles.empty} role="status" aria-label={label}>
    <Icon name={visibility === "INTERNAL" ? "shield" : "file"} size={19} />
    <span>{visibility === "INTERNAL" ? t.emptyInternal : t.emptyPublic}</span>
  </p>;

  const formatDate = new Intl.DateTimeFormat(intlLocale, {
    timeZone: "Asia/Qyzylorda", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return <ol className={styles.thread} aria-label={label}>
    {messages.map((comment) => {
      const role = comment.authorRole === "CITIZEN" || comment.authorRole === "STAFF" || comment.authorRole === "ADMIN" ? comment.authorRole : null;
      const employee = role === "STAFF" || role === "ADMIN";
      const own = Boolean(currentUserId && comment.authorId && currentUserId === comment.authorId);
      const date = messageDate(comment.at);
      let kind = t.message;
      if (visibility === "INTERNAL") kind = t.internal;
      else if (employee && comment.kind === "CLARIFICATION_QUESTION") kind = t.question;
      else if (role === "CITIZEN" && comment.kind === "CLARIFICATION_ANSWER") kind = t.residentReply;
      else if (employee && (comment.kind === "NOTE" || comment.kind === "STATUS_COMMENT" || comment.kind === "PUBLIC_REPLY")) kind = t.staffReply;
      return <li key={comment.id} className={`${styles.item} ${employee ? styles.employee : role === "CITIZEN" ? styles.resident : styles.unknown} ${visibility === "INTERNAL" ? styles.internal : ""}`}>
        <article className={styles.message}>
          <header className={styles.header}>
            <span className={styles.avatar} aria-hidden="true"><Icon name={role ? ROLE_ICONS[role] : "user"} size={19} /></span>
            <div className={styles.identity}>
              <div className={styles.author}><strong>{authorName(comment.author, t.unknownAuthor, Boolean(role && comment.authorId))}</strong>{own && <span className={styles.you}>{t.you}</span>}</div>
              {role && <span className={styles.role}>{t[role]}</span>}
            </div>
          </header>
          <div className={styles.kind}>{visibility === "INTERNAL" && <Icon name="shield" size={14} />}<span>{kind}</span></div>
          <p className={styles.body}>{comment.body}</p>
          <footer className={styles.footer}>{date ? <time dateTime={date.toISOString()}>{formatDate.format(date)}</time> : <span>{t.noDate}</span>}</footer>
        </article>
      </li>;
    })}
  </ol>;
}
