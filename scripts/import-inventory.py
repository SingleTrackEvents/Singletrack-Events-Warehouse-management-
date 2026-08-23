#!/usr/bin/env python3
"""
Turn the consolidated warehouse spreadsheet into the app's starting catalogue.

    pip install openpyxl
    python3 scripts/import-inventory.py path/to/SingleTrack_Consolidated_Warehouse_Inventory.xlsx

Writes src/db/catalogue.ts. Re-run it when the spreadsheet changes rather than
editing the generated file, so the warehouse list and the app cannot drift.

What the spreadsheet holds, and what becomes of it:
  * Category / Item          -> the categories and the item catalogue
  * per-event columns        -> one packing template per event
  * MAX at any one event     -> the item's minimum stock level
It does NOT hold a physical count. The sheet says so itself, so the generated
catalogue carries no quantities on hand; that is what a stocktake is for.
"""
import re
import sys
from pathlib import Path

import openpyxl

# Short codes for labels, in category order.
PREFIXES = [
    'STR', 'ANC', 'WAT', 'KIT', 'PWR', 'LGT', 'CKG', 'SRV', 'HYG', 'MED',
    'WST', 'CRS', 'COM', 'VIL', 'REG', 'TLS', 'FIR', 'CLD', 'FRN', 'OTH',
]

ICONS = {
    'Structure & Shelter': '⛺', 'Anchoring & Weights': '⚓', 'Water & Ice': '💧',
    'Aid Station Kits': '🧰', 'Power & Cabling': '🔌', 'Lighting': '💡',
    'Cooking & Heating': '🔥', 'Serving & Catering': '🍽', 'Hygiene & Consumables': '🧼',
    'Medical & Welfare': '🚑', 'Waste Management': '🗑', 'Course Marking & Traffic': '🚧',
    'Comms & AV': '📡', 'Event Village & Branding': '🎪', 'Registration, Merch & Timing': '⏱',
    'Tools & Hardware': '🔧', 'Fire (where permitted)': '🪵', 'Cold Chain & Drop Bags': '🧊',
    'Furniture & Site Equipment': '🪑', 'Other / Review': '📦',
}

# Used up at an event rather than coming back, matched on the item name. Word
# boundaries matter here: without them "Teardrop Banners" matches "tea" and
# "Tripod Light - Battery" matches "batteries".
CONSUMABLE = re.compile(
    r'\btoilet paper\b|\bsunscreen\b|\bsanitis|\bsponges?\b|\bpaper towel\b|\bponchos?\b'
    r'|\bgloves?\b|\bsanitary\b|\bbin bags\b|\bfreezer bags\b|\bfoil\b|\bsafety pins\b'
    r'|\bbatteries\b|\bglow sticks\b|\bcable ties\b|\bgaffa\b|\bbunting\b|\bfirewood\b'
    r'|\bkindling\b|\bfirestarters?\b|\bmatches\b|\bmilo\b|\bcoffee\b|\bmedals?\b'
    r'|\bmerchandise\b|\bprinter ink\b|\bpaper \(packs\)|\blaminator sheets\b'
    r'|\bdrop bags\b|\bfinisher tape\b|\bstationery\b|\bwooden stakes\b|\bcups \(bulk\)'
    r'|\brace bibs\b|\bkids activity\b',
    re.I,
)

# Anything not counted one by one.
UNITS = [
    (re.compile(r'\bbin bags\b|\bfoil\b|\btrack mat\b|\bcarpet\b|\bbunting\b'
                r'|\bgaffa tape\b|\btoilet paper\b|\bfinisher tape\b', re.I), 'roll'),
    (re.compile(r'\bsafety pins\b|\bbatteries\b|\bcable ties\b|\bfreezer bags\b'
                r'|\bglow sticks\b', re.I), 'pack'),
    (re.compile(r'\bfirewood\b|\bkindling\b', re.I), 'bag'),
]

EVENTS = {
    'KT': ('Kilcunda Trail Running Festival', 2026),
    'BB': ('Snow Gum Run / Razorback Run', 2026),
    'BSF': ('Buffalo Stampede', 2026),
    'AC': ('Alpine Challenge', 2026),
    'WP': ('Wilsons Prom', 2026),
    'WR': ('Wonderland Run', 2026),
    'HC': ('Hounslow Classic', 2025),
    'PBRF': ('Puffing Billy Running Festival', 2025),
    'RCR': ('Roller Coaster Run', 2025),
    'GPT': ('GPT100', 2025),
}


def slug(value: str) -> str:
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', value.lower())).strip('-')


def unit_for(name: str) -> str:
    for pattern, unit in UNITS:
        if pattern.search(name):
            return unit
    return 'each'


def ts(value) -> str:
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace('\\', '\\\\').replace("'", "\\'") + "'"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    workbook = openpyxl.load_workbook(sys.argv[1], data_only=True)
    rows = list(workbook['Master Inventory'].iter_rows(min_row=5, values_only=True))
    header = rows[0]
    codes = [header[i] for i in range(2, 12)]

    categories: list[dict] = []
    category = None
    for row in rows[1:]:
        if row[0] and not row[1]:
            # "01. Structure & Shelter" -> "Structure & Shelter"
            name = re.sub(r'^\d+\.\s*', '', row[0]).strip()
            category = {'name': name, 'items': []}
            categories.append(category)
            continue
        if not row[1] or category is None:
            continue
        name = ' '.join(str(row[1]).split())
        hold = row[12] if isinstance(row[12], (int, float)) else 0
        needs = {
            codes[i - 2]: int(row[i])
            for i in range(2, 12)
            if isinstance(row[i], (int, float)) and row[i] > 0
        }
        category['items'].append({
            'name': name,
            'hold': int(hold),
            'needs': needs,
            'consumable': bool(CONSUMABLE.search(name)),
            'unit': unit_for(name),
            'note': ' '.join(str(row[14]).split()) if row[14] else '',
        })

    lines: list[str] = []
    out = lines.append
    out('/**')
    out(' * The SingleTrack warehouse catalogue.')
    out(' *')
    out(' * Generated from the consolidated inventory spreadsheet by')
    out(' * scripts/import-inventory.py — re-run that rather than editing this file, so')
    out(' * the warehouse list and the app cannot drift apart.')
    out(' *')
    out(' * `hold` is the largest quantity any single event needs: the minimum the')
    out(' * warehouse must carry to run that event without hiring in. It becomes the')
    out(' * item\'s low-stock level. Quantities on hand are deliberately absent — the')
    out(' * spreadsheet records what the packing lists say, not a physical count.')
    out(' */')
    out('')
    out('export interface CatalogueItem {')
    out('  name: string;')
    out('  sku: string;')
    out('  unit: string;')
    out('  /** Largest single-event requirement, used as the reorder threshold. */')
    out('  hold: number;')
    out('  consumable: boolean;')
    out('  note: string;')
    out('  /** Event code to the quantity that event packs, across all its sites. */')
    out('  needs: Record<string, number>;')
    out('}')
    out('')
    out('export interface CatalogueGroup {')
    out('  category: string;')
    out('  icon: string;')
    out('  items: CatalogueItem[];')
    out('}')
    out('')
    out('export const EVENT_LISTS: Array<{ code: string; name: string; year: number }> = [')
    for code, (name, year) in EVENTS.items():
        out(f'  {{ code: {ts(code)}, name: {ts(name)}, year: {year} }},')
    out('];')
    out('')
    out('export const CATALOGUE: CatalogueGroup[] = [')
    for index, group in enumerate(categories):
        prefix = PREFIXES[index] if index < len(PREFIXES) else 'MSC'
        icon = ICONS.get(group['name'], '📦')
        out(f'  {{')
        out(f'    category: {ts(group["name"])},')
        out(f'    icon: {ts(icon)},')
        out('    items: [')
        for number, item in enumerate(group['items'], start=1):
            sku = f'{prefix}-{number:02d}'
            needs = ', '.join(f'{code}: {qty}' for code, qty in item['needs'].items())
            out('      {')
            out(f'        name: {ts(item["name"])},')
            out(f'        sku: {ts(sku)},')
            out(f'        unit: {ts(item["unit"])},')
            out(f'        hold: {item["hold"]},')
            out(f'        consumable: {ts(item["consumable"])},')
            out(f'        note: {ts(item["note"])},')
            out(f'        needs: {{{needs}}},')
            out('      },')
        out('    ],')
        out('  },')
    out('];')
    out('')

    target = Path('src/db/catalogue.ts')
    target.write_text('\n'.join(lines))
    items = sum(len(group['items']) for group in categories)
    print(f'wrote {target}: {len(categories)} categories, {items} items, {len(EVENTS)} event lists')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
