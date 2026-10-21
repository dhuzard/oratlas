"""Deliberate local recapture only; CI never imports or runs upstream code.

Use a clean checkout at the pin in fixtures/pins.json and its installed dev
requirements. Generated timestamps remain authentic, so recapturing changes the
report bytes and requires reviewing all hashes. Never run this in acceptance CI.
"""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys

producer = Path(sys.argv[1]).resolve()
output = Path(__file__).parent / "fixtures" / "verify"
pins = json.loads((output.parent / "pins.json").read_text())
commit = subprocess.check_output(["git", "-C", str(producer), "rev-parse", "HEAD"], text=True).strip()
if commit != pins["verify"]["commit"]:
    raise SystemExit("Producer checkout is not at the reviewed verifier pin")
if subprocess.check_output(["git", "-C", str(producer), "status", "--porcelain"], text=True):
    raise SystemExit("Producer checkout must be clean")
sys.path.insert(0, str(producer / "src"))
spec = importlib.util.spec_from_file_location("upstream_capture", producer / "tests/oratlas/test_client_e2e.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
server = module.FakeORAtlas("Results: t(38) = 3.12, p = 0.0034, two-sided.")
with module._client(server) as client:
    module.ORAtlasVerificationWorker(module.build_default_registry()).run("run-1", client)
(output / "report.json").write_bytes(server.artifact_bytes)
for name, value in [("input", server.input), ("protocol", server.protocol)]:
    (output / f"{name}.json").write_text(json.dumps(value, indent=2) + "\n")
requests = []
for request in server.requests:
    if request.url.path.endswith("/findings"):
        (output / "finding.json").write_bytes(request.content)
    requests.append({"method": request.method, "path": request.url.path, "bodySha256": module.sha256_bytes(request.content)})
(output / "requests.json").write_text(json.dumps(requests, indent=2) + "\n")
print("Captured producer outputs. Review the changed bytes and update pins.json manually.")
