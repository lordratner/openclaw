"""Fork-CI qualification; never imports or executes the live installation."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

proof = Path(os.environ["RUNNER_TEMP"]) / "silent-sends-qualified"
proof.mkdir(exist_ok=True)
spec = json.loads(Path(".proof-tools/.qa/nextcloud-silent-sends/candidate-files.json").read_text())
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
        positive=[case for case in failures if case['fullName'].startswith(('sends signed','preserves quiet','publishes a quiet'))]
        negative=[case for case in failures if case not in positive]
        assert len(positive)==5 and len(negative)==5
        assert all('to deeply equal' in '\n'.join(case['failureMessages']) for case in positive)
        assert all('promise resolved' in '\n'.join(case['failureMessages']) and 'instead of rejecting' in '\n'.join(case['failureMessages']) for case in negative)
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
retained=Path('.retained-qualification')
retainedSteps=json.loads((retained/'steps.json').read_text())
assert all(s['code']==0 for s in retainedSteps if s['label'] not in ('original-silent-boundary','affected-lint'))
assert next(s for s in retainedSteps if s['label']=='affected-lint')['code']==1
lint=(retained/'affected-lint.log').read_text()
assert lint.count('(eslint(curly))')==4 and 'Found 0 warnings and 4 errors.' in lint
for name in paths:
    if not name.endswith('silent-send.test.ts'):
        assert Path(name).read_bytes()==(retained/'formatted'/name).read_bytes(),name
originalData=json.loads((retained/'original.json').read_text())
assert originalData['numFailedTests']==10 and originalData['numPassedTests']==4
siblings=json.loads((retained/'repaired.json').read_text()); automaticData=json.loads((retained/'automatic.json').read_text())
assert siblings['success'] and siblings['numPassedTests']==68 and siblings['numFailedTests']==0
assert automaticData['success'] and automaticData['numPassedTests']==20 and automaticData['numFailedTests']==0
command=["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.extension-messaging.config.ts"]
run("corrected-silent-boundary", [*command,"extensions/nextcloud-talk/src/silent-send.test.ts","--maxWorkers=1","--reporter=json","--outputFile="+str(proof/'corrected.json')])
corrected=report('corrected.json',expected_passes=14)
original={'passed':4,'failed':10,'retainedRun':39708462491}
repaired={'passed':68,'failed':0,'retainedSiblingCases':54,'freshSilentCases':14,'retainedRun':39708462491}
automatic={'passed':20,'failed':0,'retainedRun':39708462491}
run("test-types", ["pnpm", "tsgo:extensions:test"])
run("affected-lint", ["node", "scripts/run-oxlint.mjs", "--tsconfig", "extensions/tsconfig.json", *[name for name in paths if name.endswith(".ts")]])
run("prefix-stability", ["pnpm", "test", "src/agents/agent-tools.prefix-stability.test.ts", "--maxWorkers=1", "--reporter=json", "--outputFile=" + str(proof / "prefix.json")])
prefix = report("prefix.json")
run("docs-list", ["pnpm", "docs:list"])
run("format-check", ["pnpm", "exec", "oxfmt", "--check", *paths])
run("whitespace", ["git", "diff", "--check"])
assert all(Path(name).read_bytes() == data for name, data in formatted.items())
(proof / "qualification.json").write_text(json.dumps({"status": "PASS", "source": os.environ["SOURCE_SHA"], "base": os.environ["BASE_SHA"], "original": original, "repaired": repaired, "automatic": automatic, "prefix": prefix, "sourceHashes": {name: hashlib.sha256(data).hexdigest() for name, data in formatted.items()}, "steps": steps}, indent=2) + "\n")
