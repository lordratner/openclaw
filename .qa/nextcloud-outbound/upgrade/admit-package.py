"""CI-only admission of an exact successful qualification producer; no installation."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tarfile
import urllib.request

assert os.environ.get("GITHUB_ACTIONS") == "true", "GitHub disposable CI only"
candidate = os.environ["CANDIDATE_SHA"]
producer = os.environ["QUALIFIED_RUN_ID"]
assert re.fullmatch(r"[0-9a-f]{40}", candidate), "Bind EXACT_PRODUCT_SHA before dispatch"
assert re.fullmatch(r"[1-9][0-9]+", producer), "Bind QUALIFIED_RUN_ID before dispatch"
repo = "lordratner/openclaw"
request = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/actions/runs/{producer}",
    headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json"},
)
with urllib.request.urlopen(request, timeout=30) as response:
    run = json.load(response)
assert run["status"] == "completed" and run["conclusion"] == "success"
assert run["repository"]["full_name"] == repo
package = Path(os.environ["RUNNER_TEMP"]) / "nextcloud-outbound-package"
receipt = json.loads((package / "qualification.json").read_text())
assert receipt["status"] == "PASS" and receipt["candidate"] == candidate
gates = json.loads((package / "gate-status.json").read_text())
assert gates and all(value == "success" for value in gates.values()), "Every actual producer outcome must pass"
assert (package / "format.patch").stat().st_size == 0, "Package must match already formatted source"
assert receipt.get("upstreamCoreUnmodified") is True
assert receipt.get("upstreamDependencyFixPR") == 173798
archive_path = package / "openclaw-outbound.tgz"
assert hashlib.sha256(archive_path.read_bytes()).hexdigest() == receipt["packageSha256"]
assert hashlib.sha256((package / "source-manifest.json").read_bytes()).hexdigest() == receipt["sourceManifestSha256"]
assert json.loads((package / "source-manifest.json").read_text())["candidate"] == candidate
package_candidate = receipt.get("packageCandidate", candidate)
retained = package_candidate != candidate
if retained:
    # This one retained package is admitted only by the independently guarded
    # resume producer: two exact test-only changes, never arbitrary older bytes.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "review-resume"))
    from verify import NEW_CANDIDATE, OLD_CANDIDATE, OLD_QA, OLD_RUN, PACKAGE_SHA, negative, passing, read, verify_package, verify_sources
    assert candidate == NEW_CANDIDATE and package_candidate == OLD_CANDIDATE
    assert receipt.get("productionBytesUnchanged") is True
    assert receipt.get("retainedProducerRun") == OLD_RUN
    assert receipt.get("retainedProducerQaHead") == OLD_QA
    assert receipt.get("retainedProducerConclusion") == "failure"
    assert receipt["packageSha256"] == PACKAGE_SHA
    assert hashlib.sha256((package / "package-source-manifest.json").read_bytes()).hexdigest() == receipt["packageSourceManifestSha256"]
    assert set(gates) == {"admit", "formatlint", "workers", "automatic", "types", "negative"}
    verify_sources(package, candidate)
    verify_package(package)
    passing(package, "automatic-and-auth-tests.json", 35, 3)
    negative(package, "baseline-automatic.json", "original-auto", 3)
    negative(package, "review-baseline-automatic.json", "review-auto", 3)
    original_run = read(package, "retained-producer-run.json")
    assert original_run["id"] == OLD_RUN and original_run["headSha"] == OLD_QA and original_run["conclusion"] == "failure"
    retained_proof = read(package, "retained-proof.json")
    assert retained_proof["productionBytesUnchanged"] is True and retained_proof["retainedPassingTests"] == 99
    assert receipt["freshPassingTests"] == 35 and receipt["retainedPassingTests"] == 99
    assert receipt["baselineMissingNativeUploadControls"] == 5 and receipt["reviewRegressionControls"] == 9
with tarfile.open(archive_path) as archive:
    build = json.load(archive.extractfile("package/dist/build-info.json"))
    assert build["commit"] == package_candidate
    for plugin in ("nextcloud-talk", "openai"):
        assert archive.getmember(f"package/dist/extensions/{plugin}/index.js").size > 0
        assert archive.getmember(f"package/dist/extensions/{plugin}/openclaw.plugin.json").size > 0
evidence = Path(os.environ["RUNNER_TEMP"]) / "nextcloud-outbound-live/evidence"
evidence.mkdir(parents=True, exist_ok=True)
(evidence / "package-admission.json").write_text(json.dumps({
    "status": "PASS", "producerRun": int(producer), "producerHead": run["head_sha"],
    "candidate": candidate, "packageCandidate": package_candidate,
    "packageSha256": receipt["packageSha256"], "sourceManifestSha256": receipt["sourceManifestSha256"],
    "upstreamDependencyFixPR": 173798,
    "actualProducerGates": gates,
    "productionBytesUnchanged": retained,
    "retainedProducerRun": receipt.get("retainedProducerRun"),
    "retainedProducerQaHead": receipt.get("retainedProducerQaHead"),
    "packageSourceManifestSha256": receipt.get("packageSourceManifestSha256"),
}, indent=2) + "\n")
