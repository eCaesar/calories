"""Собирает компактную базу товаров из выгрузки Open Food Facts.

Берёт товары, продающиеся в России/Беларуси/Казахстане (по стране или по
штрихкоду 460–469, 481, 487), у которых указаны калории. Результат —
data/off-ru.json: [[штрихкод, название, бренд, ккал, б, ж, у, порция], ...]
Запуск: python scripts/build_off_ru.py < products.csv  (CSV из дампа OFF)
"""
import csv
import json
import os
import sys

COUNTRIES = ("en:russia", "en:belarus", "en:kazakhstan")
PREFIXES = tuple(str(p) for p in range(460, 470)) + ("481", "487")


def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if 0 <= x < 1000 else None


def main():
    csv.field_size_limit(sys.maxsize)
    reader = csv.DictReader(sys.stdin, delimiter="\t", quoting=csv.QUOTE_NONE)
    seen = set()
    out = []
    stats = {"rows": 0, "ru": 0, "no_name": 0, "no_kcal": 0}
    for row in reader:
        stats["rows"] += 1
        code = (row.get("code") or "").strip()
        if not code.isdigit() or code in seen:
            continue
        countries = row.get("countries_tags") or ""
        if not (code.startswith(PREFIXES) or any(c in countries for c in COUNTRIES)):
            continue
        stats["ru"] += 1
        name = (row.get("product_name") or row.get("abbreviated_product_name") or row.get("generic_name") or "").strip()
        kcal = num(row.get("energy-kcal_100g"))
        if kcal is None:
            kj = num(row.get("energy_100g"))
            kcal = kj / 4.184 if kj is not None else None
        if not name:
            stats["no_name"] += 1
            continue
        if kcal is None or kcal > 950:
            stats["no_kcal"] += 1
            continue
        p, f, c = (num(row.get(k)) or 0 for k in ("proteins_100g", "fat_100g", "carbohydrates_100g"))
        serving = num(row.get("serving_quantity"))
        brand = (row.get("brands") or "").split(",")[0].strip()
        seen.add(code)
        out.append([code, name[:120], brand[:40], round(kcal), round(p, 1), round(f, 1), round(c, 1),
                    round(serving) if serving else 0])
    os.makedirs("data", exist_ok=True)
    with open("data/off-ru.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    stats["products"] = len(out)
    stats["columns"] = reader.fieldnames[:400] if reader.fieldnames else []
    with open("data/stats.json", "w", encoding="utf-8") as fh:
        json.dump(stats, fh, ensure_ascii=False)
    print(f"products: {len(out)}", file=sys.stderr)


if __name__ == "__main__":
    main()
