import { STR } from './lib/i18n.js';

const ICONS = { DRAFT: '✎', RECEIVED: '📥', UNDER_REVIEW: '👁', NEEDS_INFO: '❓', IN_PROGRESS: '⚙', COMPLETED: '✔', REJECTED: '✕' };
export const esc = (s) => (s ?? '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function statusBadge(s) {
  return `<span class="status" data-s="${esc(s)}" aria-label="Статус: ${esc(STR.statuses[s] ?? s)}"><span aria-hidden="true">${ICONS[s] ?? '•'}</span> ${esc(STR.statuses[s] ?? s)}</span>`;
}
export function routeCard(r) {
  if (!r) return '';
  const triage = r.mode === 'TRIAGE';
  return `<section class="route-card" aria-labelledby="route-h">
    <h3 id="route-h">Почему это направление?</h3>
    <p><strong>Основная тема:</strong> ${esc(STR.categories[r.effectiveCategoryCode] ?? r.effectiveCategoryCode)}
    · <strong>Уверенность правил:</strong> ${r.confidenceBand === 'HIGH' ? 'определено уверенно' : r.confidenceBand === 'MEDIUM' ? 'стоит проверить' : 'нужен специалист'}</p>
    ${r.tags?.length ? `<p><strong>Дополнительные темы:</strong> ${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</p>` : ''}
    <p>${esc(r.explanation)}</p>
    <p class="muted">Текущая демонстрационная очередь: ${esc(r.organizationCode)} · источник: ${esc(r.source === 'RULES' ? 'Правила' : r.source)} · версия ${esc(r.ruleVersion ?? '')}.
    ${triage ? ' ' + esc(STR.triageExplain) : ''} Это учебное распределение, а не официальный канал органа.</p>
  </section>`;
}
export const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="card" aria-hidden="true"><div class="skeleton" style="width:60%"></div><div class="skeleton"></div><div class="skeleton" style="width:40%"></div></div>').join('');
export const emptyBox = (title, text, action) => `<div class="card empty" role="status"><h2>${esc(title)}</h2><p>${esc(text)}</p>${action ?? ''}</div>`;
export function errorBox(err, onRetry) {
  const d = err?.detail ?? err ?? {};
  const code = d.code ?? 'UNKNOWN_ERROR';
  const map = {
    NETWORK_ERROR: 'Нет связи с сервером. Проверьте сеть и повторите.',
    UNAUTHENTICATED: STR.unauth, FORBIDDEN: STR.forbidden, NOT_FOUND: STR.forbidden,
    VERSION_CONFLICT: STR.versionConflict, INVALID_TRANSITION: 'Этот переход сейчас недоступен. Обновите карточку.',
    IDEMPOTENCY_CONFLICT: 'Повтор с тем же ключом, но другим содержимым. Начните действие заново с новым ключом.',
    VALIDATION_ERROR: d.message, FILE_TOO_LARGE: 'Файл больше 5 MiB. Выберите файл меньше.',
    UNSUPPORTED_FILE_TYPE: STR.fileType,
  };
  const id = 'err' + Math.random().toString(36).slice(2, 6);
  window.__retry = window.__retry ?? {};
  if (onRetry) window.__retry[id] = onRetry;
  return `<div class="notice error" role="alert"><strong>Ошибка${d.http ? ` ${d.http}` : ''} (${esc(code)})</strong><br>${esc(map[code] ?? d.message ?? 'Что-то пошло не так.')}${onRetry ? ` <button class="btn btn-secondary btn-sm" data-retry="${id}">Повторить</button>` : ''}</div>`;
}
export function fieldError(id, msg) {
  return msg ? `<p class="field-error" id="${id}">${esc(msg)}</p>` : `<p class="field-error" id="${id}" hidden></p>`;
}
export function timeline(events) {
  if (!events?.length) return '<p class="muted">История пока пуста.</p>';
  const items = [...events].sort((a, b) => (a.at < b.at ? -1 : 1)).map((e) =>
    `<li><time datetime="${esc(e.at)}">${esc(new Date(e.at).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }))}</time><br><strong>${esc(e.actor ?? '')}</strong> — ${esc(e.text ?? '')}</li>`).join('');
  return `<ol class="timeline" aria-label="История рассмотрения">${items}</ol>`;
}
export function toast(msg) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  box.append(el); setTimeout(() => el.remove(), 4200);
}
export function focusFirstError(root) {
  const t = root.querySelector('[aria-invalid="true"]');
  if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); }
}
