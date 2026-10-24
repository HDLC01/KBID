"""Call the logged-in Claude CLI as a subprocess (no API key).

Pattern copied from the Treadwell tools ([[feedback_mello_no_api_use_cli]]): run
`claude -p` from a clean cwd so the project CLAUDE.md isn't injected, force JSON
output, parse the {"result": ...} envelope, and degrade to "" on any failure.
"""
from __future__ import annotations

import json
import logging
import subprocess
import tempfile

from ..config import get_settings

log = logging.getLogger("kbid.claude")
settings = get_settings()


class ClaudeUnavailable(Exception):
    """Raised when `claude -p` could not be run at all (missing binary, not
    authenticated, timed out) — as opposed to running fine but returning a
    thin/empty result. Callers use this to distinguish "Claude is broken" from
    "Claude legitimately had little to say", instead of both looking identical.
    """


def call_claude(prompt: str, system: str = "", timeout: int = 150) -> str:
    args = [settings.claude_bin, "-p", "--output-format", "json"]
    if settings.claude_model:
        args += ["--model", settings.claude_model]
    if system:
        args += ["--append-system-prompt", system]
    try:
        proc = subprocess.run(
            args,
            input=prompt,
            capture_output=True,
            text=True,
            cwd=tempfile.gettempdir(),  # clean cwd
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
            shell=False,
        )
    except FileNotFoundError as e:
        log.error("claude binary not found (CLAUDE_BIN=%r): %s", settings.claude_bin, e)
        raise ClaudeUnavailable(f"claude binary not found: {e}") from e
    except subprocess.TimeoutExpired as e:
        log.error("claude call timed out after %ss", timeout)
        raise ClaudeUnavailable(f"claude timed out after {timeout}s") from e
    except Exception as e:  # noqa: BLE001
        log.error("claude call failed: %s", e)
        raise ClaudeUnavailable(str(e)) from e

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()[:400]
        log.error("claude exited %s (likely not authenticated): %s", proc.returncode, stderr)
        raise ClaudeUnavailable(f"claude exited {proc.returncode}: {stderr}")

    out = (proc.stdout or "").strip()
    if not out:
        stderr = (proc.stderr or "").strip()[:400]
        log.error("claude returned empty stdout (exit 0). stderr: %s", stderr)
        raise ClaudeUnavailable(f"claude returned empty output: {stderr}")
    try:
        data = json.loads(out)
        if isinstance(data, dict) and "result" in data:
            return str(data["result"]).strip()
    except Exception:
        pass
    return out


def call_claude_json(prompt: str, system: str = "", timeout: int = 150) -> dict:
    return _extract_json(call_claude(prompt, system, timeout))


def _extract_json(txt: str) -> dict:
    if not txt:
        return {}
    t = txt.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    i, j = t.find("{"), t.rfind("}")
    if i >= 0 and j > i:
        try:
            return json.loads(t[i : j + 1])
        except Exception:
            return {}
    return {}
