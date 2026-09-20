import json
import tempfile
import unittest
from pathlib import Path

from evidence import load_evidence, validate_evidence


class EvidenceTests(unittest.TestCase):
    def test_dencs_hash_must_match_retail_ncs(self):
        with self.assertRaisesRegex(ValueError, "hash"):
            validate_evidence(
                {
                    "kind": "dencs",
                    "resref": "a_script",
                    "restype": "NCS",
                    "sha256": "0" * 64,
                    "authority": "hypothesis",
                    "path": "a_script.nss",
                },
                {"a_script:NCS": "1" * 64},
            )

    def test_evidence_requires_complete_identity_and_known_authority(self):
        with self.assertRaisesRegex(ValueError, "authority"):
            validate_evidence(
                {
                    "kind": "holocron",
                    "resref": "a_dialog",
                    "restype": "DLG",
                    "sha256": "1" * 64,
                    "authority": "retail",
                    "path": "a_dialog.dlg",
                },
                {},
            )

    def test_tool_kind_cannot_claim_another_tools_authority(self):
        with self.assertRaisesRegex(ValueError, "authority"):
            validate_evidence(
                {
                    "kind": "dencs",
                    "resref": "a_script",
                    "restype": "NCS",
                    "sha256": "1" * 64,
                    "authority": "parsed-retail",
                    "path": "a_script.nss",
                },
                {"a_script:NCS": "1" * 64},
            )

    def test_load_evidence_requires_a_list_of_valid_records(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.json"
            path.write_text(json.dumps({"module": "101PER"}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "records"):
                load_evidence(path, {})


if __name__ == "__main__":
    unittest.main()
