'use strict';

const MEALS = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин'], ['snack', 'Перекус']];
const OFF_FIELDS = 'code,product_name,product_name_ru,brands,nutriments,serving_quantity,quantity';
const $ = (id) => document.getElementById(id);

// ---------- Хранилище ----------
const store = {
  get(key, def) {
    try { const v = localStorage.getItem('cal.' + key); return v ? JSON.parse(v) : def; } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('cal.' + key, JSON.stringify(val)); } catch { toast('Не удалось сохранить'); }
  },
};
let settings = store.get('settings', { goal: 2000 });
let diary = store.get('diary', {});      // { 'YYYY-MM-DD': [entry] }
let mine = store.get('mine', []);        // свои продукты
let recent = store.get('recent', []);    // недавно добавленные продукты
let offCache = store.get('offCache', {});// штрихкод -> продукт

let day = todayKey();
let currentMeal = guessMeal();

// ---------- Утилиты ----------
function todayKey(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function shiftDay(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d + delta));
}
function dayTitle(key) {
  if (key === todayKey()) return 'Сегодня';
  if (key === shiftDay(todayKey(), -1)) return 'Вчера';
  if (key === shiftDay(todayKey(), 1)) return 'Завтра';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}
function guessMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}
const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
// 15 символов [a-z0-9] — такой же формат id, как у записей на сервере
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 2200);
}
function calc(food, grams) {
  const k = grams / 100;
  return { kcal: food.kcal * k, p: food.p * k, f: food.f * k, c: food.c * k };
}
function openSheet(id) { $(id).classList.add('open'); }
function closeSheet(id) { $(id).classList.remove('open'); if (id === 'scanSheet') stopScan(); }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(b.closest('.sheet').id)));

function fillMealSelect(sel, value) {
  sel.innerHTML = MEALS.map(([k, n]) => `<option value="${k}"${k === value ? ' selected' : ''}>${n}</option>`).join('');
}

// ---------- Дневник ----------
// Иконки приёмов пищи: контур + полупрозрачная заливка (класс d)
const MEAL_ICONS = {
  breakfast: '<path class="d" d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11.5h1.5a2.5 2.5 0 0 1 0 5H15.5M8.5 3.5c-.8 1 .8 2 0 3.5M12.5 3.5c-.8 1 .8 2 0 3.5"/>',
  lunch: '<path class="d" d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M3 11h18a9 9 0 0 1-18 0zM9 20.5h6M10 8c0-1.5 1.5-1.5 1.5-3.5M14 8c0-1.2 1.2-1.2 1.2-2.8"/>',
  dinner: '<path class="d" d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/><path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10zM17 3.5v3M15.5 5h3"/>',
  snack: '<path class="d" d="M12 8c-2-1.5-7-1.5-7 3.5 0 4.5 3 9 5 9 1 0 1.3-.5 2-.5s1 .5 2 .5c2 0 5-4.5 5-9C19 6.5 14 6.5 12 8z"/><path d="M12 8c-2-1.5-7-1.5-7 3.5 0 4.5 3 9 5 9 1 0 1.3-.5 2-.5s1 .5 2 .5c2 0 5-4.5 5-9C19 6.5 14 6.5 12 8zM12 8c0-2 .8-3.6 2.5-4.5"/>',
};
const MACRO_TONES = { p: '#ffc23d', f: '#ffa184', c: '#7fe6f2' };
function macroPill(name, val, goal, tone) {
  return `<div class="mpill"><div class="t">${name}</div><div class="v mono">${r0(val)} <small>/ ${goal} г</small></div>
    <div class="mbar" style="--mc:${tone}"><i class="${val > goal ? 'over' : ''}" style="width:${Math.min(100, (val / goal) * 100)}%"></i></div></div>`;
}
function renderDiary() {
  $('dayTitle').textContent = dayTitle(day);
  const [yy, mm, dd] = day.split('-').map(Number);
  const dateStr = new Date(yy, mm - 1, dd).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  $('dayDate').textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  const list = diary[day] || [];
  const kcalOf = (items) => items.reduce((s, e) => s + calc(e, e.grams).kcal, 0);
  const tot = list.reduce((a, e) => { const v = calc(e, e.grams); a.kcal += v.kcal; a.p += v.p; a.f += v.f; a.c += v.c; return a; }, { kcal: 0, p: 0, f: 0, c: 0 });
  const goal = settings.goal;
  const left = goal - tot.kcal;
  const share = Math.min(100, (tot.kcal / goal) * 100);
  // Ориентиры БЖУ: 20% / 30% / 50% калорий
  const gp = r0((goal * 0.2) / 4), gf = r0((goal * 0.3) / 9), gc = r0((goal * 0.5) / 4);
  const arc = 'M20 120 A100 100 0 0 1 220 120';
  let html = `<section class="hero ${left < 0 ? 'over' : ''}">
    <div class="gauge"><svg viewBox="0 0 240 132" aria-hidden="true">
      <path class="trk" d="${arc}" fill="none" stroke-width="16" stroke-linecap="round"/>
      ${share > 0 ? `<path class="val" d="${arc}" pathLength="100" fill="none" stroke-width="16" stroke-linecap="round" stroke-dasharray="${share} 100"/>` : ''}
    </svg>
    <div class="mid"><div class="n mono">${r0(Math.abs(left))}</div><div class="l">${left >= 0 ? 'ккал осталось' : 'ккал сверх нормы'}</div></div></div>
    <div class="ends"><div><span>Съедено</span><b class="mono">${r0(tot.kcal)} <small>ккал</small></b></div><div><span>Цель</span><b class="mono">${goal} <small>ккал</small></b></div></div>
    <div class="macros">${macroPill('Белки', tot.p, gp, MACRO_TONES.p)}${macroPill('Жиры', tot.f, gf, MACRO_TONES.f)}${macroPill('Углеводы', tot.c, gc, MACRO_TONES.c)}</div>
  </section>`;
  for (const [mk, mn] of MEALS) {
    const items = list.filter((e) => e.meal === mk);
    html += `<section class="meal" style="--mc:var(--c-${mk})"><div class="meal-h">
      <span class="meal-ic"><svg class="i" viewBox="0 0 24 24">${MEAL_ICONS[mk]}</svg></span>
      <div class="meal-t"><b>${mn}</b><span class="mono">${items.length ? r0(kcalOf(items)) + ' ккал' : 'Пока ничего'}</span></div>
      <button class="meal-add" data-addmeal="${mk}" aria-label="Добавить в ${mn.toLowerCase()}"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>`;
    for (const e of items) {
      html += `<div class="row result" data-entry="${e.id}"><div class="name">${esc(e.name)}<small>${r0(e.grams)} г${e.brand ? ' · ' + esc(e.brand) : ''}</small></div><span class="val mono">${r0(calc(e, e.grams).kcal)} ккал</span></div>`;
    }
    html += `</section>`;
  }
  $('diary').innerHTML = html;
}
$('diary').addEventListener('click', (ev) => {
  const add = ev.target.closest('[data-addmeal]');
  if (add) return openSearch(add.dataset.addmeal);
  const row = ev.target.closest('[data-entry]');
  if (row) {
    const e = (diary[day] || []).find((x) => x.id === row.dataset.entry);
    if (e) openPortion(e, e);
  }
});
$('prevDay').onclick = () => { day = shiftDay(day, -1); renderDiary(); pullSoon(day, day); };
$('nextDay').onclick = () => { day = shiftDay(day, 1); renderDiary(); pullSoon(day, day); };

// ---------- Поиск ----------
const baseFoods = BASE_FOODS.concat(typeof EXTRA_FOODS !== 'undefined' ? EXTRA_FOODS : [], typeof DISH_FOODS !== 'undefined' ? DISH_FOODS : [])
  .map((r) => baseFood(r, 0))
  .concat(typeof USDA_FOODS !== 'undefined' ? USDA_FOODS.map((r) => baseFood(r, 1)) : []);
// tier 1 (переведённая база USDA) показываем после своих справочников
function baseFood([name, kcal, p, f, c, alias], tier) {
  return { key: 'b:' + name, src: 'base', tier, name, kcal, p, f, c, hay: norm(name + ' ' + (alias || '').replace(/\|/g, ' ')).replace(/-/g, ' ') };
}
let srcFilter = 'all';
let offSeq = 0;

function openSearch(meal) {
  currentMeal = meal || (day === todayKey() ? guessMeal() : currentMeal);
  fillMealSelect($('mealSelect'), currentMeal);
  $('q').value = '';
  setSrc('all');
  openSheet('searchSheet');
  setTimeout(() => $('q').focus(), 50);
}
$('mealSelect').onchange = (e) => (currentMeal = e.target.value);
$('fabAdd').onclick = () => openSearch();
function setSrc(src) {
  srcFilter = src;
  document.querySelectorAll('#srcTabs button').forEach((b) => b.classList.toggle('on', b.dataset.src === src));
  runSearch();
}
document.querySelectorAll('#srcTabs button').forEach((b) => (b.onclick = () => setSrc(b.dataset.src)));

// Выше — совпадения с начала названия, затем с начала слова, затем внутри слова
function rank(name, w) {
  const n = norm(name);
  if (n.startsWith(w)) return 0;
  if (new RegExp('(^|[\\s,(«"-])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n)) return 1;
  return 2;
}
// Слово запроса совпадает целиком или по основе: «творожную» найдёт «творожная», «роллы» — «ролл»
// Разговорные и альтернативные названия: основа слова → основы, которые ищем вместо неё
const SYNONYMS = {
  картошк: ['картофел'], картофел: ['картошк'], селедк: ['сельд'], сельд: ['селедк'], курочк: ['куриц', 'курин'],
  куриц: ['курин'], курин: ['куриц'], макарош: ['макарон'], шаверм: ['шаурм'], шаурм: ['шаверм'], чебурек: ['чебурек'],
  гречк: ['гречн'], гречн: ['гречк'], свинин: ['свин'], говядин: ['говяж'], говяж: ['говядин'], яичниц: ['глазунь'],
  глазунь: ['яичниц'], пюрешк: ['пюре'], котлетк: ['котлет'], блинчик: ['блин'], оладушк: ['олад'], сосиск: ['сосиск'],
  кофе: ['кофе', 'капучино', 'латте', 'американо'], ролл: ['ролл', 'рол'], суши: ['суши', 'нигири'], бургер: ['бургер', 'гамбургер'],
};
function wordMatcher(w) {
  const stem = w.length >= 5 ? w.slice(0, -2) : w.length === 4 ? w.slice(0, -1) : w;
  const alts = [w, stem];
  for (const [k, v] of Object.entries(SYNONYMS)) if (w.startsWith(k)) alts.push(...v);
  return (hay) => alts.some((x) => hay.includes(x));
}
function matchLocal(list, q) {
  const words = norm(q).replace(/[-,.()«»"]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  const tests = words.map(wordMatcher);
  return list
    .filter((f) => { const n = f.hay || norm(f.name + ' ' + (f.brand || '')); return tests.every((t) => t(n)); })
    .sort((a, b) => rank(a.name, words[0]) - rank(b.name, words[0]) || (a.tier || 0) - (b.tier || 0) || a.name.length - b.name.length);
}
function resultRow(f) {
  const tag = f.src === 'mine' ? ' · мой' : '';
  const sub = f.brand ? esc(f.brand) + tag : tag.slice(3);
  return `<div class="row result" data-key="${esc(f.key)}"><div class="name">${esc(f.name)}${sub ? `<small>${sub}</small>` : ''}</div><span class="val mono">${r0(f.kcal)} ккал</span></div>`;
}
let shown = new Map();
function showResults(groups) {
  shown = new Map();
  let html = '';
  for (const [title, items] of groups) {
    if (!items.length) continue;
    html += `<div class="sec"><span>${title}</span><span>ккал на 100 г</span></div>`;
    html += '<div class="group">' + items.map((f) => { shown.set(f.key, f); return resultRow(f); }).join('') + '</div>';
  }
  $('results').innerHTML = html ? html : '<p class="muted">Ничего не найдено. Создайте свой продукт, он запомнится.</p>';
}
function runSearch() {
  const q = $('q').value;
  if (srcFilter === 'recent') return showResults([['', matchLocal(recent, q)]]);
  if (srcFilter === 'frequent') return showResults([['', matchLocal([...recent].sort((a, b) => (b.count || 1) - (a.count || 1)), q).slice(0, 50)]]);
  if (srcFilter === 'mine') return showResults([['', matchLocal(mine, q)]]);
  if (!q.trim()) return showResults([['Недавние', recent.slice(0, 20)]]);
  const local = [['Мои продукты', matchLocal(mine, q).slice(0, 10)], ['Справочник', matchLocal(baseFoods, q).slice(0, 20)]];
  showResults([...local, ['', []]]);
  clearTimeout(runSearch.t);
  if (norm(q).length < 3) return;
  runSearch.t = setTimeout(async () => {
    const seq = ++offSeq;
    const [shared] = await Promise.all([Sync.searchFoods(q), loadOffDb()]);
    if (seq !== offSeq) return;
    local.splice(1, 0, ['Общая база', shared]);
    let shop = searchOffDb(q);
    showResults([...local, ['Магазинные товары', shop]]);
    if (shop.length >= 10) return;
    $('results').insertAdjacentHTML('beforeend', '<p class="cap muted">Ищу в интернете…</p>');
    const seen = new Set(shop.map((f) => f.key));
    shop = shop.concat((await searchOFF(q)).filter((f) => !seen.has(f.key)));
    if (seq !== offSeq) return;
    showResults([...local, ['Магазинные товары', shop]]);
  }, 300);
}
$('q').addEventListener('input', runSearch);
$('results').addEventListener('click', (ev) => {
  const row = ev.target.closest('[data-key]');
  if (row && shown.has(row.dataset.key)) openPortion(shown.get(row.dataset.key));
});

// ---------- Встроенная база магазинных товаров ----------
let offDb = null, offNorm = null, offByCode = null, offDbLoading = null;
function loadOffDb() {
  if (offDbLoading) return offDbLoading;
  offDbLoading = fetch('data/off-ru.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((rows) => {
      offDb = rows;
      offNorm = rows.map((r) => norm(r[1] + ' ' + r[2]));
      offByCode = new Map(rows.map((r, i) => [r[0], i]));
    });
  return offDbLoading;
}
function offRow(i) {
  const [code, name, brand, kcal, p, f, c, serving] = offDb[i];
  return { key: 'o:' + code, src: 'off', code, name, brand, kcal, p, f, c, serving: serving || null };
}
function searchOffDb(q, limit = 40) {
  if (!offDb) return [];
  const words = norm(q).split(/\s+/).filter(Boolean);
  const res = [];
  for (let i = 0; i < offNorm.length && res.length < limit; i++) {
    if (offDb[i][3] != null && words.every((w) => offNorm[i].includes(w))) res.push(offRow(i));
  }
  return res;
}

// ---------- Open Food Facts ----------
function fromOFF(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184;
  if (kcal == null) return null;
  const name = p.product_name_ru || p.product_name;
  if (!name) return null;
  return {
    key: 'o:' + p.code, src: 'off', code: p.code, name: name.trim(), brand: (p.brands || '').split(',')[0].trim(),
    kcal: +kcal || 0, p: +n.proteins_100g || 0, f: +n.fat_100g || 0, c: +n.carbohydrates_100g || 0,
    serving: +p.serving_quantity || null,
  };
}
async function searchOFF(q) {
  try {
    const url = `https://ru.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.products || []).map(fromOFF).filter(Boolean);
  } catch {
    return [];
  }
}
async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, '');
  if (!code) return;
  const own = mine.find((m) => m.code === code);
  if (own) return openPortion(own);
  const shared = await Sync.foodByCode(code);
  if (shared) return openPortion(shared);
  if (offCache[code]) return openPortion(offCache[code]);
  await loadOffDb();
  if (offByCode.has(code)) {
    const food = offRow(offByCode.get(code));
    if (food.kcal != null) return openPortion(food);
    // Товар известен, но без пищевой ценности: просим один раз переписать с упаковки
    toast('Товар найден, но без калорий. Перепишите их с упаковки один раз');
    return openProductForm({ code, name: food.name });
  }
  toast('Ищу товар…');
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
    const data = await res.json();
    const food = data.status === 1 || data.product ? fromOFF({ ...data.product, code }) : null;
    if (food) {
      offCache[code] = food; store.set('offCache', offCache);
      return openPortion(food);
    }
  } catch {
    toast('Нет связи с базой товаров');
  }
  toast('Товар не найден — заполните его один раз');
  openProductForm({ code });
}

// Отправка нового товара в Open Food Facts: ответ не читаем (CORS), товар уже сохранён локально
function shareToOFF(food) {
  const body = new URLSearchParams({
    code: food.code, product_name: food.name, lang: 'ru', countries: 'Россия',
    nutrition_data_per: '100g', 'nutriment_energy-kcal': food.kcal, 'nutriment_energy-kcal_unit': 'kcal',
    nutriment_proteins: food.p, nutriment_fat: food.f, nutriment_carbohydrates: food.c,
    user_id: settings.offUser, password: settings.offPass || '', comment: 'Kalorii PWA',
  });
  if (food.serving) body.set('serving_size', food.serving + ' g');
  fetch('https://world.openfoodfacts.org/cgi/product_jqm2.pl', { method: 'POST', mode: 'no-cors', body })
    .then(() => toast('Отправлено в общую базу'))
    .catch(() => toast('Не удалось отправить, продукт сохранён у вас'));
}

// ---------- Порция ----------
let portionFood = null;
let editingEntry = null;
function openPortion(food, entry) {
  portionFood = food;
  editingEntry = entry || null;
  $('pName').textContent = food.name + (food.brand ? ' · ' + food.brand : '');
  $('pPer100').textContent = `В 100 г: ${r0(food.kcal)} ккал · Б ${r1(food.p)} · Ж ${r1(food.f)} · У ${r1(food.c)}`;
  $('pGrams').value = entry ? entry.grams : food.lastGrams || food.serving || 100;
  const chips = [50, 100, 150, 200, 250];
  if (food.serving && !chips.includes(food.serving)) chips.unshift(food.serving);
  $('pChips').innerHTML = chips.map((g) => `<button data-g="${g}">${g === food.serving ? 'порция · ' : ''}${g} г</button>`).join('');
  fillMealSelect($('pMeal'), entry ? entry.meal : currentMeal);
  $('pSave').textContent = entry ? 'Сохранить' : 'Добавить';
  $('pDelete').style.display = entry ? 'block' : 'none';
  updatePortion();
  openSheet('portionSheet');
}
function updatePortion() {
  const v = calc(portionFood, +$('pGrams').value || 0);
  $('pKcal').textContent = r0(v.kcal);
  const g = +$('pGrams').value;
  $('pChips').querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('on', +b.dataset.g === g));
  $('pMacros').innerHTML = `<span><b>${r1(v.p)} г</b>белки</span><span><b>${r1(v.f)} г</b>жиры</span><span><b>${r1(v.c)} г</b>углеводы</span>`;
}
$('pGrams').addEventListener('input', updatePortion);
$('pChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-g]');
  if (b) { $('pGrams').value = b.dataset.g; updatePortion(); }
});
$('pSave').onclick = () => {
  const grams = +$('pGrams').value;
  if (!(grams > 0)) return toast('Укажите вес');
  const meal = $('pMeal').value;
  const list = (diary[day] = diary[day] || []);
  let saved = editingEntry;
  if (editingEntry) {
    Object.assign(editingEntry, { grams, meal });
  } else {
    const f = portionFood;
    saved = { id: uid(), meal, grams, key: f.key, name: f.name, brand: f.brand || '', kcal: f.kcal, p: f.p, f: f.f, c: f.c };
    list.push(saved);
    rememberRecent({ ...f, lastGrams: grams });
  }
  store.set('diary', diary);
  Sync.putEntry(saved, day);
  closeSheet('portionSheet'); closeSheet('searchSheet');
  renderDiary();
  toast(editingEntry ? 'Сохранено' : 'Добавлено');
};
$('pDelete').onclick = () => {
  diary[day] = (diary[day] || []).filter((e) => e !== editingEntry);
  store.set('diary', diary);
  Sync.delEntry(editingEntry.id, day);
  closeSheet('portionSheet'); renderDiary();
};
function rememberRecent(food) {
  const prev = recent.find((r) => r.key === food.key);
  food.count = (prev ? prev.count || 1 : 0) + 1;
  recent = [food, ...recent.filter((r) => r.key !== food.key)].slice(0, 200);
  store.set('recent', recent);
}

// ---------- Свой продукт ----------
function openProductForm(pref = {}) {
  $('fName').value = pref.name || $('q').value || '';
  $('fCode').value = pref.code || '';
  ['fKcal', 'fP', 'fF', 'fC', 'fServing'].forEach((id) => ($(id).value = ''));
  $('fShareHint').textContent = Sync.loggedIn() || settings.offUser ? '' : 'Чтобы продукт увидели все, войдите в аккаунт в настройках. Пока он сохранится только у вас.';
  openSheet('productSheet');
}
$('newProduct').onclick = () => openProductForm();
$('fSave').onclick = async () => {
  const name = $('fName').value.trim();
  const kcal = parseFloat($('fKcal').value.replace(',', '.'));
  if (!name || !(kcal >= 0)) return toast('Нужны название и калории');
  const num = (id) => parseFloat($(id).value.replace(',', '.')) || 0;
  const code = $('fCode').value.replace(/\D/g, '');
  const id = uid();
  const food = { key: 'm:' + id, src: 'mine', name, code, kcal, p: num('fP'), f: num('fF'), c: num('fC'), serving: num('fServing') || null };
  mine = [food, ...mine.filter((m) => !(code && m.code === code))];
  store.set('mine', mine);
  if ($('fShare').checked) {
    if (Sync.loggedIn()) Sync.shareFood(food).then((r) => r && toast('Добавлено в общую базу'));
    if (code && settings.offUser) shareToOFF(food);
  }
  closeSheet('productSheet');
  openPortion(food);
};

// ---------- Сканер штрихкодов ----------
let stream = null, scanning = false, zxingReader = null;
async function startScan() {
  currentMeal = $('searchSheet').classList.contains('open') ? $('mealSelect').value : (day === todayKey() ? guessMeal() : currentMeal);
  openSheet('scanSheet');
  $('manualCode').value = '';
  $('scanStatus').textContent = 'Запускаю камеру…';
  const video = $('video');
  try {
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      scanning = true;
      $('scanStatus').textContent = 'Держите штрихкод в кадре';
      const tick = async () => {
        if (!scanning) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) return onCode(codes[0].rawValue);
        } catch {}
        setTimeout(tick, 200);
      };
      tick();
    } else {
      await loadZXing();
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.CODE_128]);
      zxingReader = new ZXing.BrowserMultiFormatReader(hints);
      scanning = true;
      $('scanStatus').textContent = 'Держите штрихкод в кадре';
      await zxingReader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (result) => {
        if (result && scanning) onCode(result.getText());
      });
    }
  } catch (e) {
    $('scanStatus').textContent = 'Камера недоступна. Разрешите доступ к камере или введите цифры вручную.';
  }
}
function loadZXing() {
  if (window.ZXing) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
    s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}
function stopScan() {
  scanning = false;
  if (zxingReader) { try { zxingReader.reset(); } catch {} zxingReader = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}
function onCode(code) {
  if (navigator.vibrate) navigator.vibrate(60);
  closeSheet('scanSheet');
  lookupBarcode(code);
}
$('fabScan').onclick = startScan;
$('scanFromSearch').onclick = startScan;
$('manualGo').onclick = () => onCode($('manualCode').value);

// ---------- Настройки и резервная копия ----------
$('openSettings').onclick = () => {
  $('sGoal').value = settings.goal;
  $('sOffUser').value = settings.offUser || '';
  $('sOffPass').value = settings.offPass || '';
  $('sServer').value = settings.server || '';
  renderAccount();
  openSheet('settingsSheet');
};
$('sSave').onclick = () => {
  const g = parseInt($('sGoal').value, 10);
  if (g > 0) settings.goal = g;
  settings.offUser = $('sOffUser').value.trim();
  settings.offPass = $('sOffPass').value;
  settings.server = $('sServer').value.trim();
  store.set('settings', settings);
  Sync.saveGoal(settings.goal);
  closeSheet('settingsSheet'); renderDiary();
};
$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ v: 1, settings: { ...settings, offPass: undefined }, diary, mine, recent }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kalorii-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.settings) settings = { ...settings, ...data.settings, offPass: settings.offPass };
    if (data.diary) diary = data.diary;
    if (data.mine) mine = data.mine;
    if (data.recent) recent = data.recent;
    ['settings', 'diary', 'mine', 'recent'].forEach((k) => store.set(k, { settings, diary, mine, recent }[k]));
    toast('Копия загружена'); closeSheet('settingsSheet'); renderDiary();
  } catch {
    toast('Не удалось прочитать файл');
  }
};

// ---------- Аккаунт и синхронизация ----------
function renderAccount() {
  const user = Sync.user;
  $('accOut').hidden = !!user;
  $('accIn').hidden = !user;
  $('serverRow').hidden = !!user || (Sync.available() && !settings.server);
  if (user) {
    const pending = Sync.pending;
    $('accInfo').textContent = `Вы вошли как ${user.email}. ` + (pending ? `Ждут отправки: ${pending}.` : 'Всё сохранено на сервере.');
  }
}
async function accountAction(register) {
  settings.server = $('sServer').value.trim();
  store.set('settings', settings);
  const email = $('aEmail').value.trim(), pass = $('aPass').value;
  if (!Sync.available()) return toast('Укажите адрес сервера');
  if (!email || !pass) return toast('Введите почту и пароль');
  try {
    const user = await (register ? Sync.register(email, pass) : Sync.login(email, pass));
    $('aPass').value = '';
    if (user.goal > 0) settings.goal = user.goal; else Sync.saveGoal(settings.goal);
    store.set('settings', settings);
    await Sync.uploadAll(diary);
    await pullRecent();
    renderAccount(); renderDiary();
    toast(register ? 'Аккаунт создан' : 'Вы вошли');
  } catch (e) {
    toast(e.message || 'Нет связи с сервером');
  }
}
$('aLogin').onclick = () => accountAction(false);
$('aRegister').onclick = () => accountAction(true);
$('aLogout').onclick = () => { Sync.logout(); renderAccount(); toast('Вы вышли. Записи остались на телефоне'); };

function applyRemote(byDay, from, to, pending) {
  const days = new Set([...Object.keys(byDay), ...Object.keys(diary).filter((d) => d >= from && d <= to)]);
  for (const d of days) {
    const keep = (diary[d] || []).filter((e) => pending.has(e.id));
    const remote = (byDay[d] || []).filter((e) => !pending.has(e.id));
    const merged = [...remote, ...keep];
    if (merged.length) diary[d] = merged; else delete diary[d];
  }
  store.set('diary', diary);
  renderDiary();
}
function pullRecent() { return Sync.pull(shiftDay(todayKey(), -30), shiftDay(todayKey(), 1)).catch(() => {}); }
function pullSoon(from, to) { clearTimeout(pullSoon.t); pullSoon.t = setTimeout(() => Sync.pull(from, to).catch(() => {}), 400); }
Sync.init({
  getEntry: (id, d) => (diary[d] || []).find((e) => e.id === id),
  applyRemote,
  onStatus: (why) => {
    if (why === 'visible') pullRecent();
    if ($('settingsSheet').classList.contains('open')) renderAccount();
  },
});

// ---------- Старт ----------
renderDiary();
pullRecent();
setTimeout(loadOffDb, 1500);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
