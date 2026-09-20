"""
Retail oracle for the parity check: what the shipped KOTOR II data says.

Reads the retail install through PyKotor (the library kotormcp wraps) and writes
a JSON snapshot that `compare.js` diffs against what our engine loaded.

  <kotormcp venv>/python tools/parity/retail_snapshot.py --module 101PER
  ... --textures tools/parity/out/101per.engine.json   # also resolve every
                                                       # texture the engine asked for

Two rules:

  * Creatures come from the module's own GIT, not from the engine. The engine
    snapshot cannot report a creature it failed to spawn; the GIT can.
  * Textures are resolved by name, one location at a time, in retail's lookup
    order. We report every location that holds the name, not just the winner,
    so a mismatch shows which layer the engine picked instead.

Values are template values. Anything the game changes at spawn (autobalance,
OnSpawn scripts, equipped-item bonuses) legitimately differs at runtime, and
compare.js labels those fields rather than calling them defects.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import logging
import os
import sys
from pathlib import Path

logging.disable(logging.CRITICAL)  # PyKotor logs every BIF it opens at DEBUG

from pykotor.common.module import Module  # noqa: E402
from pykotor.extract.installation import Installation, SearchLocation  # noqa: E402
from pykotor.resource.generics.utc import read_utc  # noqa: E402
from pykotor.resource.generics.uti import read_uti  # noqa: E402
from pykotor.resource.generics.uts import read_uts  # noqa: E402
from pykotor.resource.generics.utp import read_utp  # noqa: E402
from pykotor.resource.formats.gff import read_gff  # noqa: E402
from pykotor.resource.formats.tpc import read_tpc  # noqa: E402
from pykotor.resource.formats.twoda import read_2da  # noqa: E402
from pykotor.resource.type import ResourceType  # noqa: E402

DEFAULT_GAME = r"D:\SteamLibrary\steamapps\common\Knights of the Old Republic II"

# Engine TalentSkill ids are the skills.2da row order, which is also UTC SkillList order.
SKILLS = ["computer_use", "demolitions", "stealth", "awareness",
          "persuade", "repair", "security", "treat_injury"]

# Retail lookup order for textures. The Steam build defaults to the high-quality
# pack (TPA); GUI textures live in their own ERF.
TEXTURE_ORDER = [
    ("override", SearchLocation.OVERRIDE),
    ("module", SearchLocation.CUSTOM_MODULES),  # this module's capsules only
    ("texture-pack", SearchLocation.TEXTURES_TPA),
    ("gui-pack", SearchLocation.TEXTURES_GUI),
    ("key-bif", SearchLocation.CHITIN),
]


def require_module_scoped_capsules(capsules):
    """Return the active module capsules or reject an unsafe module lookup."""
    if capsules is None or isinstance(capsules, (str, bytes)):
        raise ValueError("Module-scoped lookup requires non-empty capsules")
    try:
        validated = tuple(capsules)
    except TypeError as error:
        raise ValueError("Module-scoped lookup requires non-empty capsules") from error
    if not validated or any(capsule is None for capsule in validated):
        raise ValueError("Module-scoped lookup requires non-empty capsules")
    return validated


def normalize_retail_input(resref_value, restype, source, data: bytes) -> dict:
    """Create a stable source record from the exact bytes used for comparison."""
    if not isinstance(data, bytes) or not data:
        raise ValueError("Retail input requires non-empty bytes for sha256")
    normalized_resref = resref(resref_value)
    normalized_restype = str(getattr(restype, "name", restype) or "").strip().upper()
    normalized_source = str(source or "").strip()
    if not normalized_resref:
        raise ValueError("Retail input requires a non-empty resref")
    if not normalized_restype:
        raise ValueError("Retail input requires a non-empty restype")
    if not normalized_source:
        raise ValueError("Retail input requires a non-empty source")
    return {
        "resref": normalized_resref,
        "restype": normalized_restype,
        "source": normalized_source,
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def record_retail_input(retail_inputs: list[dict], resref_value, restype, source, data: bytes) -> dict:
    """Append a unique normalized retail source record and return it."""
    record = normalize_retail_input(resref_value, restype, source, data)
    if record not in retail_inputs:
        retail_inputs.append(record)
    return record


def record_resource_input(retail_inputs: list[dict], result) -> dict:
    """Record a PyKotor resource result without retaining its retail bytes."""
    return record_retail_input(retail_inputs, result.resname, result.restype, result.filepath, result.data)


def record_module_capsule_inputs(retail_inputs: list[dict], capsules) -> None:
    """Record each active module capsule as an immutable input to this capture."""
    for capsule in require_module_scoped_capsules(capsules):
        capsule_path = Path(capsule.filepath())
        record_retail_input(
            retail_inputs,
            capsule_path.stem,
            capsule_path.suffix.lstrip("."),
            capsule_path,
            capsule_path.read_bytes(),
        )


def resref(value) -> str:
    return str(value or "").strip().lower()


def item_tag(inst: Installation, item_resref, capsules, retail_inputs: list[dict]) -> str | None:
    capsules = require_module_scoped_capsules(capsules)
    result = inst.resource(resref(item_resref), ResourceType.UTI,
                           [SearchLocation.OVERRIDE, SearchLocation.CUSTOM_MODULES, SearchLocation.CHITIN],
                           capsules=capsules)
    if result is None:
        return None
    record_resource_input(retail_inputs, result)
    return resref(read_uti(result.data).tag)


def creature_record(inst: Installation, git_index: int, template: str, capsules, retail_inputs: list[dict]) -> dict:
    capsules = require_module_scoped_capsules(capsules)
    rec: dict = {"gitIndex": git_index, "template": template}
    # CUSTOM_MODULES searches only the capsules passed in. SearchLocation.MODULES
    # searches every module on disk and returns the first hit, which resolved
    # 102PER's droids from 101PER_s.rim (different stats) on the first run.
    result = inst.resource(template, ResourceType.UTC,
                           [SearchLocation.OVERRIDE, SearchLocation.CUSTOM_MODULES, SearchLocation.CHITIN],
                           capsules=capsules)
    if result is None:
        rec["status"] = "template-missing"
        return rec
    rec["status"] = "ok"
    rec["source"] = str(result.filepath)
    record_resource_input(retail_inputs, result)
    utc = read_utc(result.data)
    rec.update({
        "tag": utc.tag,
        "appearance": utc.appearance_id,
        "race": utc.race_id,
        "subrace": utc.subrace_id,
        "gender": utc.gender_id,
        "portraitId": utc.portrait_id,
        "soundSetFile": utc.soundset_id,
        "factionId": utc.faction_id,
        "bodyVariation": utc.body_variation,
        "textureVar": utc.texture_variation,
        "goodEvil": utc.alignment,
        "challengeRating": utc.challenge_rating,
        "naturalAC": utc.natural_ac,
        "str": utc.strength, "dex": utc.dexterity, "con": utc.constitution,
        "int": utc.intelligence, "wis": utc.wisdom, "cha": utc.charisma,
        "hitPoints": utc.hp, "currentHitPoints": utc.current_hp, "maxHitPoints": utc.max_hp,
        "forcePoints": utc.fp, "maxForcePoints": utc.max_fp,
        "fortbonus": utc.fortitude_bonus, "refbonus": utc.reflex_bonus,
        "willbonus": utc.willpower_bonus,
        "isHologram": bool(utc.hologram), "plot": bool(utc.plot), "min1HP": bool(utc.min1_hp),
        "classes": [{"id": c.class_id, "level": c.class_level,
                     "powers": sorted(int(p) for p in c.powers)} for c in utc.classes],
        "feats": sorted(int(f) for f in utc.feats),
        "skills": [getattr(utc, s) for s in SKILLS],
        "equipment": {slot.name: resref(item.resref) for slot, item in utc.equipment.items()},
        "equipmentTags": {
            slot.name: item_tag(inst, item.resref, capsules, retail_inputs)
            for slot, item in utc.equipment.items()
        },
    })
    return rec


def texture_record(inst: Installation, name: str, capsules, retail_inputs: list[dict]) -> dict:
    capsules = require_module_scoped_capsules(capsules)
    found = []
    winner = None
    for label, loc in TEXTURE_ORDER:
        try:
            result, _txi_text = inst.texture_resource_result(
                name,
                [loc],
                capsules=capsules if loc is SearchLocation.CUSTOM_MODULES else None,
            )
        except Exception as error:  # a corrupt entry is itself a finding
            found.append({"source": label, "error": str(error)[:200]})
            continue
        if result is None:
            continue
        record_resource_input(retail_inputs, result)
        tpc = read_tpc(result.data)
        width, height = tpc.dimensions()
        entry = {
            "source": label,
            "sourcePath": str(result.filepath),
            "width": width,
            "height": height,
        }
        try:
            mip = tpc.get(0, 0)
            entry["format"] = str(mip.tpc_format.name)
            entry["sha256"] = hashlib.sha256(bytes(mip.data)).hexdigest()
        except Exception:
            pass
        found.append(entry)
        if winner is None:
            winner = entry
    return {"resref": name, "retailSource": winner["source"] if winner else "none",
            "retail": winner, "locations": found}


def sound_location(inst: Installation, name: str) -> str:
    """Which retail folder a sound file resolves from, or 'none'."""
    for label, loc in (("override", SearchLocation.OVERRIDE), ("streamsounds", SearchLocation.SOUND),
                       ("streammusic", SearchLocation.MUSIC), ("streamvoice", SearchLocation.VOICE),
                       ("key-bif", SearchLocation.CHITIN)):
        try:
            if inst.sound(name, [loc]):
                return label
        except Exception:
            continue
    return "none"


def twoda_resource(inst: Installation, table: str, row: int, retail_inputs: list[dict]) -> str | None:
    result = inst.resource(table, ResourceType.TwoDA, [SearchLocation.OVERRIDE, SearchLocation.CHITIN])
    if result is None or row is None or row < 0:
        return None
    record_resource_input(retail_inputs, result)
    t = read_2da(result.data)
    if row >= t.get_height():
        return None
    value = t.get_row(row).get_string("resource")
    return None if value in ("", "****") else value.lower()


def twoda_cell(inst: Installation, table: str, row: int, column: str, retail_inputs: list[dict]) -> str | None:
    """Read one authored 2DA cell while retaining the exact table input."""
    result = inst.resource(table, ResourceType.TwoDA, [SearchLocation.OVERRIDE, SearchLocation.CHITIN])
    if result is None or row is None or row < 0:
        return None
    record_resource_input(retail_inputs, result)
    table_data = read_2da(result.data)
    if row >= table_data.get_height():
        return None
    try:
        value = table_data.get_row(row).get_string(column)
    except (KeyError, ValueError):
        return None
    normalized = str(value or "").strip().lower()
    return None if normalized in ("", "****") else normalized


def creature_model_names(inst: Installation, retail_inputs: list[dict]) -> set[str]:
    """Return authored creature-model references from appearance.2da."""
    result = inst.resource("appearance", ResourceType.TwoDA, [SearchLocation.OVERRIDE, SearchLocation.CHITIN])
    if result is None:
        return set()
    record_resource_input(retail_inputs, result)
    table_data = read_2da(result.data)
    names: set[str] = set()
    for index in range(table_data.get_height()):
        row = table_data.get_row(index)
        for column in ("modela", "modelb", "modelc", "modeld", "modele", "modelf"):
            try:
                value = str(row.get_string(column) or "").strip().lower()
            except (KeyError, ValueError):
                continue
            if value and value != "****":
                names.add(value)
    return names


def model_presentation_snapshot(inst: Installation, git, capsules, retail_inputs: list[dict]) -> list[dict]:
    """Capture placeable template/model provenance without inferring animation intent."""
    capsules = require_module_scoped_capsules(capsules)
    creature_models = creature_model_names(inst, retail_inputs)
    presentations: list[dict] = []
    for index, entry in enumerate(git.placeables if git is not None else []):
        template = resref(entry.resref)
        record = {"gitIndex": index, "template": template, "objectType": "placeable"}
        result = inst.resource(template, ResourceType.UTP,
                               [SearchLocation.OVERRIDE, SearchLocation.CUSTOM_MODULES, SearchLocation.CHITIN],
                               capsules=capsules)
        if result is None:
            record["status"] = "template-missing"
            presentations.append(record)
            continue
        record_resource_input(retail_inputs, result)
        utp = read_utp(result.data)
        appearance_id = utp.appearance_id
        model_name = twoda_cell(inst, "placeables", appearance_id, "modelname", retail_inputs)
        record.update({
            "status": "ok",
            "source": str(result.filepath),
            "appearance": appearance_id,
            "modelName": model_name,
            "modelKind": "creature" if model_name in creature_models else "placeable",
            "requestedAnimation": None,
        })
        presentations.append(record)
    return presentations


def audio_snapshot(inst: Installation, module, git, capsules, retail_inputs: list[dict]) -> dict:
    """Area music/ambience from the GIT's AreaProperties, and every placed sound."""
    capsules = require_module_scoped_capsules(capsules)
    root = read_gff(module.git().data()).root
    props = root.get_struct("AreaProperties") if root.exists("AreaProperties") else None
    area = {}
    if props is not None:
        for label in ("MusicDay", "MusicNight", "MusicBattle", "MusicDelay", "AmbientSndDay",
                      "AmbientSndNight", "AmbientSndDayVol", "AmbientSndNitVol", "EnvAudio"):
            if props.exists(label):
                area[label] = props.acquire(label, 0)
    tracks = {}
    for label in ("MusicDay", "MusicNight", "MusicBattle"):
        res = twoda_resource(inst, "ambientmusic", area.get(label, -1), retail_inputs)
        tracks[label] = {"resource": res, "retailSource": sound_location(inst, res) if res else None}
    for label in ("AmbientSndDay", "AmbientSndNight"):
        res = twoda_resource(inst, "ambientsound", area.get(label, -1), retail_inputs)
        tracks[label] = {"resource": res, "retailSource": sound_location(inst, res) if res else None}

    sounds = []
    for i, entry in enumerate(git.sounds if git is not None else []):
        template = resref(entry.resref)
        rec = {"gitIndex": i, "template": template}
        result = inst.resource(template, ResourceType.UTS,
                               [SearchLocation.OVERRIDE, SearchLocation.CUSTOM_MODULES, SearchLocation.CHITIN],
                               capsules=capsules)
        if result is None:
            rec["status"] = "template-missing"
            sounds.append(rec)
            continue
        rec["source"] = str(result.filepath)
        record_resource_input(retail_inputs, result)
        uts = read_uts(result.data)
        names = [resref(n) for n in uts.sounds]
        rec.update({
            "status": "ok", "tag": uts.tag, "active": bool(uts.active), "continuous": bool(uts.continuous),
            "looping": bool(uts.looping), "positional": bool(uts.positional), "random": bool(uts.random_pick),
            "randomPosition": bool(uts.random_position), "interval": uts.interval,
            "intervalVariation": uts.interval_variation, "volume": uts.volume,
            "volumeVariation": uts.volume_variation, "maxDistance": uts.max_distance,
            "minDistance": uts.min_distance, "priority": uts.priority, "times": uts.times,
            "sounds": names,
            "soundSources": {n: sound_location(inst, n) for n in names},
        })
        sounds.append(rec)
    return {"area": area, "tracks": tracks, "sounds": sounds}


def behavior_chain_snapshot() -> dict:
    """State the bounded behavior-chain coverage honestly until an interaction is selected.

    A passive module read cannot prove an authored DLG/GFF/NCS interaction.  The
    explicit record prevents downstream comparison from fabricating an action
    queue or global result when no safe, user-driven interaction trace exists.
    """
    return {
        "coverage": "missing-evidence",
        "interactionId": None,
        "gffDlgLocated": False,
        "ncsLocated": False,
        "ncsIdentity": None,
        "resultState": None,
        "reason": "No bounded GFF/DLG/NCS interaction was selected for this retail snapshot",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--module", required=True, help="module resref, e.g. 101PER")
    ap.add_argument("--game", default=os.environ.get("K2_PATH", DEFAULT_GAME))
    ap.add_argument("--textures", help="engine snapshot JSON whose texture requests to resolve")
    ap.add_argument("--out", help="output path (default tools/parity/out/<module>.retail.json)")
    args = ap.parse_args()

    module_name = args.module.lower()
    inst = Installation(args.game)
    # Module() prints every model's texture list to stdout; keep our output readable.
    with contextlib.redirect_stdout(io.StringIO()):
        module = Module(module_name, inst)
    capsules = require_module_scoped_capsules(module.capsules())
    retail_inputs: list[dict] = []
    record_module_capsule_inputs(retail_inputs, capsules)

    git_res = module.git()
    if git_res is not None:
        git_data = git_res.data()
        git_source = git_res.active()
        if git_data is None or git_source is None:
            raise ValueError(f"Module {module_name} GIT lacks readable source bytes")
        record_retail_input(retail_inputs, git_res.resname(), git_res.restype(), git_source, git_data)
    git = git_res.resource() if git_res else None
    creatures = []
    if git is not None:
        for i, c in enumerate(git.creatures):
            creatures.append(creature_record(inst, i, resref(c.resref), capsules, retail_inputs))

    snapshot = {
        "schema": "kotor2-vr/parity-retail@1",
        "module": module_name,
        "game": args.game,
        "gitFound": git is not None,
        "retailInputs": retail_inputs,
        "creatures": creatures,
        "textures": [],
        "audio": audio_snapshot(inst, module, git, capsules, retail_inputs),
        "behaviorChain": behavior_chain_snapshot(),
        "modelPresentation": model_presentation_snapshot(inst, git, capsules, retail_inputs),
    }

    # Textures retail's own models reference, plus anything the engine asked for.
    # The union catches both directions: a texture we never requested, and one we
    # requested that retail's models never name (a wrong resref on our side).
    module_textures = {resref(t.resname()) for t in module.textures()}
    engine_textures: set[str] = set()
    if args.textures:
        engine = json.loads(Path(args.textures).read_text(encoding="utf-8"))
        engine_textures = {resref(t.get("requestedResref")) for t in engine.get("textures", [])}
    names = sorted((module_textures | engine_textures) - {"", "****", "null"})
    for name in names:
        rec = texture_record(inst, name, capsules, retail_inputs)
        rec["namedByRetailModels"] = name in module_textures
        snapshot["textures"].append(rec)

    out = Path(args.out) if args.out else Path(__file__).parent / "out" / f"{module_name}.retail.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print(f"{module_name}: {len(creatures)} GIT creatures, {len(snapshot['textures'])} textures -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
