"""GitHub-only exact-head transport proof and red/green regression runner."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

component = sys.argv[1]
assert component in ("tts", "stt")
root = Path.cwd()
out = root / ".speech-proof-results"
out.mkdir(exist_ok=True)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
base = subprocess.check_output(["git", "rev-parse", "HEAD^"], text=True).strip()
source_files = {
    "tts": ["src/tts/tts-synthesis-support.ts", "src/tts/tts-runtime-types.ts"],
    "stt": ["extensions/elevenlabs/realtime-transcription-provider-factory.ts", "src/realtime-transcription/websocket-session.ts"],
}[component]
tests = {
    "tts": [("src/tts/tts-runtime-fallbacks.test.ts", "preserves HTTP failure classification", 3)],
    "stt": [
        ("extensions/elevenlabs/realtime-transcription-provider.test.ts", "reports provider errors exactly once", 2),
        ("src/realtime-transcription/websocket-session.test.ts", "reports pre-ready close failures", 1),
    ],
}[component]
script = root / (".speech-proof-" + component + ".mts")
shutil.copyfile(Path(__file__).parent / (component + "-proof.mts"), script)
receipt = {"component": component, "head": head, "base": base,
           "harness_commit": os.environ.get("GITHUB_SHA"), "runs": []}


def save():
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


def command(args, label, env, timeout):
    started = time.monotonic()
    with (out / (label + ".log")).open("w") as log:
        result = subprocess.run(args, env=env, stdout=log, stderr=subprocess.STDOUT,
                                timeout=timeout)
    record = {"label": label, "command": args, "exit_code": result.returncode,
              "seconds": round(time.monotonic() - started, 3)}
    receipt["runs"].append(record)
    save()
    print(json.dumps(record), flush=True)
    # Logs contain only synthetic fixtures and GitHub checkout paths.
    print((out / (label + ".log")).read_text()[-12000:], flush=True)
    return result.returncode


try:
    for phase in ("base", "head"):
        revision = base if phase == "base" else head
        for filename in source_files:
            content = subprocess.check_output(["git", "show", revision + ":" + filename])
            (root / filename).write_bytes(content)
            actual = subprocess.check_output(["git", "hash-object", filename], text=True).strip()
            wanted = subprocess.check_output(["git", "rev-parse", revision + ":" + filename], text=True).strip()
            assert actual == wanted
        state = root / ".speech-proof-state" / component / phase
        state.mkdir(parents=True, exist_ok=True)
        config = state / "openclaw.json"
        config.write_text("{}\n")
        env = dict(os.environ)
        env.update({
            "SPEECH_PROOF_EXPECT": phase,
            "OPENCLAW_STATE_DIR": str(state),
            "OPENCLAW_CONFIG_PATH": str(config),
            "OPENCLAW_BUNDLED_PLUGINS_DIR": str(root / "extensions"),
            "OPENCLAW_DEBUG_PROXY_ENABLED": "0",
            "OPENCLAW_VITEST_RUNTIME": "node",
        })
        for name in ("ELEVENLABS_API_KEY", "XI_API_KEY", "OPENCLAW_DISABLE_BUNDLED_PLUGINS"):
            env.pop(name, None)
        code = command(["node", "--import", "./scripts/tsx.mjs", str(script)],
                       phase + "-transport", env, 180)
        assert code == 0, phase + " transport proof failed (not a regression verdict)"
        trace = []
        for line in (out / (phase + "-transport.log")).read_text().splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and value.get("proof") == component:
                trace.append(value)
        assert any(v.get("scenarios") == 3 and v.get("ok") for v in trace)
        receipt[phase + "_transport_trace"] = trace
        save()
        for index, (test_file, pattern, expected_failures) in enumerate(tests):
            label = phase + "-regression-" + str(index)
            report = out / (label + ".json")
            args = ["pnpm", "test", test_file, "--maxWorkers=1", "-t", pattern,
                    "--reporter=json", "--outputFile=" + str(report)]
            # Let the normal test harness own its environment; do not inherit the
            # transport demo's now-closed server/configuration into a test run.
            test_env = dict(os.environ)
            test_env["OPENCLAW_VITEST_RUNTIME"] = "node"
            code = command(args, label, test_env, 1200)
            assert report.exists(), "Regression did not produce test results; setup failure"
            results = json.loads(report.read_text())
            failures = [a for suite in results.get("testResults", [])
                        for a in suite.get("assertionResults", []) if a.get("status") == "failed"]
            if phase == "base":
                assert code != 0 and len(failures) == expected_failures
                assert results.get("numFailedTests") == expected_failures
                for failure in failures:
                    rendered = " ".join(failure.get("failureMessages", []))
                    assert any(field in rendered for field in ("errorCode", "closeCode", "retryAfterMs", "status")), rendered
            else:
                assert code == 0 and results.get("numFailedTests") == 0
                assert results.get("numPassedTests", 0) == expected_failures
            receipt["runs"][-1]["regression_expected_result_verified"] = True
            save()
    receipt["status"] = "PASS"
    save()
    print(json.dumps({"component": component, "status": "PASS", "base": base, "head": head}), flush=True)
except Exception as error:
    receipt["status"] = "FAIL"
    receipt["failure"] = str(error)
    save()
    raise
finally:
    for filename in source_files:
        (root / filename).write_bytes(subprocess.check_output(["git", "show", head + ":" + filename]))
