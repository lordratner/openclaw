"""Bounded proof guards shared by resume qualification and later package admission."""
import hashlib
import json
from pathlib import Path
import re
import tarfile

OLD_RUN = 38924024210
OLD_QA = "bd99e95275753504f87f84603cb7e5276561f749"
OLD_CANDIDATE = "1fe7654c3d26f9d9248f94b05fdbdb7bce5d4d20"
NEW_CANDIDATE = "303b40cfe25aef9012e3c8c1d20e23a63ba70c7f"
BASE = "dcc6e4910d3b85c8636b971d4d8ebc221efcd2b4"
PACKAGE_SHA = "20de681bac90f901406d5149f0da8fcf2520424ac9a79b7d34bb17a0c56e8a0f"
MANIFEST_SHA = "3bbf472ef3eff56cce0595784895eb0efb3cf189400f1501626ebce0918ae759"
CHANGED = "extensions/nextcloud-talk/src/inbound.behavior.test.ts"
REPLACEMENTS = [
    ("fixture: { ...fixture, mediaUrl }", "fixture: Object.assign(fixture, { mediaUrl })"),
    ("expect(result.visibleReplySent).toBe(true);", "expect(result).toMatchObject({ visibleReplySent: true });"),
]
OLD_GATES = {"prepare": "success", "workers": "success", "negative": "success", "reviewnegative": "failure", "messaging": "success", "automatic": "failure", "types": "failure", "docs": "success", "package": "success"}

def read(root, name):
    return json.loads((Path(root) / name).read_text())

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def assertions(result):
    return [a for suite in result["testResults"] for a in suite["assertionResults"]]

def passing(root, name, count, files):
    result = read(root, name)
    assert result["success"] is True and result["numPassedTests"] == count
    assert result["numFailedTests"] == 0 and result["numPendingTests"] == 0
    assert len(result["testResults"]) == files and len(assertions(result)) == count
    assert all(a["status"] == "passed" for a in assertions(result))
    return {"passed": count, "files": files}

def negative(root, name, kind, count):
    result = read(root, name)
    failed = [a for a in assertions(result) if a["status"] == "failed"]
    assert result["success"] is False and result["numFailedTests"] == count and len(failed) == count
    assert result["numPassedTests"] == 0, (name, "unexpected selected passing cases")
    for assertion in failed:
        title = assertion["fullName"]
        message = " ".join(assertion["failureMessages"])
        if kind == "original-direct":
            assert "delivers a real file share" in title
            assert "expected undefined to deeply equal Buffer" in message
        elif kind == "original-auto":
            assert "uploads an automatic" in title
            assert "expected undefined to deeply equal Buffer" in message
        elif kind == "review-auto":
            assert "preserves a bot-only automatic" in title
            assert "apiUser" in message and "apiPassword" in message
        elif kind == "review-direct":
            if "preserves bot-only web attachment links" in title:
                assert "apiUser" in message and "apiPassword" in message
            else:
                assert "explains recovery without sharing" in title
                match = re.search(r"\((401|507|403|500)\)$", title)
                assert match
                expected = {"401": "apiUser", "507": "Files storage", "403": "Nextcloud server logs", "500": "Nextcloud server logs"}[match[1]]
                # Match Vitest's assertion type and stable prefix, not its clipped
                # actual string. The test's preceding toContain checked status.
                assert "attachment upload fail" in message and "to match /" + expected in message
        else:
            raise AssertionError(kind)
    return {"failedAsExpected": count, "kind": kind}

def verify_prior(prior):
    prior = Path(prior)
    assert read(prior, "gate-status.json") == OLD_GATES
    assert digest(prior / "source-manifest.json") == MANIFEST_SHA
    manifest = read(prior, "source-manifest.json")
    assert manifest["candidate"] == OLD_CANDIDATE and manifest["base"] == BASE
    assert len(manifest["files"]) == 13
    for name, value in manifest["files"].items():
        assert digest(prior / "formatted" / name) == value, name
    assert (prior / "format.patch").stat().st_size == 0
    passing(prior, "messaging-tests.json", 99, 5)
    old_auto = read(prior, "automatic-and-auth-tests.json")
    failed = [a for a in assertions(old_auto) if a["status"] == "failed"]
    assert old_auto["success"] is False and old_auto["numPassedTests"] == 33 and old_auto["numFailedTests"] == 2 and old_auto["numPendingTests"] == 0
    assert len(failed) == 2
    assert all("retains the first bot-only" in a["fullName"] and "link receipt when a later link fails" in a["fullName"] and "instead of rejecting" in " ".join(a["failureMessages"]) for a in failed)
    types = (prior / "production-types.log").read_text()
    assert "-p tsconfig.extensions.json" in types and "error TS" not in types and "FAILED" not in types
    test_types = (prior / "test-types.log").read_text()
    errors = re.findall(r"error TS\d+:.*", test_types)
    assert len(errors) == 1 and "TS2339" in errors[0] and "visibleReplySent" in errors[0]
    assert "Found 0 warnings and 0 errors." in (prior / "lint.log").read_text()
    assert "All matched files use the correct format." in (prior / "docs-format.log").read_text()
    assert "broken_links=0" in (prior / "docs-links.log").read_text()
    negative(prior, "baseline-direct.json", "original-direct", 2)
    negative(prior, "baseline-automatic.json", "original-auto", 3)
    negative(prior, "review-baseline-direct.json", "review-direct", 6)
    negative(prior, "review-baseline-automatic.json", "review-auto", 3)
    return manifest

def verify_sources(root, candidate):
    root = Path(root)
    assert candidate == NEW_CANDIDATE
    old = verify_prior(root / "retained-producer")
    current = read(root, "source-manifest.json")
    assert current["candidate"] == candidate and current["base"] == BASE
    assert set(current["files"]) == set(old["files"])
    for name, value in current["files"].items():
        assert digest(root / "formatted" / name) == value, name
        if name != CHANGED:
            assert value == old["files"][name], name
    expected = (root / "retained-producer/formatted" / CHANGED).read_text()
    for before, after in REPLACEMENTS:
        assert expected.count(before) == 1, before
        expected = expected.replace(before, after)
    assert (root / "formatted" / CHANGED).read_text() == expected, "Only the two exact fixture replacements are admitted"
    return current

def verify_package(root):
    root = Path(root)
    package = root / "openclaw-outbound.tgz"
    assert package.stat().st_size == 130199692 and digest(package) == PACKAGE_SHA
    assert (root / "package-source-manifest.json").read_bytes() == (root / "retained-producer/source-manifest.json").read_bytes()
    with tarfile.open(package) as archive:
        build = json.load(archive.extractfile("package/dist/build-info.json"))
        assert build["commit"] == OLD_CANDIDATE
        assert not any("inbound.behavior.test" in member.name for member in archive), "Changed test must not be shipped in retained runtime"
        for plugin in ["nextcloud-talk", "openai"]:
            assert archive.getmember(f"package/dist/extensions/{plugin}/index.js").size > 0
            assert archive.getmember(f"package/dist/extensions/{plugin}/openclaw.plugin.json").size > 0
    return build
