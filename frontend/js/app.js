import { store, isMock } from './lib/data.js';
import { homeView, howView } from './views/home.js';
import { loginView, bindLogin, registerView, bindRegister } from './views/auth.js';
import { myIdeasView, bindMyIdeas } from './views/my.js';
import { wizardView, bindWizard } from './views/wizard.js';
import { ideaDetailView, bindIdeaDetail, notificationsView, bindNotifications } from './views/citizen.js';
import { staffQueueView, bindStaffQueue } from './views/staff-queue.js';
import { staffDetailView, bindStaffDetail } from './views/staff-detail.js';
import { settingsView, bindSettings } from './views/settings.js';
import { errorBox, toast } from './components.js';

export const session = {
  data: null,
  get() { return this.data; },
  set(d) { this.data = d; paintAuth(); },
  clear() { this.data = null; paintAuth(); },
};

function paintAuth() {
  const d = session.data;
  document.getElementById('loginLink').hidden = !!d;
  document.getElementById('logoutBtn').hidden = !d;
  const chip = document.getElementById('userChip');
  chip.hidden = !d;
  if (d) chip.textContent = `${d.displayName} · ${d.role === 'CITIZEN' ? 'житель' : d.role === 'STAFF' ? 'сотрудник' : 'администратор'}`;
  document.querySelectorAll('[data-requires-auth]').forEach((a) => {
    const need = a.dataset.requiresAuth;
    const ok = d && (need === 'any' || (need === 'citizen' && d.role === 'CITIZEN') || (need === 'staff' && (d.role === 'STAFF' || d.role === 'ADMIN')));
    a.style.display = ok ? '' : 'none';
  });
  document.getElementById('backendMode').textContent = isMock() ? 'демо-mock по контракту' : 'настоящий backend';
}

const routes = [
  { re: /^#\/?$/, view: homeView, bind: null },
  { re: /^#\/how$/, view: howView, bind: null },
  { re: /^#\/login$/, view: loginView, bind: bindLogin },
  { re: /^#\/register$/, view: registerView, bind: bindRegister },
  { re: /^#\/my/, view: myIdeasView, bind: bindMyIdeas, auth: ['CITIZEN'] },
  { re: /^#\/ideas\/new/, view: wizardView, bind: bindWizard, auth: ['CITIZEN'] },
  { re: /^#\/ideas\/([\w-]+)/, view: ideaDetailView, bind: bindIdeaDetail, auth: ['CITIZEN', 'STAFF', 'ADMIN'], param: 1 },
  { re: /^#\/notifications$/, view: notificationsView, bind: bindNotifications, auth: ['CITIZEN', 'STAFF', 'ADMIN'] },
  { re: /^#\/staff\/([\w-]+)/, view: staffDetailView, bind: bindStaffDetail, auth: ['STAFF', 'ADMIN'], param: 1 },
  { re: /^#\/staff/, view: staffQueueView, bind: bindStaffQueue, auth: ['STAFF', 'ADMIN'] },
  { re: /^#\/settings$/, view: settingsView, bind: bindSettings },
];

async function render() {
  const hash = location.hash || '#/';
  const view = document.getElementById('view');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = (a.getAttribute('href') === hash.split('?')[0]);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  for (const r of routes) {
    const m = hash.match(r.re);
    if (!m) continue;
    if (r.auth && (!session.data || !r.auth.includes(session.data.role))) {
      view.innerHTML = `<div class="card"><div class="notice warn" role="alert">Нужно войти${r.auth.includes('CITIZEN') && r.auth.length === 1 ? ' как житель' : r.auth.includes('STAFF') ? ' как сотрудник' : ''}, чтобы продолжить.</div><p><a class="btn btn-primary" href="#/login">Войти</a></p></div>`;
      document.getElementById('main').focus({ preventScroll: true });
      return;
    }
    view.innerHTML = r.view(m[r.param]);
    try { await r.bind?.(view, m[r.param]); }
    catch (e) { view.innerHTML = `<div class="card">${errorBox(e)}</div>`; }
    document.getElementById('main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
    return;
  }
  view.innerHTML = `<div class="card"><h1>Страница не найдена</h1><p><a class="btn btn-secondary" href="#/">На главную</a></p></div>`;
}

// Уведомления: опрос раз в 10 с на активной вкладке + при возвращении.
let lastPoll = 0;
async function pollBell() {
  if (document.hidden || !session.data) return;
  if (Date.now() - lastPoll < 10000) return;
  lastPoll = Date.now();
  try {
    const { data } = await store.notifications();
    const n = data.filter((x) => !x.readAt).length;
    const el = document.getElementById('bellCount');
    el.hidden = n === 0; el.textContent = n;
  } catch { /* тихий пропуск: ошибка видна на самом экране */ }
}

async function boot() {
  paintAuth();
  try { const { data } = await store.me().catch(() => ({ data: null })); if (data) session.set(data); }
  catch { /* mock без сессии */ }
  document.getElementById('logoutBtn').onclick = async () => { try { await store.logout(); } catch {} session.clear(); toast('Вы вышли'); location.hash = '#/'; };
  document.getElementById('menuBtn').onclick = (e) => {
    const nav = document.getElementById('mobileNav');
    const open = nav.hidden;
    nav.hidden = !open;
    e.target.setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-retry]');
    if (b && window.__retry?.[b.dataset.retry]) window.__retry[b.dataset.retry]();
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastPoll = 0; pollBell(); } });
  setInterval(pollBell, 5000);
  await render();
  pollBell();
}
boot();
