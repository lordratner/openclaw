"""Fork-CI qualification; never imports or executes the live installation."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

proof = Path(os.environ["RUNNER_TEMP"]) / "voice-replies-qualified"
proof.mkdir(exist_ok=True)
spec = json.loads(Path(".proof-tools/.qa/nextcloud-voice-replies/candidate-files.json").read_text())
paths = list(spec)
steps = []


def run(label, args, expected=0):
    start = time.monotonic()
    with (proof / (label + ".log")).open("w") as output:
        result = subprocess.run(args, stdout=output, stderr=subprocess.STDOUT)
    steps.append({"label": label, "code": result.returncode, "wallSeconds": time.monotonic() - start})
    (proof / "steps.json").write_text(json.dumps(steps, indent=2) + "\n")
    assert result.returncode == expected, (label, result.returncode)


def report(name, expected_failures=0, expected_passes=None):
    result = json.loads((proof / name).read_text())
    assert result.get("numRuntimeErrorTestSuites", 0) == 0
    assert not result.get("unhandledErrors") and not result.get("numUnhandledErrors", 0)
    cases = [case for suite in result["testResults"] for case in suite["assertionResults"]]
    active = [case for case in cases if case["status"] in ("passed", "failed")]
    failures = [case for case in active if case["status"] == "failed"]
    passed = [case for case in active if case["status"] == "passed"]
    assert len(failures) == expected_failures and passed
    if expected_passes is not None:
        assert len(passed) == expected_passes
    if expected_failures:
        assert all("AssertionError" in "\n".join(case["failureMessages"]) for case in failures)
        assert sum("as voice=true" in case["fullName"] for case in failures) == 2
        assert sum("requires native delivery" in case["fullName"] for case in failures) == 1
    else:
        assert len(active) == len(cases) and result["success"]
    return {"passed": len(passed), "failed": len(failures)}


assert subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == os.environ["SOURCE_SHA"]
for name, digest in spec.items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == digest, name
run("format", ["pnpm", "exec", "oxfmt", "--write", *paths])
formatted = {name: Path(name).read_bytes() for name in paths}
for name, data in formatted.items():
    destination = proof / "formatted" / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
run("runtime-prerequisites", ["pnpm", "build", "qaRuntime"])
test = "extensions/nextcloud-talk/src/outbound-media.test.ts"
command = ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.extension-messaging.config.ts"]
production = [name for name in paths if name.endswith(".ts") and ".test" not in name]
try:
    for name in production:
        Path(name).write_bytes(subprocess.check_output(["git", "show", os.environ["BASE_SHA"] + ":" + name]))
    run("original-voice-boundary", [*command, test, "--maxWorkers=1", "--testNamePattern", "delivers .* with audioAsVoice=|requires native delivery instead", "--reporter=json", "--outputFile=" + str(proof / "original.json")], expected=1)
    original = report("original.json", expected_failures=3, expected_passes=4)
finally:
    for name in production:
        Path(name).write_bytes(formatted[name])
run("voice-and-media-siblings", [*command, test, "extensions/nextcloud-talk/src/outbound-media.regression.test.ts", "extensions/nextcloud-talk/src/channel.core.test.ts", "--maxWorkers=1", "--reporter=json", "--outputFile=" + str(proof / "repaired.json")])
repaired = report("repaired.json")
run("automatic-reply", ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.extension-database-workers.config.ts", "extensions/nextcloud-talk/src/inbound.behavior.test.ts", "--maxWorkers=1", "--reporter=json", "--outputFile=" + str(proof / "automatic.json")])
automatic = report("automatic.json")
run("production-types", ["pnpm", "tsgo:extensions"])
run("test-types", ["pnpm", "tsgo:extensions:test"])
run("affected-lint", ["node", "scripts/run-oxlint.mjs", "--tsconfig", "extensions/tsconfig.json", *[name for name in paths if name.endswith(".ts")]])
run("prefix-stability", ["pnpm", "test", "src/agents/agent-tools.prefix-stability.test.ts", "--maxWorkers=1", "--reporter=json", "--outputFile=" + str(proof / "prefix.json")])
prefix = report("prefix.json")
run("docs-list", ["pnpm", "docs:list"])
run("format-check", ["pnpm", "exec", "oxfmt", "--check", *paths])
run("whitespace", ["git", "diff", "--check"])
assert all(Path(name).read_bytes() == data for name, data in formatted.items())
(proof / "qualification.json").write_text(json.dumps({"status": "PASS", "source": os.environ["SOURCE_SHA"], "base": os.environ["BASE_SHA"], "original": original, "repaired": repaired, "automatic": automatic, "prefix": prefix, "sourceHashes": {name: hashlib.sha256(data).hexdigest() for name, data in formatted.items()}, "steps": steps}, indent=2) + "\n")
