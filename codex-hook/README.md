# TwinGauge Codex hook

On every Codex hook event (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest,
Stop, SubagentStop, SessionEnd), `hook.py` writes the state of the session to
`~/.claude/twingauge/codex/<sessionId>.json`, following the v2 data contract in `docs/CONTRACT.md`.

**What it writes:** state (`working`, `waiting`, `idle`, `closed`), the current action (tool name and a
short label such as `Edit: page.tsx`), a pending permission request, sub-agent and parent ids, token
counters, context window usage and the model id.

**What it never writes:** a prompt, a command text, a reply, file contents or a conversation; no full path
outside `cwd`. The hook only reads the header and the end of **its own** Codex session file, and only to
extract numbers and the model id. It never answers Codex: empty output, exit code 0, even on failure.

## Agent channel

At SessionStart and UserPromptSubmit, if the project has an agent channel (`.twingauge/channel/claude/` and
`codex/`, found from the session's `cwd` upwards, see `docs/CHANNEL.md`), the hook lists the new messages
Claude Code left in `claude/` since its marker `.state/codex.json` and hands Codex one short notice as
`additionalContext` on stdout. It names files only, never reads them, and moves the marker. Nothing is
printed when there is nothing new, for other events, for sub-agent sessions, or on any failure.

## Install

```
python3 -I codex-hook/installer.py
```

Adds one entry per event at the end of each list in `~/.codex/hooks.json`, so existing hooks keep their
position (Codex trusts hooks by position). The previous file is saved as
`hooks.json.before-twingauge-<date>`. Running it twice changes nothing.

## Approve the hooks in Codex

Codex asks you to approve new hooks. Start `codex`, type `/hooks`, and approve the TwinGauge entries.
Until then they do not run.

## Remove

```
python3 -I codex-hook/installer.py --remove
```

## Tests

```
python3 -m unittest discover -s codex-hook -p 'test_*.py'
```

Tests use temporary directories only; they never touch `~/.codex`.
