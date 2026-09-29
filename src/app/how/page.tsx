import Link from "next/link";

export default function HowPage() {
  return (
    <div className="narrow">
      <div className="card">
        <h1>Как проходит рассмотрение</h1>
        <ol>
          <li>
            <strong>Опишите идею</strong> — проблему, цифровое решение, территорию. Черновик сохраняется на
            сервере.
          </li>
          <li>
            <strong>Получите маршрут</strong> — базовые правила определяют направление и объясняют его. Спорные
            случаи разбирает специалист.
          </li>
          <li>
            <strong>Следите за ответом</strong> — статусы, уточнения и итог видны в карточке и уведомлениях.
          </li>
        </ol>
        <p className="muted">
          Идея регистрируется на платформе и направляется в демонстрационную очередь. Официальной отправки в
          государственные системы нет.
        </p>
        <p>
          <Link className="btn btn-primary" href="/ideas/new">
            Предложить идею
          </Link>
        </p>
      </div>
    </div>
  );
}
