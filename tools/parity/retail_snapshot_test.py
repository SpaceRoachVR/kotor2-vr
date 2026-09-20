"""Unit tests for retail snapshot provenance helpers.

These tests intentionally do not access a retail installation.  They lock the
normalization and module-capsule boundary that real snapshot captures rely on.
"""

import hashlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from retail_snapshot import item_tag, normalize_retail_input, require_module_scoped_capsules, texture_record


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

    def test_same_resref_uses_active_capsule_bytes_for_template_and_texture(self):
        class CapsuleFixture:
            def __init__(self, path, template_bytes, texture_bytes):
                self.path = path
                self.template_bytes = template_bytes
                self.texture_bytes = texture_bytes

        active_capsule = CapsuleFixture(
            "C:/Retail/Modules/101per.rim", b"101per uti bytes", b"101per texture bytes"
        )
        foreign_capsule = CapsuleFixture(
            "C:/Retail/Modules/102per.rim", b"102per uti bytes", b"102per texture bytes"
        )
        active_capsules = (active_capsule,)

        def result_for(capsules, restype):
            selected_capsule = active_capsule if tuple(capsules or ()) == active_capsules else foreign_capsule
            raw_bytes = (
                selected_capsule.template_bytes if restype == "UTI" else selected_capsule.texture_bytes
            )
            return SimpleNamespace(
                resname="same_resref",
                restype=restype,
                filepath=selected_capsule.path,
                data=raw_bytes,
            )

        class InstallationFixture:
            def resource(self, name, restype, order, *, capsules):
                self_test.assertEqual(name, "same_resref")
                self_test.assertIn("CUSTOM_MODULES", {location.name for location in order})
                return result_for(capsules, "UTI")

            def texture_resource_result(self, name, order, *, capsules):
                self_test.assertEqual(name, "same_resref")
                if order[0].name != "CUSTOM_MODULES":
                    return None, ""
                return result_for(capsules, "TPC"), ""

        class TextureFixture:
            def dimensions(self):
                return 32, 32

            def get(self, mipmap, layer):
                return SimpleNamespace(tpc_format=SimpleNamespace(name="DXT1"), data=b"decoded mip")

        self_test = self
        retail_inputs = []
        with patch("retail_snapshot.read_uti", return_value=SimpleNamespace(tag="active-item")):
            self.assertEqual(item_tag(InstallationFixture(), "same_resref", active_capsules, retail_inputs), "active-item")
        with patch("retail_snapshot.read_tpc", return_value=TextureFixture()):
            texture = texture_record(InstallationFixture(), "same_resref", active_capsules, retail_inputs)

        self.assertEqual(texture["locations"][0]["sourcePath"], active_capsule.path)
        self.assertEqual(
            retail_inputs,
            [
                normalize_retail_input("same_resref", "UTI", active_capsule.path, active_capsule.template_bytes),
                normalize_retail_input("same_resref", "TPC", active_capsule.path, active_capsule.texture_bytes),
            ],
        )
        self.assertNotIn(foreign_capsule.path, {record["source"] for record in retail_inputs})


if __name__ == "__main__":
    unittest.main()
