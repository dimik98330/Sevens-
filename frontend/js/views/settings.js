import { apiBase, useMock } from '../lib/api.js';

export function settingsView() {
  const base = sessionStorage.getItem('abai.apiBase') || '';
  const mock = useMock();
  return `<div class="narrow"><div class="card"><h1>Настройка backend</h1>
    <p class="muted">Mock используется только для разработки/тестов, пока API B не готов (B-01 в работе). Перед выпуском подключите настоящий backend.</p>
    <form id="setForm">
      <div class="field"><label for="apiBase">Base URL настоящего backend (пусто = same-origin /api/v1)</label>
      <input id="apiBase" type="text" value="${base.replace(/"/g, '&quot;')}" placeholder="https://backend.example.test"></div>
      <div class="field"><label for="mock">Режим данных</label>
      <select id="mock"><option value="1" ${mock ? 'selected' : ''}>Демо-mock по контракту (разработка)</option><option value="0" ${mock ? '' : 'selected'}>Настоящий backend</option></select></div>
      <button class="btn btn-primary" type="submit">Сохранить</button>
    </form>
    <p class="muted">Текущий API base: <code>${(apiBase() || '(same-origin)')}</code></p>
  </div></div>`;
}
export function bindSettings(root) {
  root.querySelector('#setForm').onsubmit = (e) => {
    e.preventDefault();
    const base = root.querySelector('#apiBase').value.trim().replace(/\/$/, '');
    if (base) sessionStorage.setItem('abai.apiBase', base); else sessionStorage.removeItem('abai.apiBase');
    sessionStorage.setItem('abai.useMock', root.querySelector('#mock').value);
    location.hash = '#/';
    location.reload();
  };
}
