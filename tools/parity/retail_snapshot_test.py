"""Unit tests for retail snapshot provenance helpers.

These tests intentionally do not access a retail installation.  They lock the
normalization and module-capsule boundary that real snapshot captures rely on.
"""

import hashlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from retail_snapshot import (audio_snapshot, audio_track_record, item_tag, model_presentation_snapshot,
                             normalize_retail_input, require_module_scoped_capsules, texture_record,
                             behavior_chain_snapshot)


class RetailSnapshotTests(unittest.TestCase):
    def test_medcom_behavior_chain_records_only_verified_retail_links_and_result(self):
        ncs = bytes.fromhex(
            "4e43532056312e3042000000341e000000000820000403000000010405000e"
            "3130315045525f4d65645f4c6f6705000245022000"
        )
        on_used_ncs = bytes.fromhex(
            "4e43532056312e30420000006d1e000000000820000403000000000403ffffffff"
            "0403ffffffff0403000000000405000004050000040500000405000004050000"
            "0405000004030000000104030000000104030000000004050000040300000000"
            "0500024101050000cc0f2000"
        )
        entry_ncs = bytes.fromhex(
            "4e43532056312e3042000000701e0000000008200002060403000000000405"
            "00064d45444c4f47050000c8020101fffffff800041b00fffffffc2c100000"
            "0000000000041d000000001a0301fffffffc0004050000d501050000d60120"
            "00050000ee0005000006021b00fffffffc2000"
        )
        fade_ncs = bytes.fromhex(
            "4e43532056312e30420000007a1e0000000008200004040000000004040000"
            "0000040400000000040400000000040400000000050002d0052c100000000000"
            "0000001d000000002b04040000000004040000000004040000000004043e9999"
            "9a040400000000050002cf05200004043f00000005000007022000"
        )
        condition_ncs = bytes.fromhex(
            "4e43532056312e3042000000a202031e0000000008200002030405000e"
            "3130315045525f4d65645f4c6f6705000244010101fffffff800041b00ff"
            "fffffc0301fffffffc00040403000000000e201f000000002c040300000001"
            "0101fffffff400041b00fffffff81d00000000381b00fffffffc1d00000000"
            "260403000000000101fffffff400041b00fffffff81d00000000121b00ffffff"
            "fc1b00fffffffc2000"
        )
        resources = {
            ("comppnl001", "UTP"): SimpleNamespace(resname="comppnl001", restype="UTP", filepath="101per_s.rim", data=b"utp"),
            ("medlog", "DLG"): SimpleNamespace(resname="medlog", restype="DLG", filepath="101per_dlg.erf", data=b"dlg"),
            ("a_compdlg", "NCS"): SimpleNamespace(resname="a_compdlg", restype="NCS", filepath="scripts.bif", data=on_used_ncs),
            ("a_setmedlog1", "NCS"): SimpleNamespace(resname="a_setmedlog1", restype="NCS", filepath="101per_s.rim", data=ncs),
            ("a_medlogjmp", "NCS"): SimpleNamespace(resname="a_medlogjmp", restype="NCS", filepath="101per_s.rim", data=entry_ncs),
            ("a_fadeoutin", "NCS"): SimpleNamespace(resname="a_fadeoutin", restype="NCS", filepath="101per_s.rim", data=fade_ncs),
            ("c_medloggt0", "NCS"): SimpleNamespace(resname="c_medloggt0", restype="NCS", filepath="101per_s.rim", data=condition_ncs),
        }
        installation = SimpleNamespace(resource=lambda name, kind, order, *, capsules: resources.get((name, kind.name)))
        reply = SimpleNamespace(list_index=19, script1="a_setmedlog1", script2="a_fadeoutin")
        logs_entry = SimpleNamespace(list_index=14, links=[SimpleNamespace(node=reply)])
        logs_reply = SimpleNamespace(list_index=16, links=[SimpleNamespace(node=logs_entry)])
        fresh_entry = SimpleNamespace(list_index=0, script1="a_medlogjmp", links=[SimpleNamespace(node=logs_reply)])
        dialogue = SimpleNamespace(starters=[SimpleNamespace(active1="c_medloggt0", node=SimpleNamespace(list_index=16)),
                                             SimpleNamespace(active1="", node=fresh_entry)])
        git_resource = SimpleNamespace(resname=lambda: "101per", restype=lambda: "GIT", active=lambda: "101per.rim", data=lambda: b"git")
        module = SimpleNamespace(git=lambda: git_resource)
        git = SimpleNamespace(placeables=[SimpleNamespace(resref=f"other_{index}") for index in range(20)]
                              + [SimpleNamespace(resref="comppnl001")])
        retail_inputs = []

        with patch("retail_snapshot.read_utp", return_value=SimpleNamespace(tag="MedCom", conversation="medlog", on_used="a_compdlg")), \
             patch("retail_snapshot.read_dlg", return_value=dialogue):
            result = behavior_chain_snapshot(installation, module, git, ("101per.rim", "101per_s.rim"), retail_inputs)

        self.assertEqual(result["coverage"], "complete", result)
        self.assertEqual(result["interactionId"], "101per:medcom:medical-log-1")
        self.assertEqual(result["resultState"], {"globalNumber": {"101PER_Med_Log": 1}})
        self.assertEqual(result["ncsIdentity"], normalize_retail_input("a_setmedlog1", "NCS", "101per_s.rim", ncs))
        self.assertEqual(result["dialoguePath"], [0, 16, 14, 19])
        self.assertEqual(result["replyScript"], {"resref": "a_setmedlog1", "restype": "NCS"})
        self.assertEqual({(item["resref"], item["restype"]) for item in retail_inputs},
                         {("101per", "GIT"), ("comppnl001", "UTP"), ("medlog", "DLG"),
                          ("a_compdlg", "NCS"), ("a_setmedlog1", "NCS"),
                          ("a_medlogjmp", "NCS"), ("a_fadeoutin", "NCS"),
                          ("c_medloggt0", "NCS")})
        self.assertEqual(result["sourceIdentities"]["onUsedNcs"]["sha256"],
                         "7c6c4ea4a28acbe2e0eb393b5e11e6638a695bee168f2f08dd8c35108c1ab5e3")

        resources[("a_compdlg", "NCS")] = SimpleNamespace(
            resname="a_compdlg", restype="NCS", filepath="Override/a_compdlg.ncs", data=b"changed")
        with patch("retail_snapshot.read_utp", return_value=SimpleNamespace(tag="MedCom", conversation="medlog", on_used="a_compdlg")), \
             patch("retail_snapshot.read_dlg", return_value=dialogue):
            changed = behavior_chain_snapshot(installation, module, git, ("101per.rim", "101per_s.rim"), [])
        self.assertEqual(changed["coverage"], "missing-evidence")

    def test_behavior_chain_io_failure_is_missing_evidence_not_partial_provenance(self):
        def unreadable_resource(*args, **kwargs):
            raise OSError("retail capsule became unreadable")

        git_resource = SimpleNamespace(resname=lambda: "101per", restype=lambda: "GIT",
                                       active=lambda: "101per.rim", data=lambda: b"git")
        git = SimpleNamespace(placeables=[SimpleNamespace(resref=f"other_{index}") for index in range(20)]
                              + [SimpleNamespace(resref="comppnl001")])
        retail_inputs = []
        result = behavior_chain_snapshot(SimpleNamespace(resource=unreadable_resource),
                                         SimpleNamespace(git=lambda: git_resource), git,
                                         ("101per.rim",), retail_inputs)

        self.assertEqual(result["coverage"], "missing-evidence")
        self.assertIsNone(result["resultState"])
        self.assertEqual(retail_inputs, [])

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
        self.assertEqual(record["retail"]["resourceIdentity"], retail_inputs[0])

    def test_texture_winner_retains_selected_type_when_both_tga_and_tpc_exist(self):
        resources = {
            "OVERRIDE": SimpleNamespace(resname="shared", restype="TGA", filepath="Override/shared.tga", data=b"tga bytes"),
            "TEXTURES_TPA": SimpleNamespace(resname="shared", restype="TPC", filepath="TPA.erf", data=b"tpc bytes"),
        }

        class InstallationFixture:
            def texture_resource_result(self, name, order, *, capsules):
                return resources.get(order[0].name), ""

        texture = SimpleNamespace(dimensions=lambda: (32, 32), get=lambda *args: SimpleNamespace(
            tpc_format=SimpleNamespace(name="RGBA"), data=b"decoded pixels"))
        retail_inputs = []
        with patch("retail_snapshot.read_tpc", return_value=texture):
            record = texture_record(InstallationFixture(), "shared", ["101per.rim"], retail_inputs)
        self.assertEqual(record["retail"]["resourceIdentity"], retail_inputs[0])
        self.assertEqual(record["retail"]["resourceIdentity"]["restype"], "TGA")
        self.assertEqual([entry["resourceIdentity"]["restype"] for entry in record["locations"]], ["TGA", "TPC"])

    def test_model_provenance_retains_module_scoped_mdl_separately_from_utp(self):
        retail_inputs = []
        capsules = ("101per.rim",)
        self_test = self

        class InstallationFixture:
            def resource(self, name, restype, order, *, capsules):
                self_test.assertEqual(capsules, ("101per.rim",))
                self_test.assertIn("CUSTOM_MODULES", [location.name for location in order])
                return SimpleNamespace(resname=name, restype=restype, filepath="101per.rim", data=restype.name.encode())

        with patch("retail_snapshot.creature_model_names", return_value={"body"}), \
             patch("retail_snapshot.twoda_cell", return_value="body"), \
             patch("retail_snapshot.read_utp", return_value=SimpleNamespace(appearance_id=7)):
            records = model_presentation_snapshot(InstallationFixture(), SimpleNamespace(
                placeables=[SimpleNamespace(resref="prop")]), capsules, retail_inputs)
        self.assertEqual(records[0]["modelResourceIdentity"], retail_inputs[1])
        self.assertEqual([(record["resref"], record["restype"]) for record in retail_inputs], [("prop", "UTP"), ("body", "MDL")])

    def test_area_audio_provenance_uses_actual_git_resname(self):
        git_resource = SimpleNamespace(data=lambda: b"area bytes", resname=lambda: "actual_area",
                                       restype=lambda: "GIT", active=lambda: "101per.rim")
        root = SimpleNamespace(exists=lambda field: False)
        retail_inputs = []
        with patch("retail_snapshot.read_gff", return_value=SimpleNamespace(root=root)), \
             patch("retail_snapshot.twoda_resource", return_value=None):
            snapshot = audio_snapshot(None, SimpleNamespace(git=lambda: git_resource),
                                      SimpleNamespace(sounds=[]), ["101per.rim"], retail_inputs)
        self.assertEqual(snapshot["resourceIdentity"], normalize_retail_input(
            "actual_area", "GIT", "101per.rim", b"area bytes"))

    def test_missing_audio_track_retains_authored_table_identity(self):
        resource = SimpleNamespace(resname="ambientmusic", restype="TwoDA", filepath="data.bif", data=b"table bytes")
        installation = SimpleNamespace(resource=lambda *args: resource)
        table = SimpleNamespace(get_height=lambda: 1, get_row=lambda index: SimpleNamespace(get_string=lambda column: "missing_music"))
        retail_inputs = []
        with patch("retail_snapshot.read_2da", return_value=table), \
             patch("retail_snapshot.sound_location", return_value="none"):
            track = audio_track_record(installation, "ambientmusic", 0, retail_inputs)
        self.assertEqual(track, {"resource": "missing_music", "retailSource": "none", "resourceIdentity": retail_inputs[0]})

    def test_unresolved_mdl_does_not_invent_a_model_identity(self):
        def resource(name, restype, order, *, capsules):
            if restype.name == "MDL":
                return None
            return SimpleNamespace(resname=name, restype=restype, filepath="101per.rim", data=b"template")

        retail_inputs = []
        with patch("retail_snapshot.creature_model_names", return_value=set()), \
             patch("retail_snapshot.twoda_cell", return_value="missing_model"), \
             patch("retail_snapshot.read_utp", return_value=SimpleNamespace(appearance_id=7)):
            records = model_presentation_snapshot(SimpleNamespace(resource=resource), SimpleNamespace(
                placeables=[SimpleNamespace(resref="prop")]), ["101per.rim"], retail_inputs)
        self.assertIsNone(records[0]["modelResourceIdentity"])
        self.assertEqual([record["restype"] for record in retail_inputs], ["UTP"])

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
