import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time

root = Path(os.environ["RUNNER_TEMP"]) / "nextcloud-voice-package"
root.mkdir()
qualified = json.loads(Path(".retained-qualification/qualification.json").read_text())
assert qualified["status"] == "PASS"
source = os.environ["SOURCE_SHA"]
assert subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == source
for name, digest in qualified["sourceHashes"].items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == digest, name
(root / "retained-qualification.json").write_text(json.dumps(qualified, indent=2) + "\n")
steps = []


def run(label, args, env):
    started = time.monotonic()
    with (root / (label + ".log")).open("w") as output:
        result = subprocess.run(args, env=env, stdout=output, stderr=subprocess.STDOUT)
    steps.append({"label": label, "code": result.returncode, "wallSeconds": time.monotonic() - started})
    (root / "steps.json").write_text(json.dumps(steps, indent=2) + "\n")
    assert result.returncode == 0, label


env = dict(os.environ)
env.pop("OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS", None)
package = root / "voice-replies.tgz"
run("canonical-package", ["node", "scripts/package-openclaw-for-docker.mjs", "--bundle-plugin", "nextcloud-talk", "--allow-unreleased-changelog", "--output-dir", str(root), "--output-name", package.name, "--pack-json", str(root / "pack.json")], env)
with tarfile.open(package) as archive:
    build = json.load(archive.extractfile("package/dist/build-info.json"))
    assert build["commit"] == source
    for plugin in ("nextcloud-talk", "openai"):
        assert json.load(archive.extractfile("package/dist/extensions/" + plugin + "/openclaw.plugin.json"))["id"] == plugin
digest = hashlib.sha256(package.read_bytes()).hexdigest()
(root / "package-identity.json").write_text(json.dumps({"source": source, "packageSha256": digest, "build": build, "sourceHashes": qualified["sourceHashes"]}, indent=2) + "\n")
print(str(package))
