"""Unit tests for retail snapshot provenance helpers.

These tests intentionally do not access a retail installation.  They lock the
normalization and module-capsule boundary that real snapshot captures rely on.
"""

import hashlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from retail_snapshot import normalize_retail_input, require_module_scoped_capsules, texture_record


class RetailSnapshotTests(unittest.TestCase):
    def test_normalize_retail_input_requires_hashable_bytes(self):
        with self.assertRaisesRegex(ValueError, "sha256"):
            normalize_retail_input("a", "UTC", "module", b"")

        with self.assertRaisesRegex(ValueError, "sha256"):
            normalize_retail_input("a", "UTC", "module", bytearray(b"data"))

    def test_normalize_retail_input_canonicalizes_identity_and_hashes_source_bytes(self):
        data = b"retail template bytes"

        record = normalize_retail_input("  C_Droid  ", "utc", "C:/Retail/101PER.rim", data)

        self.assertEqual(
            record,
            {
                "resref": "c_droid",
                "restype": "UTC",
                "source": "C:/Retail/101PER.rim",
                "sha256": hashlib.sha256(data).hexdigest(),
            },
        )

    def test_module_scoped_lookup_rejects_missing_capsules(self):
        with self.assertRaisesRegex(ValueError, "capsules"):
            require_module_scoped_capsules([])

    def test_module_scoped_lookup_preserves_only_the_active_module_capsules(self):
        active_capsules = ["101per.rim", "101per_s.rim"]

        validated = require_module_scoped_capsules(active_capsules)

        self.assertEqual(validated, ("101per.rim", "101per_s.rim"))
        self.assertNotIn("102per.rim", validated)

    def test_texture_provenance_records_exact_selected_resource_bytes_and_path(self):
        resource = SimpleNamespace(
            resname="shared_texture",
            restype="TPC",
            filepath="C:/Retail/Modules/101per.rim",
            data=b"101per texture bytes",
        )
        selected_capsules = ("101per.rim",)

        class InstallationFixture:
            def texture_resource_result(self, name, order, *, capsules):
                self.assertEqual(name, "shared_texture")
                if order[0].name == "CUSTOM_MODULES":
                    self.assertEqual(capsules, selected_capsules)
                    return resource, ""
                return None, ""

            def assertEqual(self, actual, expected):
                self_test.assertEqual(actual, expected)

        class TextureFixture:
            def dimensions(self):
                return 32, 32

            def get(self, mipmap, layer):
                return SimpleNamespace(tpc_format=SimpleNamespace(name="DXT1"), data=b"decoded mip")

        self_test = self
        retail_inputs = []
        with patch("retail_snapshot.read_tpc", return_value=TextureFixture()):
            record = texture_record(InstallationFixture(), "shared_texture", selected_capsules, retail_inputs)

        self.assertEqual(
            retail_inputs,
            [normalize_retail_input("shared_texture", "TPC", resource.filepath, resource.data)],
        )
        self.assertEqual(record["locations"][0]["sourcePath"], resource.filepath)

    def test_same_resref_lookup_cannot_substitute_a_different_module_capsule(self):
        active_capsules = ("101per.rim",)
        foreign_capsule = "102per.rim"
        selected = []

        class InstallationFixture:
            def texture_resource_result(self, name, order, *, capsules):
                selected.append(tuple(capsules))
                if foreign_capsule in capsules:
                    raise AssertionError("foreign module capsule was searched")
                return None, ""

        texture_record(InstallationFixture(), "same_resref", active_capsules, [])

        self.assertTrue(selected)
        self.assertTrue(all(capsules == active_capsules for capsules in selected))


if __name__ == "__main__":
    unittest.main()
