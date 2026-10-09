#!/usr/bin/env python3
"""Add (or remove, with --remove) the TwinGauge hook in ~/.codex/hooks.json.

Always appends at the END of each event list: existing entries keep their position, and Codex trusts
hooks by position (key "hooks.json:<event>:<index>:0" in config.toml). The file is backed up first.
Idempotent: an entry that already runs this hook is not added twice. The entry is recognised by its
command path, which contains codex-hook/hook.py.
"""
import json
import os
import shutil
import sys
import time

EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop",
          "SubagentStop", "SessionEnd"]
WITH_TOOL = {"PreToolUse", "PostToolUse", "PermissionRequest"}
HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hook.py")
COMMAND = f"/usr/bin/python3 -I {HOOK}"
MARKER = "codex-hook/hook.py"


def is_ours(entry):
    return any(MARKER in str(h.get("command", "")) for h in entry.get("hooks", []) if isinstance(h, dict))


def install(conf):
    hooks = conf.setdefault("hooks", {})
    added = []
    for ev in EVENTS:
        items = hooks.setdefault(ev, [])
        if any(is_ours(e) for e in items if isinstance(e, dict)):
            continue
        entry = {"hooks": [{"type": "command", "command": COMMAND, "timeout": 5}]}
        if ev in WITH_TOOL:
            entry = {"matcher": ".*", **entry}
        items.append(entry)
        added.append(f"{ev}:{len(items) - 1}")
    return added


def remove(conf):
    removed = []
    for ev, items in list(conf.get("hooks", {}).items()):
        kept = [e for e in items if not (isinstance(e, dict) and is_ours(e))]
        if len(kept) != len(items):
            removed.append(ev)
            if kept:
                conf["hooks"][ev] = kept
            else:
                del conf["hooks"][ev]
    return removed


def main(argv):
    path = os.path.expanduser("~/.codex/hooks.json")
    conf = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {"hooks": {}}
    removing = "--remove" in argv
    done = remove(conf) if removing else install(conf)
    if not done:
        print("nothing to do")
        return 0
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.before-twingauge-{time.strftime('%Y%m%d-%H%M%S')}")
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as h:
        json.dump(conf, h, ensure_ascii=False, indent=2)
        h.write("\n")
    os.replace(tmp, path)
    print(("removed: " if removing else "added: ") + ", ".join(done))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
