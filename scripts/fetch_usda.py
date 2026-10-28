"""Собирает открытые таблицы USDA FoodData Central (общественное достояние)
с зеркала на Hugging Face: SR Legacy и Foundation (базовые продукты) и
FNDDS / Survey (готовые блюда). Сохраняет sources/usda.json:
[fdc_id, тип, english name, ккал, б, ж, у] на 100 г.
"""
import json
import os
import duckdb

HF = "https://huggingface.co/datasets/yvfu/FoodData_Central_csv_2025-04-24/resolve/main/"
os.makedirs("sources", exist_ok=True)
for f in ("food.csv", "food_nutrient.csv"):
    if not os.path.exists(f):
        os.system(f"curl -fsSL -o {f} {HF}{f}")

con = duckdb.connect()
rows = con.execute("""
WITH f AS (
  SELECT fdc_id, data_type, description FROM read_csv('food.csv', all_varchar=true)
  WHERE data_type IN ('sr_legacy_food', 'foundation_food', 'survey_fndds_food')
),
n AS (
  SELECT fdc_id,
    max(CASE WHEN nutrient_id = '1008' THEN TRY_CAST(amount AS DOUBLE) END) kcal,
    max(CASE WHEN nutrient_id = '2048' THEN TRY_CAST(amount AS DOUBLE) END) kcal_sp,
    max(CASE WHEN nutrient_id = '2047' THEN TRY_CAST(amount AS DOUBLE) END) kcal_at,
    max(CASE WHEN nutrient_id = '1003' THEN TRY_CAST(amount AS DOUBLE) END) p,
    max(CASE WHEN nutrient_id = '1004' THEN TRY_CAST(amount AS DOUBLE) END) fat,
    max(CASE WHEN nutrient_id = '1005' THEN TRY_CAST(amount AS DOUBLE) END) c
  FROM read_csv('food_nutrient.csv', all_varchar=true)
  WHERE nutrient_id IN ('1008', '2047', '2048', '1003', '1004', '1005')
    AND fdc_id IN (SELECT fdc_id FROM f)
  GROUP BY fdc_id
)
SELECT CAST(f.fdc_id AS BIGINT), f.data_type, f.description,
  round(coalesce(n.kcal, n.kcal_sp, n.kcal_at)), round(coalesce(n.p, 0), 1), round(coalesce(n.fat, 0), 1), round(coalesce(n.c, 0), 1)
FROM f JOIN n USING (fdc_id)
WHERE coalesce(n.kcal, n.kcal_sp, n.kcal_at) IS NOT NULL
ORDER BY f.data_type, f.description
""").fetchall()
short = {"sr_legacy_food": "sr", "foundation_food": "fd", "survey_fndds_food": "fndds"}
out = [[r[0], short[r[1]], r[2], int(r[3]), r[4], r[5], r[6]] for r in rows]
json.dump(out, open("sources/usda.json", "w"), ensure_ascii=False, separators=(",", ":"))
counts = {k: sum(1 for r in out if r[1] == k) for k in short.values()}
print(f"::notice::USDA: {len(out)} строк, {counts}")
