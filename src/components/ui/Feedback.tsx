import type { ReactNode } from "react";
import type { ApiErrorDetail } from "@/features/shared/api-client";
import ru from "@/locales/ru.json";

const MESSAGE_BY_CODE: Record<string, string> = {
  NETWORK_ERROR: "Нет связи с сервером. Проверьте сеть и повторите.",
  UNAUTHENTICATED: ru.unauth,
  FORBIDDEN: ru.forbidden,
  NOT_FOUND: ru.forbidden,
  VERSION_CONFLICT: ru.versionConflict,
  INVALID_TRANSITION: "Этот переход сейчас недоступен. Обновите карточку.",
  IDEMPOTENCY_CONFLICT: "Повтор с тем же ключом, но другим содержимым. Начните действие заново.",
  VALIDATION_ERROR: "Проверьте заполнение формы.",
  FILE_TOO_LARGE: "Файл больше 5 MiB. Выберите файл меньше.",
  UNSUPPORTED_FILE_TYPE: ru.fileType,
  RATE_LIMITED: "Слишком много попыток. Подождите и повторите.",
  SERVICE_UNAVAILABLE: "Сервис временно недоступен. Попробуйте позже.",
};

export function ErrorNotice({ error, onRetry, id }: { error: ApiErrorDetail | Error; onRetry?: () => void; id?: string }) {
  const d = "detail" in error ? (error as { detail: ApiErrorDetail }).detail : (error as ApiErrorDetail);
  const code = d.code ?? "UNKNOWN_ERROR";
  const text = code === "VALIDATION_ERROR" && d.message ? d.message : (MESSAGE_BY_CODE[code] ?? d.message ?? "Что-то пошло не так.");
  return (
    <div className="notice error" role="alert" id={id}>
      <strong>
        Ошибка{d.http ? ` ${d.http}` : ""} ({code})
      </strong>
      <br />
      {text}
      {onRetry && (
        <>
          {" "}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            Повторить
          </button>
        </>
      )}
    </div>
  );
}

export function InfoNotice({ children }: { children: ReactNode }) {
  return (
    <div className="notice info" role="status">
      {children}
    </div>
  );
}

export function WarnNotice({ children }: { children: ReactNode }) {
  return (
    <div className="notice warn" role="status">
      {children}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="card empty" role="status">
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status">
      <span className="sr-only">Загрузка…</span>
      <div aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>
            <div className="skeleton" style={{ width: i === 0 ? "60%" : "100%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface TimelineItem {
  id: string;
  at: string;
  actor?: string;
  text: string;
  body?: string;
}

// История — вертикальная лента, не progress bar (05 §8).
// body — текст реплики из timeline.body (A msg 133, B 49d2427).
export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="muted">История пока пуста.</p>;
  const sorted = [...items].sort((a, b) => (a.at < b.at ? -1 : 1));
  return (
    <ol className="timeline" aria-label="История рассмотрения">
      {sorted.map((e) => (
        <li key={e.id}>
          <time dateTime={e.at}>
            {new Date(e.at).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}
          </time>
          <br />
          <strong>{e.actor ?? ""}</strong> — {e.text}
          {e.body && (
            <>
              <br />
              <span>{e.body}</span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
