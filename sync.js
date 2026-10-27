'use strict';
// Аккаунт и синхронизация с сервером PocketBase. Приложение работает и без него:
// все изменения сначала пишутся на телефон, а на сервер уходят из очереди, когда есть связь.

// Адрес сервера по умолчанию для версии на GitHub Pages; на своём сервере берётся текущий адрес
const DEFAULT_SERVER = '';

const Sync = (() => {
  const read = (k, d) => { try { const v = localStorage.getItem('cal.' + k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem('cal.' + k, JSON.stringify(v)); } catch {} };

  let auth = read('auth', null);       // { token, user: { id, email, goal } }
  let outbox = read('outbox', []);     // [{ op: 'put'|'del', id, day }]
  let hooks = { getEntry: () => null, applyRemote: () => {}, onStatus: () => {} };
  let flushing = false;

  function server() {
    const custom = (read('settings', {}).server || '').trim();
    if (custom) return custom.replace(/\/+$/, '');
    if (DEFAULT_SERVER) return DEFAULT_SERVER;
    return /github\.io$/.test(location.hostname) || location.protocol === 'file:' ? '' : location.origin;
  }
  const available = () => !!server();
  const loggedIn = () => !!(auth && auth.token);

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth?.token) headers.Authorization = auth.token;
    const res = await fetch(server() + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (res.status === 401 && auth) { setAuth(null); throw new Error('Войдите в аккаунт заново'); }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(apiMessage(data) || 'Ошибка сервера ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function apiMessage(data) {
    if (!data) return '';
    const fields = data.data || {};
    if (fields.email?.code === 'validation_invalid_email') return 'Проверьте адрес почты';
    if (fields.email?.code === 'validation_not_unique') return 'Такая почта уже зарегистрирована, войдите';
    if (fields.password) return 'Пароль должен быть не короче 8 символов';
    if (data.message === 'Failed to authenticate.') return 'Неверная почта или пароль';
    return data.message || '';
  }
  function setAuth(a) {
    auth = a;
    write('auth', a);
    hooks.onStatus();
  }

  async function login(email, password) {
    const r = await api('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: email, password } });
    setAuth({ token: r.token, user: { id: r.record.id, email: r.record.email, goal: r.record.goal || 0 } });
    return auth.user;
  }
  async function register(email, password) {
    await api('/api/collections/users/records', { method: 'POST', body: { email, password, passwordConfirm: password, emailVisibility: false } });
    return login(email, password);
  }
  function logout() {
    setAuth(null);
    outbox = [];
    write('outbox', outbox);
  }

  // ---------- Дневник ----------
  function queue(op, id, day) {
    outbox = outbox.filter((o) => o.id !== id).concat({ op, id, day });
    write('outbox', outbox);
    flush();
  }
  const putEntry = (entry, day) => loggedIn() && queue('put', entry.id, day);
  const delEntry = (id, day) => loggedIn() && queue('del', id, day);
  // Выгрузить на сервер всё, что уже есть на телефоне (после первого входа)
  function uploadAll(diary) {
    for (const [day, list] of Object.entries(diary)) for (const e of list) outbox.push({ op: 'put', id: e.id, day });
    write('outbox', outbox);
    return flush();
  }

  function toRecord(e, day) {
    return { day, meal: e.meal, grams: e.grams, name: e.name, brand: e.brand || '', fkey: (e.key || '').slice(0, 64),
      kcal: e.kcal, p: e.p, f: e.f, c: e.c };
  }
  async function flush() {
    if (flushing || !loggedIn() || !available() || !navigator.onLine) return;
    flushing = true;
    try {
      while (outbox.length) {
        const o = outbox[0];
        const path = '/api/collections/entries/records';
        if (o.op === 'del') {
          await api(`${path}/${o.id}`, { method: 'DELETE' }).catch((e) => { if (e.status !== 404) throw e; });
        } else {
          const e = hooks.getEntry(o.id, o.day);
          if (e) {
            const body = toRecord(e, o.day);
            try {
              await api(`${path}/${o.id}`, { method: 'PATCH', body });
            } catch (err) {
              if (err.status !== 404) throw err;
              await api(path, { method: 'POST', body: { ...body, id: o.id, user: auth.user.id } });
            }
          }
        }
        outbox.shift();
        write('outbox', outbox);
      }
    } catch {
      // Нет связи или ошибка сервера: очередь сохранится и уйдёт позже
    } finally {
      flushing = false;
      hooks.onStatus();
    }
  }

  // Забрать записи за период и отдать приложению по дням
  async function pull(fromDay, toDay) {
    if (!loggedIn() || !available() || !navigator.onLine) return;
    await flush();
    const filter = encodeURIComponent(`day >= "${fromDay}" && day <= "${toDay}"`);
    const items = [];
    for (let page = 1; page < 50; page++) {
      const r = await api(`/api/collections/entries/records?filter=${filter}&perPage=500&page=${page}&skipTotal=1`);
      items.push(...r.items);
      if (r.items.length < 500) break;
    }
    const pending = new Set(outbox.map((o) => o.id));
    const byDay = {};
    for (const r of items) {
      (byDay[r.day] = byDay[r.day] || []).push({ id: r.id, meal: r.meal, grams: r.grams, key: r.fkey, name: r.name, brand: r.brand,
        kcal: r.kcal, p: r.p, f: r.f, c: r.c });
    }
    hooks.applyRemote(byDay, fromDay, toDay, pending);
  }

  // ---------- Общая база продуктов ----------
  function fromFood(r) {
    return { key: 's:' + r.id, src: 'shared', id: r.id, name: r.name, brand: r.brand, code: r.code,
      kcal: r.kcal, p: r.p, f: r.f, c: r.c, serving: r.serving || null, mine: r.author === auth?.user?.id };
  }
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  async function searchFoods(q) {
    if (!loggedIn() || !available()) return [];
    const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 4);
    if (!words.length) return [];
    const filter = encodeURIComponent(words.map((w) => `(name ~ "${esc(w)}" || brand ~ "${esc(w)}")`).join(' && '));
    try {
      const r = await api(`/api/collections/foods/records?filter=${filter}&perPage=30&skipTotal=1&sort=name`);
      return r.items.map(fromFood);
    } catch { return []; }
  }
  async function foodByCode(code) {
    if (!loggedIn() || !available()) return null;
    try {
      const r = await api(`/api/collections/foods/records?filter=${encodeURIComponent(`code = "${esc(code)}"`)}&perPage=1&skipTotal=1`);
      return r.items[0] ? fromFood(r.items[0]) : null;
    } catch { return null; }
  }
  async function shareFood(food) {
    if (!loggedIn() || !available()) return null;
    const body = { name: food.name, brand: food.brand || '', code: food.code || '', kcal: food.kcal, p: food.p, f: food.f, c: food.c,
      serving: food.serving || 0, author: auth.user.id };
    try { return fromFood(await api('/api/collections/foods/records', { method: 'POST', body })); } catch { return null; }
  }

  async function saveGoal(goal) {
    if (!loggedIn() || !available()) return;
    try {
      await api(`/api/collections/users/records/${auth.user.id}`, { method: 'PATCH', body: { goal } });
      auth.user.goal = goal; write('auth', auth);
    } catch {}
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    addEventListener('online', flush);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) hooks.onStatus('visible'); });
  }

  return {
    init, available, loggedIn, server, login, register, logout, uploadAll, putEntry, delEntry, flush, pull,
    searchFoods, foodByCode, shareFood, saveGoal,
    get user() { return auth?.user || null; },
    get pending() { return outbox.length; },
  };
})();
