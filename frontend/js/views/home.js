import { STR } from '../lib/i18n.js';

export function homeView() {
  return `<div class="hero">
    <div class="card">
      <h1>${STR.tagline}</h1>
      <p>${STR.subtagline}</p>
      <p class="btn-row">
        <a class="btn btn-primary" href="#/ideas/new">Предложить идею</a>
        <a class="btn btn-secondary" href="#/how">Как проходит рассмотрение</a>
      </p>
      <ol class="steps" aria-label="Три шага">
        <li><strong>1.</strong> Опишите проблему и цифровое решение</li>
        <li><strong>2.</strong> Получите понятный маршрут</li>
        <li><strong>3.</strong> Следите за ответом специалиста</li>
      </ol>
      <h2>Направления</h2>
      <p>${['Транспорт', 'ЖКХ', 'Образование', 'Экология', 'Безопасность', 'Здравоохранение', 'Туризм и культура', 'Доступная среда', 'Другое'].map((c) => `<span class="tag">${c}</span>`).join('')}</p>
    </div>
    <div class="card" aria-label="Пример карточки идеи">
      <span class="example-label">ПРИМЕР</span>
      <h2 style="margin-top:4px">Умные светофоры рядом со школой</h2>
      <p><span class="status" data-s="RECEIVED"><span aria-hidden="true">📥</span> Получена</span> <span class="tag">Транспорт</span></p>
      <p class="muted">Идея → Направление → Ответ: карточка показывает номер, статус и объяснение маршрута «Почему это направление?».</p>
      <p class="muted">Это пример оформления, а не реальная идея жителя.</p>
      <p><a class="btn btn-secondary btn-sm" href="#/ideas/new">Предложить свою идею</a></p>
    </div>
  </div>`;
}

export function howView() {
  return `<div class="narrow"><div class="card">
    <h1>Как проходит рассмотрение</h1>
    <ol>
      <li><strong>Опишите идею</strong> — проблему, цифровое решение, территорию. Черновик сохраняется на сервере.</li>
      <li><strong>Получите маршрут</strong> — базовые правила определяют направление и объясняют его. Спорные случаи разбирает специалист.</li>
      <li><strong>Следите за ответом</strong> — статусы, уточнения и итог видны в карточке и уведомлениях.</li>
    </ol>
    <p class="muted">Идея регистрируется на платформе и направляется в демонстрационную очередь. Официальной отправки в государственные системы нет.</p>
    <p><a class="btn btn-primary" href="#/ideas/new">Предложить идею</a></p>
  </div></div>`;
}
