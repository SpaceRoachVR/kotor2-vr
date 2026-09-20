import json
import tempfile
import unittest
from pathlib import Path

from evidence import load_evidence, validate_evidence, write_evidence


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

    def test_normalizes_sha256_to_the_contract_hash_field(self):
        evidence = validate_evidence(
            {
                "kind": "kotormcp",
                "resref": "a_template",
                "restype": "UTC",
                "sha256": "A" * 64,
                "authority": "parsed-retail",
                "path": "a_template.utc",
            },
            {},
        )
        self.assertEqual(evidence["hash"], "a" * 64)
        self.assertEqual(evidence["sha256"], "a" * 64)

    def test_dencs_requires_ncs_restype_even_when_another_retail_hash_matches(self):
        with self.assertRaisesRegex(ValueError, "NCS"):
            validate_evidence(
                {
                    "kind": "dencs",
                    "resref": "a_script",
                    "restype": "UTC",
                    "sha256": "1" * 64,
                    "authority": "hypothesis",
                    "path": "a_script.nss",
                },
                {"a_script:UTC": "1" * 64},
            )

    def test_sidecar_module_cannot_escape_the_ignored_output_directory(self):
        with self.assertRaisesRegex(ValueError, "module"):
            write_evidence("../escape", [], {})

    def test_load_evidence_requires_a_list_of_valid_records(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.json"
            path.write_text(json.dumps({"module": "101PER"}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "records"):
                load_evidence(path, {})


if __name__ == "__main__":
    unittest.main()
