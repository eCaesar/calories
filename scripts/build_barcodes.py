"""Справочник штрихкодов без пищевой ценности: Universe-HTT (около 5,7 млн кодов,
среди них 1,5 млн российских и белорусских). Берём продукты питания и
неразобранные коды России, Беларуси и Казахстана, которых нет в data/off-ru.json
с калориями. По такому коду приложение узнаёт название, подбирает похожее блюдо
из справочника и просит проверить цифры по упаковке.

Результат: data/bc/<первые 5 цифр>.json = {код: [название, бренд, категория]}
и data/bc-stats.json. Запуск после build_off_ru.py: python scripts/build_barcodes.py
"""
import csv
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

URL = "https://github.com/papyrussolution/UhttBarcodeReference/releases/download/20230913/uhtt_barcode_ref_all.7z"
SRC = "uhtt/uhtt_barcode_ref_all.csv"
CIS = re.compile(r"^(46\d|481|487)")


def main():
    if not os.path.exists(SRC):
        os.makedirs("uhtt", exist_ok=True)
        subprocess.run(["curl", "-fsSL", "-o", "uhtt/all.7z", URL], check=True)
        subprocess.run(["7z", "x", "-y", "-ouhtt", "uhtt/all.7z"], check=True, stdout=subprocess.DEVNULL)
    off = {r[0]: r[3] is not None for r in json.load(open("data/off-ru.json", encoding="utf-8"))}
    shards = defaultdict(dict)
    st = {"cis_food": 0, "cis_food_in_off": 0, "cis_food_in_off_kcal": 0, "added": 0}
    csv.field_size_limit(sys.maxsize)
    with open(SRC, encoding="utf-8", errors="replace", newline="") as fh:
        for row in csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            if len(row) < 7 or not row[1].isdigit():
                continue
            code, name, cat, brand = row[1], row[2].strip(), row[4], row[6].strip()
            food = cat.startswith("Продукты питания")
            cis = bool(CIS.match(code)) and len(code) == 13
            if not name or not (food or (cis and cat.startswith("Неклассифицированные"))):
                continue
            if food and cis:
                st["cis_food"] += 1
                if code in off:
                    st["cis_food_in_off"] += 1
                    st["cis_food_in_off_kcal"] += off[code]
            if off.get(code):
                continue
            leaf = cat.replace(" (folder)", "").split("/")[-1] if food else ""
            shards[code[:5]][code] = [name[:120], brand[:40], leaf[:40]]
            st["added"] += 1
    os.makedirs("data/bc", exist_ok=True)
    for k, v in shards.items():
        with open(f"data/bc/{k}.json", "w", encoding="utf-8") as fh:
            json.dump(v, fh, ensure_ascii=False, separators=(",", ":"))
    st["files"] = len(shards)
    json.dump(st, open("data/bc-stats.json", "w"), ensure_ascii=False)
    print(f"::notice::Штрихкоды Universe-HTT: {json.dumps(st, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
