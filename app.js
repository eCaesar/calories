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
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
const MEAL_TONES = { breakfast: 'var(--m1)', lunch: 'var(--m2)', dinner: 'var(--m3)', snack: 'var(--m4)' };
function macroRow(name, val, goal) {
  // Шкала до 150% цели, засечка — цель
  const max = goal * 1.5;
  return `<div class="macro"><span>${name}</span>
    <div class="mbar"><i class="${val > goal ? 'over' : ''}" style="width:${Math.min(100, (val / max) * 100)}%"></i><u style="left:${(goal / max) * 100}%"></u></div>
    <span class="mono"><b>${r0(val)}</b> / ${goal} г</span></div>`;
}
function renderDiary() {
  $('dayTitle').textContent = dayTitle(day);
  const [yy, mm, dd] = day.split('-').map(Number);
  $('dayDate').textContent = new Date(yy, mm - 1, dd).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  const list = diary[day] || [];
  const kcalOf = (items) => items.reduce((s, e) => s + calc(e, e.grams).kcal, 0);
  const tot = list.reduce((a, e) => { const v = calc(e, e.grams); a.kcal += v.kcal; a.p += v.p; a.f += v.f; a.c += v.c; return a; }, { kcal: 0, p: 0, f: 0, c: 0 });
  const goal = settings.goal;
  const left = goal - tot.kcal;
  // Линейка: шкала до max(цель×1.25, съедено), засечки каждые 250 ккал
  const scale = Math.max(goal * 1.25, tot.kcal);
  const pct = (v) => (v / scale) * 100;
  let x = 0, segs = '', legend = '';
  for (const [mk, mn] of MEALS) {
    const k = kcalOf(list.filter((e) => e.meal === mk));
    const inGoal = Math.max(0, Math.min(k, goal - x));
    if (inGoal > 0) segs += `<div class="seg" style="left:${pct(x)}%;width:${pct(inGoal)}%;background:${MEAL_TONES[mk]}"></div>`;
    x += k;
    if (k > 0) legend += `<span class="cap"><i style="background:${MEAL_TONES[mk]}"></i>${mn} ${r0(k)}</span>`;
  }
  if (tot.kcal > goal) segs += `<div class="overseg" style="left:${pct(goal)}%;width:${pct(tot.kcal - goal)}%"></div>`;
  // Ориентиры БЖУ: 20% / 30% / 50% калорий
  const gp = r0((goal * 0.2) / 4), gf = r0((goal * 0.3) / 9), gc = r0((goal * 0.5) / 4);
  let html = `<div class="eq mono"><span><b>${goal}</b> цель</span><span>−</span><span><b>${r0(tot.kcal)}</b> съедено</span><span>=</span></div>
    <div class="left ${left < 0 ? 'over' : ''}"><span class="n mono">${r0(Math.abs(left))}</span><span class="cap">${left >= 0 ? 'ккал осталось' : 'ккал сверх нормы'}</span></div>
    <div class="ruler" style="--tick:${pct(250)}%"><div class="track"></div>${segs}<div class="target" style="left:calc(${pct(goal)}% - 1px)"></div></div>
    <div class="legend">${legend || '<span class="cap">Пока ничего не съедено</span>'}</div>
    ${macroRow('Белки', tot.p, gp)}${macroRow('Жиры', tot.f, gf)}${macroRow('Углеводы', tot.c, gc)}`;
  for (const [mk, mn] of MEALS) {
    const items = list.filter((e) => e.meal === mk);
    html += `<section class="meal"><div class="meal-h"><span class="cap">${mn}</span><span class="k mono">${items.length ? r0(kcalOf(items)) + ' ккал' : ''}</span></div>`;
    for (const e of items) {
      html += `<div class="row result" data-entry="${e.id}"><div class="name">${esc(e.name)}${e.brand ? `<small>${esc(e.brand)}</small>` : ''}</div><span class="g mono">${r0(e.grams)} г</span><span class="val mono">${r0(calc(e, e.grams).kcal)}</span></div>`;
    }
    html += `<button class="meal-add" data-addmeal="${mk}"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Добавить</button></section>`;
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
$('prevDay').onclick = () => { day = shiftDay(day, -1); renderDiary(); };
$('nextDay').onclick = () => { day = shiftDay(day, 1); renderDiary(); };

// ---------- Поиск ----------
const baseFoods = BASE_FOODS.map(([name, kcal, p, f, c]) => ({ key: 'b:' + name, src: 'base', name, kcal, p, f, c }));
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
function matchLocal(list, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list
    .filter((f) => { const n = norm(f.name + ' ' + (f.brand || '')); return words.every((w) => n.includes(w)); })
    .sort((a, b) => rank(a.name, words[0]) - rank(b.name, words[0]));
}
function resultRow(f) {
  const tag = f.src === 'mine' ? ' · мой' : '';
  const sub = f.brand ? esc(f.brand) + tag : tag.slice(3);
  return `<div class="row result" data-key="${esc(f.key)}"><div class="name">${esc(f.name)}${sub ? `<small>${sub}</small>` : ''}</div><span class="val mono">${r0(f.kcal)}</span></div>`;
}
let shown = new Map();
function showResults(groups) {
  shown = new Map();
  let html = '';
  for (const [title, items] of groups) {
    if (!items.length) continue;
    if (title) html += `<p class="cap muted">${title}</p>`;
    html += '<div class="group">' + items.map((f) => { shown.set(f.key, f); return resultRow(f); }).join('') + '</div>';
  }
  $('results').innerHTML = html ? '<p class="cap muted" style="text-align:right;margin:10px 0 -18px">ккал / 100 г</p>' + html : '<p class="muted">Ничего не найдено. Создайте свой продукт, он запомнится.</p>';
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
    await loadOffDb();
    if (seq !== offSeq) return;
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
    if (words.every((w) => offNorm[i].includes(w))) res.push(offRow(i));
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
  if (offCache[code]) return openPortion(offCache[code]);
  await loadOffDb();
  if (offByCode.has(code)) return openPortion(offRow(offByCode.get(code)));
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
  $('pPer100').textContent = `100 г — ${r0(food.kcal)} ккал · Б ${r1(food.p)} · Ж ${r1(food.f)} · У ${r1(food.c)}`;
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
  $('pMacros').innerHTML = `<span>Б <b>${r1(v.p)}</b></span><span>Ж <b>${r1(v.f)}</b></span><span>У <b>${r1(v.c)}</b></span>`;
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
  if (editingEntry) {
    Object.assign(editingEntry, { grams, meal });
  } else {
    const f = portionFood;
    list.push({ id: uid(), meal, grams, key: f.key, name: f.name, brand: f.brand || '', kcal: f.kcal, p: f.p, f: f.f, c: f.c });
    rememberRecent({ ...f, lastGrams: grams });
  }
  store.set('diary', diary);
  closeSheet('portionSheet'); closeSheet('searchSheet');
  renderDiary();
  toast(editingEntry ? 'Сохранено' : 'Добавлено');
};
$('pDelete').onclick = () => {
  diary[day] = (diary[day] || []).filter((e) => e !== editingEntry);
  store.set('diary', diary);
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
  $('fShareHint').textContent = settings.offUser ? '' : 'Чтобы отправлять, укажите аккаунт Open Food Facts в настройках. Без него продукт сохранится только у вас.';
  openSheet('productSheet');
}
$('newProduct').onclick = () => openProductForm();
$('fSave').onclick = () => {
  const name = $('fName').value.trim();
  const kcal = parseFloat($('fKcal').value.replace(',', '.'));
  if (!name || !(kcal >= 0)) return toast('Нужны название и калории');
  const num = (id) => parseFloat($(id).value.replace(',', '.')) || 0;
  const code = $('fCode').value.replace(/\D/g, '');
  const id = uid();
  const food = { key: 'm:' + id, src: 'mine', name, code, kcal, p: num('fP'), f: num('fF'), c: num('fC'), serving: num('fServing') || null };
  mine = [food, ...mine.filter((m) => !(code && m.code === code))];
  store.set('mine', mine);
  if (code && $('fShare').checked && settings.offUser) shareToOFF(food);
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
  openSheet('settingsSheet');
};
$('sSave').onclick = () => {
  const g = parseInt($('sGoal').value, 10);
  if (g > 0) settings.goal = g;
  settings.offUser = $('sOffUser').value.trim();
  settings.offPass = $('sOffPass').value;
  store.set('settings', settings);
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

// ---------- Старт ----------
renderDiary();
setTimeout(loadOffDb, 1500);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
