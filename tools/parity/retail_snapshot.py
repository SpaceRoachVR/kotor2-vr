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
from pykotor.resource.generics.dlg import read_dlg  # noqa: E402
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
        resource_identity = record_resource_input(retail_inputs, result)
        tpc = read_tpc(result.data)
        width, height = tpc.dimensions()
        entry = {
            "source": label,
            "sourcePath": str(result.filepath),
            "resourceIdentity": resource_identity,
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


def audio_track_record(inst: Installation, table: str, row: int, retail_inputs: list[dict]) -> dict:
    """Keep the authored table identity even when its named audio file is absent."""
    resource = twoda_resource(inst, table, row, retail_inputs)
    table_inputs = [record for record in retail_inputs
                    if record["resref"] == table and record["restype"] == ResourceType.TwoDA.name.upper()]
    return {
        "resource": resource,
        "retailSource": sound_location(inst, resource) if resource else None,
        "resourceIdentity": table_inputs[0] if len(table_inputs) == 1 else None,
    }


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
        model_identity = None
        if model_name:
            model_result = inst.resource(model_name, ResourceType.MDL,
                                         [SearchLocation.OVERRIDE, SearchLocation.CUSTOM_MODULES, SearchLocation.CHITIN],
                                         capsules=capsules)
            if model_result is not None:
                model_identity = record_resource_input(retail_inputs, model_result)
        record.update({
            "status": "ok",
            "source": str(result.filepath),
            "appearance": appearance_id,
            "modelName": model_name,
            "modelResourceIdentity": model_identity,
            "modelKind": "creature" if model_name in creature_models else "placeable",
            "requestedAnimation": None,
        })
        presentations.append(record)
    return presentations


def audio_snapshot(inst: Installation, module, git, capsules, retail_inputs: list[dict]) -> dict:
    """Area music/ambience from the GIT's AreaProperties, and every placed sound."""
    capsules = require_module_scoped_capsules(capsules)
    git_resource = module.git()
    git_data = git_resource.data()
    git_identity = record_retail_input(retail_inputs, git_resource.resname(), git_resource.restype(),
                                       git_resource.active(), git_data)
    root = read_gff(git_data).root
    props = root.get_struct("AreaProperties") if root.exists("AreaProperties") else None
    area = {}
    if props is not None:
        for label in ("MusicDay", "MusicNight", "MusicBattle", "MusicDelay", "AmbientSndDay",
                      "AmbientSndNight", "AmbientSndDayVol", "AmbientSndNitVol", "EnvAudio"):
            if props.exists(label):
                area[label] = props.acquire(label, 0)
    tracks = {}
    for label in ("MusicDay", "MusicNight", "MusicBattle"):
        tracks[label] = audio_track_record(inst, "ambientmusic", area.get(label, -1), retail_inputs)
    for label in ("AmbientSndDay", "AmbientSndNight"):
        tracks[label] = audio_track_record(inst, "ambientsound", area.get(label, -1), retail_inputs)

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
    return {"resourceIdentity": git_identity, "area": area, "tracks": tracks, "sounds": sounds}


MEDLOG_1_NCS_SHA256 = "88b9169467f3fdfc6ae793ecc7d55cbf92bb0b161e39aa65c952e423295f428f"
COMP_DLG_NCS_SHA256 = "7c6c4ea4a28acbe2e0eb393b5e11e6638a695bee168f2f08dd8c35108c1ab5e3"
MEDLOG_ENTRY_NCS_SHA256 = "c86a03c440745350e2f9da1d24019a935c1fa84ebc805e75f3049a9aaf4dc944"
FADE_OUT_IN_NCS_SHA256 = "e3054cc48f315bee997499583cffd0ae839286af983b0829c893057c4b6ad2b4"
MEDLOG_CONDITION_NCS_SHA256 = "ce02b5ce42fbc47ecbfdd7df5866523b396cfaad2fce44603b76c26d78c14825"


def missing_behavior_chain(reason: str) -> dict:
    return {
        "coverage": "missing-evidence",
        "interactionId": None,
        "gffDlgLocated": False,
        "ncsLocated": False,
        "ncsIdentity": None,
        "resultState": None,
        "reason": reason,
    }


def behavior_chain_snapshot(inst: Installation, module, git, capsules, retail_inputs: list[dict]) -> dict:
    """Verify the MedCom log-one branch against the active module's retail bytes.

    The expected global write is tied to the exact independently inspected
    52-byte a_setmedlog1 NCS, which pushes 1 and 101PER_Med_Log before K2
    opcode 581 (SetGlobalNumber). A changed script cannot inherit that claim.
    """
    if git is None:
        return missing_behavior_chain("101PER GIT is absent")
    capsules = require_module_scoped_capsules(capsules)
    staged_inputs: list[dict] = []
    try:
        git_resource = module.git()
        git_identity = record_retail_input(staged_inputs, git_resource.resname(), git_resource.restype(),
                                           git_resource.active(), git_resource.data())
        medcom_instances = [(index, entry) for index, entry in enumerate(git.placeables)
                            if resref(entry.resref) == "comppnl001"]
        if len(medcom_instances) != 1:
            raise ValueError(f"Expected one MedCom GIT instance, found {len(medcom_instances)}")
        git_index, _ = medcom_instances[0]
        if git_index != 20:
            raise ValueError(f"MedCom GIT index changed from the inspected branch: {git_index}")

        def resource(name: str, kind: ResourceType):
            result = inst.resource(name, kind,
                                   [SearchLocation.OVERRIDE, SearchLocation.CUSTOM_MODULES, SearchLocation.CHITIN],
                                   capsules=capsules)
            if result is None or resref(result.resname) != name or result.restype != kind:
                raise ValueError(f"Missing or misidentified {name}.{kind.name} in active module scope")
            return result

        utp_result = resource("comppnl001", ResourceType.UTP)
        utp = read_utp(utp_result.data)
        if resref(utp.tag) != "medcom" or resref(utp.conversation) != "medlog" or resref(utp.on_used) != "a_compdlg":
            raise ValueError("MedCom UTP tag, conversation, or OnUsed script differs")
        utp_identity = record_resource_input(staged_inputs, utp_result)

        dlg_result = resource("medlog", ResourceType.DLG)
        dialogue = read_dlg(dlg_result.data)
        if (len(dialogue.starters) != 2 or resref(dialogue.starters[0].active1) != "c_medloggt0"
                or dialogue.starters[0].node.list_index != 16):
            raise ValueError("MedCom conditioned dialogue entry differs from the inspected branch")
        fresh_starters = [link for link in dialogue.starters if not resref(link.active1)]
        if len(fresh_starters) != 1 or fresh_starters[0].node.list_index != 0:
            raise ValueError("MedCom fresh-state dialogue entry is not unique")
        entry = fresh_starters[0].node
        if resref(entry.script1) != "a_medlogjmp":
            raise ValueError("MedCom fresh-state entry script differs")
        reply = entry.links[0].node
        next_entry = reply.links[0].node
        log_reply = next_entry.links[0].node
        if (reply.list_index, next_entry.list_index, log_reply.list_index) != (16, 14, 19) \
                or resref(log_reply.script1) != "a_setmedlog1" or resref(log_reply.script2) != "a_fadeoutin":
            raise ValueError("MedCom log-one reply is not on the verified dialogue path")
        dlg_identity = record_resource_input(staged_inputs, dlg_result)

        on_used_result = resource("a_compdlg", ResourceType.NCS)
        on_used_identity = record_resource_input(staged_inputs, on_used_result)
        if on_used_identity["sha256"] != COMP_DLG_NCS_SHA256:
            raise ValueError("a_compdlg NCS differs from the inspected conversation dispatch bytecode")
        condition_result = resource("c_medloggt0", ResourceType.NCS)
        condition_identity = record_resource_input(staged_inputs, condition_result)
        if condition_identity["sha256"] != MEDLOG_CONDITION_NCS_SHA256:
            raise ValueError("c_medloggt0 NCS differs from the inspected dialogue branch condition bytecode")
        entry_result = resource("a_medlogjmp", ResourceType.NCS)
        entry_identity = record_resource_input(staged_inputs, entry_result)
        if entry_identity["sha256"] != MEDLOG_ENTRY_NCS_SHA256:
            raise ValueError("a_medlogjmp NCS differs from the inspected dialogue entry bytecode")
        log_result = resource("a_setmedlog1", ResourceType.NCS)
        ncs_identity = record_resource_input(staged_inputs, log_result)
        if ncs_identity["sha256"] != MEDLOG_1_NCS_SHA256:
            raise ValueError("a_setmedlog1 NCS differs from the inspected SetGlobalNumber bytecode")
        fade_result = resource("a_fadeoutin", ResourceType.NCS)
        fade_identity = record_resource_input(staged_inputs, fade_result)
        if fade_identity["sha256"] != FADE_OUT_IN_NCS_SHA256:
            raise ValueError("a_fadeoutin NCS differs from the inspected dialogue reply bytecode")
    except (AttributeError, IndexError, KeyError, OSError, TypeError, ValueError) as error:
        return missing_behavior_chain(str(error))

    for record in staged_inputs:
        if record not in retail_inputs:
            retail_inputs.append(record)
    return {
        "coverage": "complete",
        "interactionId": "101per:medcom:medical-log-1",
        "gffDlgLocated": True,
        "ncsLocated": True,
        "ncsIdentity": ncs_identity,
        "sourceIdentities": {
            "git": git_identity, "utp": utp_identity, "dlg": dlg_identity, "onUsedNcs": on_used_identity,
            "conditionNcs": condition_identity, "entryNcs": entry_identity,
            "replyNcs": ncs_identity, "replySecondaryNcs": fade_identity,
        },
        "gitIndex": git_index,
        "dialoguePath": [0, 16, 14, 19],
        "replyScript": {"resref": "a_setmedlog1", "restype": "NCS"},
        "resultState": {"globalNumber": {"101PER_Med_Log": 1}},
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
        "behaviorChain": behavior_chain_snapshot(inst, module, git, capsules, retail_inputs),
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
