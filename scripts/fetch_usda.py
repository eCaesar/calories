"""Скачивает открытые таблицы USDA FoodData Central (общественное достояние):
SR Legacy (базовые продукты) и FNDDS / Survey (готовые блюда), и сохраняет
компактный список [fdc_id, english name, ккал, б, ж, у] на 100 г в sources/usda-*.json.
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

PAGE = "https://fdc.nal.usda.gov/download-datasets"
BASE = "https://fdc.nal.usda.gov/fdc-datasets/"
NUTR = {"1008": "kcal", "1003": "p", "1004": "f", "1005": "c", "2047": "kcal_at", "2048": "kcal_sp"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 kalorii-build"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def find(kind):
    html = get(PAGE).decode("utf-8", "ignore")
    names = sorted(set(re.findall(rf"FoodData_Central_{kind}_csv_[0-9-]+\.zip", html)))
    if not names:
        raise SystemExit(f"::error::не нашёл ссылку на {kind} на {PAGE}")
    return BASE + names[-1]


def extract(url):
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    files = {os.path.basename(n): n for n in z.namelist()}
    read = lambda name: csv.DictReader(io.TextIOWrapper(z.open(files[name]), encoding="utf-8"))
    foods = {r["fdc_id"]: r["description"] for r in read("food.csv")}
    vals = {}
    for r in read("food_nutrient.csv"):
        key = NUTR.get(r["nutrient_id"])
        if key and r["fdc_id"] in foods and r["amount"]:
            vals.setdefault(r["fdc_id"], {})[key] = float(r["amount"])
    out = []
    for fid, name in foods.items():
        v = vals.get(fid, {})
        kcal = v.get("kcal", v.get("kcal_at", v.get("kcal_sp")))
        if kcal is None:
            continue
        out.append([int(fid), name, round(kcal), round(v.get("p", 0), 1), round(v.get("f", 0), 1), round(v.get("c", 0), 1)])
    return out


CIQUAL = "https://ciqual.anses.fr/cms/sites/default/files/inline-files/Table%20Ciqual%202020_ENG_2020%2007%2007.xls"


def num(v):
    v = str(v or "").replace(",", ".").replace("<", "").strip()
    try:
        return float(v)
    except ValueError:
        return 0.0 if v.lower() == "traces" else None


def ciqual():
    """CIQUAL (ANSES, Франция): открытая лицензия Etalab, около 3 тыс. продуктов и блюд."""
    import xlrd
    sheet = xlrd.open_workbook(file_contents=get(CIQUAL)).sheet_by_index(0)
    head = [str(h) for h in sheet.row_values(0)]
    col = lambda part: next(i for i, h in enumerate(head) if part in h)
    i_name, i_kcal = col("alim_nom_eng"), col("(kcal/100g)")
    i_p, i_f, i_c = col("Protein"), col("Fat (g/100g)"), col("Carbohydrate (g/100g)")
    out = []
    for r in range(1, sheet.nrows):
        row = sheet.row_values(r)
        kcal = num(row[i_kcal])
        if kcal is None or not row[i_name]:
            continue
        out.append([int(num(row[0]) or r), str(row[i_name]).strip(), round(kcal),
                    round(num(row[i_p]) or 0, 1), round(num(row[i_f]) or 0, 1), round(num(row[i_c]) or 0, 1)])
    return out


def main():
    os.makedirs("sources", exist_ok=True)
    try:
        rows = ciqual()
        with open("sources/ciqual.json", "w", encoding="utf-8") as fh:
            json.dump(rows, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"::notice::ciqual.json: {len(rows)} строк")
    except Exception as e:
        print(f"::error::ciqual: {type(e).__name__}: {str(e)[:400]}")
    for kind, file in (("sr_legacy_food", "usda-sr.json"), ("survey_food", "usda-fndds.json"), ("foundation_food", "usda-foundation.json")):
        try:
            url = find(kind)
            rows = extract(url)
            with open(f"sources/{file}", "w", encoding="utf-8") as fh:
                json.dump(rows, fh, ensure_ascii=False, separators=(",", ":"))
            print(f"::notice::{file}: {len(rows)} строк из {url}")
        except Exception as e:  # одна таблица может не скачаться, остальные всё равно сохраним
            print(f"::error::{kind}: {type(e).__name__}: {str(e)[:400]}")


if __name__ == "__main__":
    main()
