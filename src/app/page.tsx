import Link from "next/link";
import ru from "@/locales/ru.json";

const DIRECTIONS = [
  "Транспорт",
  "ЖКХ",
  "Образование",
  "Экология",
  "Безопасность",
  "Здравоохранение",
  "Туризм и культура",
  "Доступная среда",
  "Другое",
];

// Главная (05 §4): заголовок, два действия, пример карточки (с подписью),
// три шага, направления. Без выдуманных чисел и процентов.
export default function HomePage() {
  return (
    <div className="hero">
      <div className="card">
        <h1>{ru.tagline}</h1>
        <p>{ru.subtagline}</p>
        <p className="btn-row">
          <Link className="btn btn-primary" href="/ideas/new">
            Предложить идею
          </Link>
          <Link className="btn btn-secondary" href="/how">
            Как проходит рассмотрение
          </Link>
        </p>
        <ol className="steps" aria-label="Три шага">
          <li>
            <strong>1.</strong> Опишите проблему и цифровое решение
          </li>
          <li>
            <strong>2.</strong> Получите понятный маршрут
          </li>
          <li>
            <strong>3.</strong> Следите за ответом специалиста
          </li>
        </ol>
        <h2>Направления</h2>
        <p>
          {DIRECTIONS.map((d) => (
            <span key={d} className="tag">
              {d}
            </span>
          ))}
        </p>
      </div>
      <div className="card">
        <span className="example-label">ПРИМЕР</span>
        <h2 style={{ marginTop: 4 }}>Умные светофоры рядом со школой</h2>
        <p>
          <span className="status" data-s="RECEIVED">
            <span aria-hidden="true">📥</span> Получена
          </span>{" "}
          <span className="tag">Транспорт</span>
        </p>
        <p className="muted">
          Идея → Направление → Ответ: карточка показывает номер, статус и объяснение маршрута «Почему это
          направление?».
        </p>
        <p className="muted">Это пример оформления, а не реальная идея жителя.</p>
        <p>
          <Link className="btn btn-secondary btn-sm" href="/ideas/new">
            Предложить свою идею
          </Link>
        </p>
      </div>
    </div>
  );
}
