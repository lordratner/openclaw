"""Scoped resume writer: failed producer stays failed; fresh outcomes own PASS."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
from verify import BASE, CHANGED, NEW_CANDIDATE, OLD_CANDIDATE, OLD_QA, OLD_RUN, PACKAGE_SHA, REPLACEMENTS, digest, negative, passing, read, verify_package, verify_prior, verify_sources

assert os.environ.get("GITHUB_ACTIONS") == "true"
root = Path(os.environ["RUNNER_TEMP"]) / "nextcloud-outbound-proof"
root.mkdir(parents=True, exist_ok=True)
candidate = os.environ["CANDIDATE_SHA"]
assert candidate == NEW_CANDIDATE and os.environ["BASE_SHA"] == BASE
core = "src/auto-reply/reply/agent-runner-core.ts"

def source_tree_guard():
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == candidate
    changed = subprocess.check_output(["git", "diff", "--name-only", OLD_CANDIDATE, candidate], text=True).splitlines()
    assert changed == [CHANGED], changed
    assert Path(core).read_bytes() == subprocess.check_output(["git", "show", BASE + ":" + core])
    assert b'if (sourceDelivery === "delivered" || params.sourceReplyDeliveryState !== undefined)' not in Path(core).read_bytes()
    subprocess.run(["git", "diff", "--exit-code"], check=True)

if sys.argv[1] == "prepare":
    prior = Path(os.environ["RUNNER_TEMP"]) / "nextcloud-outbound-prior"
    manifest = verify_prior(prior)
    request = urllib.request.Request(f"https://api.github.com/repos/lordratner/openclaw/actions/runs/{OLD_RUN}", headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        run = json.load(response)
    assert run["status"] == "completed" and run["conclusion"] == "failure" and run["head_sha"] == OLD_QA
    source_tree_guard()
    old = (prior / "formatted" / CHANGED).read_text()
    for before, after in REPLACEMENTS:
        assert old.count(before) == 1
        old = old.replace(before, after)
    assert Path(CHANGED).read_text() == old
    for name, value in manifest["files"].items():
        if name != CHANGED:
            assert digest(name) == value, name
        target = root / "formatted" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(Path(name).read_bytes())
    shutil.copytree(prior / "formatted", root / "retained-producer/formatted", dirs_exist_ok=True)
    for name in ["source-manifest.json", "gate-status.json", "format.patch", "messaging-tests.json", "messaging-tests.log", "automatic-and-auth-tests.json", "automatic-and-auth-tests.log", "production-types.log", "test-types.log", "lint.log", "docs-format.log", "docs-list.log", "docs-links.log", "baseline-direct.json", "baseline-direct.log", "baseline-automatic.json", "baseline-automatic.log", "review-baseline-direct.json", "review-baseline-direct.log", "review-baseline-automatic.json", "review-baseline-automatic.log", "package.log"]:
        shutil.copy2(prior / name, root / "retained-producer" / name)
    for name in ["openclaw-outbound.tgz", "pack.json"]:
        shutil.copy2(prior / name, root / name)
    (root / "package-source-manifest.json").write_bytes((prior / "source-manifest.json").read_bytes())
    (root / "source-manifest.json").write_text(json.dumps({"candidate": candidate, "base": BASE, "files": {name: digest(name) for name in manifest["files"]}}, indent=2) + "\n")
    (root / "format.patch").write_bytes(subprocess.check_output(["git", "diff", "--binary"]))
    (root / "retained-producer-run.json").write_text(json.dumps({"id": OLD_RUN, "headSha": run["head_sha"], "status": run["status"], "conclusion": run["conclusion"], "url": run["html_url"]}, indent=2) + "\n")
    verify_sources(root, candidate)
    verify_package(root)
    (root / "retained-proof.json").write_text(json.dumps({"status": "ADMITTED_PARTIAL_EVIDENCE", "producerRun": OLD_RUN, "producerQaHead": OLD_QA, "producerConclusion": "failure", "packageCandidate": OLD_CANDIDATE, "productionBytesUnchanged": True, "wholeSourceTreeDelta": [CHANGED], "exactFixtureReplacements": REPLACEMENTS, "retainedPassingTests": 99, "productionTypesRetained": True, "docsRetained": True, "packageRetained": True}, indent=2) + "\n")
elif sys.argv[1] == "controls":
    negative(root, "baseline-automatic.json", "original-auto", 3)
    negative(root, "review-baseline-automatic.json", "review-auto", 3)
elif sys.argv[1] == "finalize":
    gates = json.loads(os.environ["QUALIFICATION_GATES"])
    (root / "gate-status.json").write_text(json.dumps(gates, indent=2) + "\n")
    assert set(gates) == {"admit", "formatlint", "workers", "automatic", "types", "negative"}
    assert all(value == "success" for value in gates.values()), gates
    manifest = verify_sources(root, candidate)
    for name, value in manifest["files"].items():
        assert digest(name) == value, name
    source_tree_guard()
    build = verify_package(root)
    passing(root, "automatic-and-auth-tests.json", 35, 3)
    negative(root, "baseline-automatic.json", "original-auto", 3)
    negative(root, "review-baseline-automatic.json", "review-auto", 3)
    assert (root / "format.patch").stat().st_size == 0
    assert "Found 0 warnings and 0 errors." in (root / "affected-lint.log").read_text()
    assert "All matched files use the correct format." in (root / "affected-format.log").read_text()
    assert "error TS" not in (root / "test-types.log").read_text() and "FAILED" not in (root / "test-types.log").read_text()
    receipt = {"status": "PASS", "candidate": candidate, "base": BASE, "packageCandidate": OLD_CANDIDATE, "productionBytesUnchanged": True, "retainedProducerRun": OLD_RUN, "retainedProducerQaHead": OLD_QA, "retainedProducerConclusion": "failure", "upstreamDependencyFixPR": 173798, "upstreamCoreUnmodified": True, "sourceManifestSha256": digest(root / "source-manifest.json"), "packageSourceManifestSha256": digest(root / "package-source-manifest.json"), "packageSha256": PACKAGE_SHA, "tests": {"messaging-tests": {"passed": 99, "files": 5, "evidence": "retained"}, "automatic-and-auth-tests": {"passed": 35, "files": 3, "evidence": "fresh"}}, "freshPassingTests": 35, "retainedPassingTests": 99, "baselineMissingNativeUploadControls": 5, "reviewRegressionControls": 9, "freshAutomaticControls": 6, "retainedDirectControls": 8, "bundledPluginsVerified": ["nextcloud-talk", "openai"], "packageBuildInfo": build}
    (root / "qualification.json").write_text(json.dumps(receipt, indent=2) + "\n")
else:
    raise SystemExit("Unknown phase")
