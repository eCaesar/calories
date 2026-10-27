"""Собирает компактную базу товаров из Parquet-выгрузки Open Food Facts.

Берёт товары России и СНГ: по стране продажи, по штрихкоду (460–469 Россия,
481 Беларусь, 487 Казахстан) или по наличию русского названия. Калории берутся
в ккал, иначе пересчитываются из кДж или из БЖУ. Товары без пищевой ценности
тоже попадают в базу (ккал = null): по штрихкоду приложение узнает название
и попросит один раз переписать калории с упаковки.

Результат — data/off-ru.json: [[штрихкод, название, бренд, ккал|null, б, ж, у, порция], ...]
и data/stats.json со счётчиками. Запуск: python scripts/build_off_ru.py
"""
import json
import os

import duckdb

URL = "https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet"
COUNTRIES = ["en:russia", "en:belarus", "en:kazakhstan", "en:ukraine", "en:uzbekistan", "en:kyrgyzstan",
             "en:armenia", "en:georgia", "en:moldova", "en:azerbaijan", "en:tajikistan"]

QUERY = f"""
WITH p AS (
  SELECT code, product_name AS pn, brands, nutriments AS nu, serving_quantity AS sq,
         list_filter(product_name, x -> x.lang = 'ru' AND x.text <> '') AS ru
  FROM read_parquet('{URL}')
  WHERE code IS NOT NULL AND (
    list_has_any(countries_tags, {COUNTRIES})
    OR regexp_matches(code, '^(46[0-9]|481|487)')
    OR len(list_filter(product_name, x -> x.lang = 'ru' AND x.text <> '')) > 0)
)
SELECT code,
  coalesce(nullif(trim(ru[1].text), ''), nullif(trim(list_filter(pn, x -> x.lang = 'main')[1].text), ''),
           nullif(trim(pn[1].text), '')) AS name,
  brands,
  list_filter(nu, x -> x.name = 'energy-kcal')[1]."100g" AS kcal,
  list_filter(nu, x -> x.name = 'energy')[1]."100g" AS kj,
  list_filter(nu, x -> x.name = 'proteins')[1]."100g" AS p,
  list_filter(nu, x -> x.name = 'fat')[1]."100g" AS f,
  list_filter(nu, x -> x.name = 'carbohydrates')[1]."100g" AS c,
  sq
FROM p
"""


def val(x, top=1000):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if 0 <= x < top else None


def main():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    stats = {"matched": 0, "no_name": 0, "kcal": 0, "kcal_from_kj": 0, "kcal_from_macros": 0, "name_only": 0}
    out, seen = [], set()
    for code, name, brands, kcal, kj, p, f, c, sq in con.execute(QUERY).fetchall():
        stats["matched"] += 1
        code = (code or "").strip()
        if not code.isdigit() or code in seen:
            continue
        if not name:
            stats["no_name"] += 1
            continue
        p, f, c = val(p), val(f), val(c)
        k = val(kcal, 950)
        if k is not None:
            stats["kcal"] += 1
        elif val(kj, 4000) is not None:
            k = val(kj, 4000) / 4.184
            stats["kcal_from_kj"] += 1
        elif p is not None and f is not None and c is not None and (p + f + c) > 0:
            k = 4 * p + 9 * f + 4 * c
            stats["kcal_from_macros"] += 1
        else:
            stats["name_only"] += 1
        serving = val(sq, 10000)
        brand = (brands or "").split(",")[0].strip()
        seen.add(code)
        out.append([code, name[:120], brand[:40], round(k) if k is not None else None,
                    round(p or 0, 1), round(f or 0, 1), round(c or 0, 1), round(serving) if serving else 0])
    os.makedirs("data", exist_ok=True)
    with open("data/off-ru.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    stats["products"] = len(out)
    with open("data/stats.json", "w", encoding="utf-8") as fh:
        json.dump(stats, fh, ensure_ascii=False)
    print(f"::notice::База товаров: {json.dumps(stats, ensure_ascii=False)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # чтобы причина была видна в аннотациях GitHub Actions
        print(f"::error::{type(e).__name__}: {str(e)[:900]}")
        raise
