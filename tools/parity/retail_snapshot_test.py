"""Unit tests for retail snapshot provenance helpers.

These tests intentionally do not access a retail installation.  They lock the
normalization and module-capsule boundary that real snapshot captures rely on.
"""

import hashlib
import unittest

from retail_snapshot import normalize_retail_input, require_module_scoped_capsules


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


if __name__ == "__main__":
    unittest.main()
