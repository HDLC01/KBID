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
    except Exception as e:  # noqa: BLE001
        log.warning("claude call failed: %s", e)
        return ""
    out = (proc.stdout or "").strip()
    if not out:
        log.warning("claude returned empty (stderr: %s)", (proc.stderr or "")[:200])
        return ""
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
