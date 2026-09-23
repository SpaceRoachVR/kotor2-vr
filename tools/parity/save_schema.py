"""
Save-format parity: does our engine write GFF saves with retail's field types?

Walks every GFF inside a retail SAVEGAME.sav and inside one our engine wrote,
builds a schema of (file kind, struct path) -> {label: field type}, and reports:

  * type mismatches  - same label, different type (e.g. Volume BYTE vs FLOAT)
  * missing fields   - retail writes it, we never do
  * extra fields     - we write it, retail never does (usually harmless)

  <kotormcp venv>/python tools/parity/save_schema.py \
      --retail "<game>/saves/000002 - Game1" --engine "<game>/saves/000003 - Game2"

It uses its own minimal GFF reader rather than PyKotor's, on purpose: PyKotor
rejects any GFF with an out-of-range list offset, and older engine saves wrote
empty lists as 0xFFFFFFFF (fixed in GFFObject.ts). A check that cannot open the
file it is checking would report nothing.

Struct paths name lists, not indices: `GIT/SoundList[]/Sounds[]` covers every
sound entry in every sound object, so one save gives full coverage of each kind
of struct the save contains. A kind that appears in only one save is listed
separately — it is a coverage gap, not a format difference.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from collections import defaultdict
from pathlib import Path

TYPE_NAMES = {
    0: "BYTE", 1: "CHAR", 2: "WORD", 3: "SHORT", 4: "DWORD", 5: "INT", 6: "DWORD64",
    7: "INT64", 8: "FLOAT", 9: "DOUBLE", 10: "CEXOSTRING", 11: "RESREF",
    12: "CEXOLOCSTRING", 13: "VOID", 14: "STRUCT", 15: "LIST", 16: "ORIENTATION", 17: "VECTOR",
}
GFF_EXTENSIONS = {"ifo", "are", "git", "utc", "uti", "utp", "utd", "uts", "utt", "ute",
                  "utw", "utm", "dlg", "jrl", "fac", "res", "pth", "gui", "bic", "nfo"}
# ERF resource type ids -> extension, for the types a save actually holds.
RESTYPES = {2014: "ifo", 2012: "are", 2023: "git", 2027: "utc", 2025: "uti", 2044: "utp",
            2042: "utd", 2035: "uts", 2032: "utt", 2040: "ute", 2058: "utw", 2051: "utm",
            2029: "dlg", 2056: "jrl", 2038: "fac", 3000: "res", 2057: "sav", 3001: "pth",
            2047: "gui", 2015: "bic", 2016: "wok"}


def read_erf(data: bytes) -> list[tuple[str, str, bytes]]:
    (ftype, ver, _lang_count, _lang_size, entry_count, _lang_off, key_off, res_off) = struct.unpack_from("<4s4s6I", data, 0)
    out = []
    for i in range(entry_count):
        name, _res_id, rtype, _unused = struct.unpack_from("<16sIHH", data, key_off + i * 24)
        off, size = struct.unpack_from("<II", data, res_off + i * 8)
        ext = RESTYPES.get(rtype, str(rtype))
        out.append((name.rstrip(b"\0").decode("latin-1").lower(), ext, data[off:off + size]))
    return out


class Schema:
    def __init__(self):
        # path -> label -> set(types)
        self.fields: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
        self.errors: list[str] = []
        # (path, label, type) -> origin files, so a mixed result names its source
        self.origins: dict[tuple[str, str, str], set[str]] = defaultdict(set)

    def walk_gff(self, kind: str, data: bytes, origin: str):
        try:
            h = struct.unpack_from("<4s4s12I", data, 0)
        except struct.error:
            self.errors.append(f"{origin}: truncated header")
            return
        so, sc, fo, fc, lo, lc, fdo, fds, fio, fis, lio, lis = h[2:]

        def label(i):
            return data[lo + i * 16:lo + i * 16 + 16].rstrip(b"\0").decode("latin-1")

        def fields_of(si):
            _stype, idx, count = struct.unpack_from("<III", data, so + si * 12)
            if count == 0:
                return []
            if count == 1:
                return [idx]
            return list(struct.unpack_from(f"<{count}I", data, fio + idx))

        seen = set()

        def walk(si, path):
            key = (si, path)
            if key in seen or si >= sc:
                return
            seen.add(key)
            for fi in fields_of(si):
                if fi >= fc:
                    self.errors.append(f"{origin}: {path} field index {fi} out of range")
                    continue
                ftype, li, value = struct.unpack_from("<III", data, fo + fi * 12)
                name = label(li)
                tname = TYPE_NAMES.get(ftype, f"?{ftype}")
                self.fields[path][name].add(tname)
                self.origins[(path, name, tname)].add(origin)
                if ftype == 14:
                    walk(value, f"{path}/{name}")
                elif ftype == 15:
                    if value == 0xFFFFFFFF:
                        continue  # empty list, pre-fix engine encoding
                    if value + 4 > lis:
                        self.errors.append(f"{origin}: {path}/{name} list offset {value} out of range")
                        continue
                    (n,) = struct.unpack_from("<I", data, lio + value)
                    for child in struct.unpack_from(f"<{n}I", data, lio + value + 4):
                        walk(child, f"{path}/{name}[]")

        walk(0, kind.upper())

    def walk_erf(self, data: bytes, origin: str):
        for name, ext, blob in read_erf(data):
            if ext == "sav":
                self.walk_erf(blob, f"{origin}/{name}.sav")
            elif ext in GFF_EXTENSIONS:
                self.walk_gff(ext, blob, f"{origin}/{name}.{ext}")

    def walk_save_dir(self, folder: Path):
        for file in sorted(folder.iterdir()):
            ext = file.suffix.lower().lstrip(".")
            blob = file.read_bytes()
            if ext == "sav":
                self.walk_erf(blob, file.name)
            elif ext in GFF_EXTENSIONS or ext == "ifo":
                kind = blob[:4].decode("latin-1").strip().lower() or ext
                self.walk_gff(kind, blob, file.name)


def compare(retail: Schema, engine: Schema) -> dict:
    report = {"typeMismatches": [], "missingFields": [], "extraFields": [],
              "retailOnlyStructs": [], "engineOnlyStructs": []}
    for path in sorted(set(retail.fields) | set(engine.fields)):
        if path not in engine.fields:
            report["retailOnlyStructs"].append(path)
            continue
        if path not in retail.fields:
            report["engineOnlyStructs"].append(path)
            continue
        r, e = retail.fields[path], engine.fields[path]
        for name in sorted(set(r) | set(e)):
            if name not in e:
                report["missingFields"].append({"path": path, "label": name, "retail": sorted(r[name])})
            elif name not in r:
                report["extraFields"].append({"path": path, "label": name, "engine": sorted(e[name])})
            elif r[name] != e[name]:
                wrong = sorted(e[name] - r[name])
                report["typeMismatches"].append({
                    "path": path, "label": name, "retail": sorted(r[name]), "engine": sorted(e[name]),
                    # Which engine GFFs carry the non-retail type. A save folder can
                    # bundle module .sav files written by an older build.
                    "wrongTypeIn": {t: sorted(engine.origins[(path, name, t)])[:5] for t in wrong},
                })
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--retail", required=True, help="a save folder written by retail KOTOR II")
    ap.add_argument("--engine", required=True, help="a save folder written by our engine")
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "save-schema.json"))
    args = ap.parse_args()

    retail, engine = Schema(), Schema()
    retail.walk_save_dir(Path(args.retail))
    engine.walk_save_dir(Path(args.engine))
    report = compare(retail, engine)
    report["retailErrors"] = retail.errors[:50]
    report["engineErrors"] = engine.errors[:50]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"type mismatches: {len(report['typeMismatches'])}")
    for m in report["typeMismatches"]:
        where = "; ".join(f"{t} in {', '.join(o)}" for t, o in m["wrongTypeIn"].items())
        print(f"  {m['path']} {m['label']}: retail {'/'.join(m['retail'])}, engine {'/'.join(m['engine'])}"
              + (f"  [{where}]" if where else ""))
    print(f"missing fields (retail writes, engine never does): {len(report['missingFields'])}")
    for m in report["missingFields"][:40]:
        print(f"  {m['path']} {m['label']} ({'/'.join(m['retail'])})")
    print(f"extra fields: {len(report['extraFields'])}; "
          f"struct kinds only in retail save: {len(report['retailOnlyStructs'])}; only in engine save: {len(report['engineOnlyStructs'])}")
    print(f"reader errors: retail {len(retail.errors)}, engine {len(engine.errors)}")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
