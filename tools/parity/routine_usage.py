"""Count ACTION routine ids across every compiled script in the retail TSL install.

Run with the kotormcp-local venv python (PyKotor):
  python tools/parity/routine_usage.py tools/parity/out/routine_usage.json
then rank what is still unimplemented with tools/parity/routine_coverage.js.
"""
import json, logging, os, sys, collections
logging.disable(logging.CRITICAL)
from pykotor.extract.installation import Installation, SearchLocation
from pykotor.resource.type import ResourceType
from pykotor.resource.formats.ncs import read_ncs
from pykotor.resource.formats.ncs.ncs_data import NCSInstructionType as T
from pykotor.extract.capsule import Capsule
import glob
ROOT = os.environ.get("KOTOR2_ROOT", r"D:SteamLibrarysteamappscommonKnights of the Old Republic II")
inst = Installation(ROOT)
calls = collections.Counter(); scripts = collections.defaultdict(set); seen = set(); failed = 0
def handle(name, data):
    global failed
    key = (name.lower(), hash(data))
    if key in seen: return
    seen.add(key)
    try: ncs = read_ncs(data)
    except Exception: failed += 1; return
    for ins in ncs.instructions:
        if ins.ins_type == T.ACTION:
            rid = ins.args[0]; calls[rid] += 1; scripts[rid].add(name.lower())
for res in inst.chitin_resources():
    if res.restype() == ResourceType.NCS: handle(res.resname(), res.data())
for path in glob.glob(os.path.join(ROOT, "modules", "*")):
    if not path.lower().endswith((".rim", ".mod", ".erf")): continue
    try: cap = Capsule(path)
    except Exception: continue
    for res in cap:
        if res.restype() == ResourceType.NCS: handle(res.resname(), res.data())
out = {str(k): {"calls": v, "scripts": len(scripts[k]), "examples": sorted(scripts[k])[:6]} for k, v in calls.items()}
json.dump({"distinctScripts": len(seen), "failed": failed, "routines": out}, open(sys.argv[1], "w"), indent=1)
print(len(seen), "scripts,", failed, "failed,", len(calls), "distinct routines")
