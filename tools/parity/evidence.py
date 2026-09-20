"""Validate and retain bounded parity-tool evidence sidecars.

Sidecars contain identities and hashes only.  They deliberately never embed
retail NCS/NSS bytes or GUI-exported assets.
"""

import argparse
import json
import re
from pathlib import Path
from typing import Any, Mapping, Sequence


ALLOWED_KINDS = frozenset({"kotormcp", "holocron", "dencs"})
ALLOWED_AUTHORITIES = frozenset({"parsed-retail", "human-review", "hypothesis"})
AUTHORITY_BY_KIND = {
    "kotormcp": "parsed-retail",
    "holocron": "human-review",
    "dencs": "hypothesis",
}
SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
OUT_DIR = Path(__file__).resolve().parent / "out"


def _required_string(record: Mapping[str, Any], field: str) -> str:
    value = record.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Evidence record requires {field}")
    return value.strip()


def validate_evidence(record: Mapping[str, Any], retail_hashes: Mapping[str, str]) -> dict[str, Any]:
    """Validate one evidence identity without granting it defect authority."""
    if not isinstance(record, Mapping):
        raise ValueError("Evidence record must be an object")

    kind = _required_string(record, "kind").lower()
    authority = _required_string(record, "authority").lower()
    if kind not in ALLOWED_KINDS:
        raise ValueError("Unsupported evidence kind")
    if authority not in ALLOWED_AUTHORITIES:
        raise ValueError("Unsupported evidence authority")
    if authority != AUTHORITY_BY_KIND[kind]:
        raise ValueError(f"Evidence authority {authority} is not permitted for {kind}")

    resref = _required_string(record, "resref").lower()
    restype = _required_string(record, "restype").upper()
    sha256 = _required_string(record, "sha256").lower()
    source_path = _required_string(record, "path")
    if not SHA256_PATTERN.fullmatch(sha256):
        raise ValueError("Evidence record requires a 64-character sha256 hash")

    key = f"{resref}:{restype}"
    if kind == "dencs" and retail_hashes.get(key, "").lower() != sha256:
        raise ValueError("DeNCS evidence hash does not match retail NCS")

    normalized = dict(record)
    normalized.update({
        "kind": kind,
        "resref": resref,
        "restype": restype,
        "sha256": sha256,
        "authority": authority,
        "path": source_path,
    })
    return normalized


def _retail_hashes(snapshot: Mapping[str, Any]) -> dict[str, str]:
    inputs = snapshot.get("retailInputs")
    if not isinstance(inputs, list):
        raise ValueError("Retail snapshot requires retailInputs")
    hashes: dict[str, str] = {}
    for item in inputs:
        if not isinstance(item, Mapping):
            raise ValueError("Retail input must be an object")
        resref = _required_string(item, "resref").lower()
        restype = _required_string(item, "restype").upper()
        sha256 = _required_string(item, "sha256").lower()
        if not SHA256_PATTERN.fullmatch(sha256):
            raise ValueError("Retail input requires a 64-character sha256 hash")
        hashes[f"{resref}:{restype}"] = sha256
    return hashes


def load_evidence(path: str | Path, retail_hashes: Mapping[str, str]) -> list[dict[str, Any]]:
    """Load a sidecar document and validate its records against retail hashes."""
    source = Path(path)
    try:
        document = json.loads(source.read_text(encoding="utf-8"))
    except OSError as error:
        raise ValueError(f"Unable to read evidence sidecar: {source}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Evidence sidecar is not valid JSON: {source}") from error

    if not isinstance(document, Mapping) or not isinstance(document.get("records"), list):
        raise ValueError("Evidence sidecar requires a records list")
    return [validate_evidence(record, retail_hashes) for record in document["records"]]


def write_evidence(module: str, records: Sequence[Mapping[str, Any]], retail_hashes: Mapping[str, str]) -> Path:
    """Write a validated identity-only sidecar beneath the ignored output directory."""
    if not isinstance(module, str) or not module.strip():
        raise ValueError("Evidence sidecar requires module")
    if not isinstance(records, Sequence) or isinstance(records, (str, bytes)):
        raise ValueError("Evidence sidecar records must be a list")

    normalized = [validate_evidence(record, retail_hashes) for record in records]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUT_DIR / f"{module.strip().lower()}.evidence.json"
    output.write_text(json.dumps({"schema": "kotor2-vr/parity-evidence@1", "module": module.strip().upper(), "records": normalized}, indent=2) + "\n", encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and write bounded parity evidence sidecars.")
    parser.add_argument("--module", required=True, help="Module identifier, for example 101PER")
    parser.add_argument("--records", required=True, type=Path, help="JSON file containing an evidence records list")
    parser.add_argument("--retail", type=Path, help="Retail snapshot JSON; defaults to tools/parity/out/<module>.retail.json")
    args = parser.parse_args()

    retail_path = args.retail or OUT_DIR / f"{args.module.lower()}.retail.json"
    try:
        retail_snapshot = json.loads(retail_path.read_text(encoding="utf-8"))
        records = json.loads(args.records.read_text(encoding="utf-8"))
    except OSError as error:
        parser.error(str(error))
    except json.JSONDecodeError as error:
        parser.error(f"invalid JSON: {error}")
    if not isinstance(records, list):
        parser.error("--records JSON must be a list")

    output = write_evidence(args.module, records, _retail_hashes(retail_snapshot))
    print(output.relative_to(Path.cwd()) if output.is_relative_to(Path.cwd()) else output)


if __name__ == "__main__":
    main()
