"""Tests for the Codex hook: python3 -m unittest discover -s codex-hook -p 'test_*.py' (from the repository root)."""
import json
import os
import shlex
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hook  # noqa: E402
import installer  # noqa: E402

MS = 1_791_400_000_000  # an arbitrary instant in October 2026


def session_fixture(folder, parent=None, total=12_000, last=3_000, window=272_000):
    """A fake Codex session: header, a turn, counters, and text that must never be written."""
    p = os.path.join(folder, "rollout.jsonl")
    meta = {"id": "t1", "cwd": "/w/demo", "originator": "codex_vscode", "cli_version": "0.155.0"}
    if parent:
        meta["parent_thread_id"] = parent
        meta["agent_nickname"] = "reviewer"
    lines = [
        {"timestamp": "x", "type": "session_meta", "payload": meta},
        {"timestamp": "x", "type": "response_item", "payload": {"type": "message", "content": [{"text": "SECRET-PROMPT-123"}]}},
        {"timestamp": "x", "type": "turn_context", "payload": {"model": "gpt-5-codex", "cwd": "/w/demo"}},
        {"timestamp": "x", "type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"total_tokens": total, "input_tokens": total - 2000, "output_tokens": 2000, "cached_input_tokens": 500},
            "last_token_usage": {"total_tokens": last}, "model_context_window": window}, "rate_limits": None}},
        {"timestamp": "x", "type": "response_item", "payload": {"type": "message", "content": [{"text": "SECRET-REPLY-456"}]}},
    ]
    with open(p, "w", encoding="utf-8") as h:
        for line in lines:
            h.write(json.dumps(line) + "\n")
    return p


class CodexHook(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.transcript = session_fixture(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def ev(self, name, **fields):
        base = {"hook_event_name": name, "session_id": "s-codex-1", "cwd": "/w/demo", "transcript_path": self.transcript}
        base.update(fields)
        return base

    def state(self):
        with open(hook.state_path(self.home, "s-codex-1"), encoding="utf-8") as h:
            return json.load(h)

    def test_session_action_permission_stop(self):
        self.assertTrue(hook.handle(self.ev("SessionStart", source="startup"), self.home, MS))
        e = self.state()
        self.assertEqual(e["project"], "demo")
        self.assertEqual(e["v"], 2)
        self.assertEqual(e["state"], "idle")
        self.assertEqual(e["model"], "gpt-5-codex")
        self.assertEqual(e["tokens"]["total"], 12_000)
        self.assertEqual(e["context"], {"window": 272_000, "tokens": 3_000, "percent": 1.1})
        hook.handle(self.ev("UserPromptSubmit", prompt="private text"), self.home, MS + 1000)
        hook.handle(self.ev("PreToolUse", tool_name="shell", tool_input={"command": "rm -rf x", "description": "Clean up"}), self.home, MS + 2000)
        e = self.state()
        self.assertEqual(e["state"], "working")
        self.assertEqual(e["action"], {"tool": "shell", "label": "Shell: Clean up", "since": MS + 2000})
        hook.handle(self.ev("PermissionRequest", tool_name="shell", tool_input={"command": "rm -rf x"}), self.home, MS + 2500)
        e = self.state()
        self.assertEqual(e["state"], "waiting")
        self.assertEqual(e["waiting"], {"kind": "permission", "since": MS + 2500, "tool": "shell"})
        hook.handle(self.ev("PostToolUse", tool_name="shell", tool_input={"command": "rm -rf x"}, tool_response="output"), self.home, MS + 9000)
        e = self.state()
        self.assertIsNone(e["waiting"])
        self.assertIsNone(e["action"])
        self.assertEqual(e["lastAction"]["label"], "Shell: Clean up")
        hook.handle(self.ev("Stop"), self.home, MS + 10_000)
        e = self.state()
        self.assertEqual(e["state"], "idle")
        hook.handle(self.ev("SessionEnd", reason="exit"), self.home, MS + 11_000)
        self.assertEqual(self.state()["state"], "closed")

    def test_subagent_keeps_its_parent(self):
        self.transcript = session_fixture(self.tmp.name, parent="t-parent")
        hook.handle(self.ev("SessionStart", session_id="s-codex-1"), self.home, MS)
        e = self.state()
        self.assertEqual(e["parentId"], "t-parent")
        self.assertEqual(e["nickname"], "reviewer")
        hook.handle(self.ev("SubagentStop", agent_id="s-codex-2"), self.home, MS + 5000)
        self.assertEqual(self.state()["doneToday"], 1)

    def test_no_text_written(self):
        hook.handle(self.ev("SessionStart"), self.home, MS)
        hook.handle(self.ev("UserPromptSubmit", prompt="SECRET-PROMPT-789"), self.home, MS + 1)
        hook.handle(self.ev("PreToolUse", tool_name="shell", tool_input={"command": "curl -H 'Authorization: SECRET-CMD'"}), self.home, MS + 2)
        hook.handle(self.ev("PreToolUse", tool_name="Edit", tool_input={"file_path": "/w/demo/secret-dir/page.tsx"}), self.home, MS + 3)
        hook.handle(self.ev("Stop"), self.home, MS + 4)
        with open(hook.state_path(self.home, "s-codex-1"), encoding="utf-8") as h:
            raw = h.read()
        for forbidden in ("SECRET", "secret-dir", "curl", "rm -rf"):
            self.assertNotIn(forbidden, raw)
        self.assertIn("Edit: page.tsx", raw)

    def test_daily_tokens_per_hour(self):
        hook.handle(self.ev("SessionStart"), self.home, MS)
        self.transcript = session_fixture(self.tmp.name, total=20_000)
        hook.handle(self.ev("Stop"), self.home, MS + 60_000)
        e = self.state()
        self.assertEqual(e["tokens"]["total"], 20_000)
        self.assertEqual(sum(e["hours"].values()), 8_000)
        self.assertEqual(e["models"], {"gpt-5-codex": 8_000})

    def test_unreadable_input_or_missing_session(self):
        self.assertIsNone(hook.handle("pas un objet", self.home, MS))
        self.assertIsNone(hook.handle({"hook_event_name": "Stop"}, self.home, MS))
        self.assertIsNone(hook.handle(self.ev("Stop", session_id="../x"), self.home, MS))
        ok = hook.handle(self.ev("Stop", transcript_path="/nulle/part.jsonl"), self.home, MS)
        self.assertTrue(ok)
        self.assertEqual(self.state()["tokens"]["total"], 0)
        self.assertIsNone(hook.handle(self.ev("PreCompact"), self.home, MS))

    def test_labels(self):
        self.assertEqual(hook.action_label("shell", {"command": "ls", "description": "List"}), "Shell: List")
        self.assertEqual(hook.action_label("shell", {"command": "ls"}), "Shell")
        self.assertEqual(hook.action_label("apply_patch", {"path": "/a/b/c.py"}), "apply_patch: c.py")
        self.assertEqual(hook.action_label("mcp__github__search", {}), "MCP: github / search")
        self.assertEqual(len(hook.action_label("shell", {"description": "x" * 300})), 80)


class Channel(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.registry_file = os.path.join(self.home, ".claude", "twingauge", "channels.json")
        self.proj = os.path.join(self.home, "work", "demo")
        self.ch = os.path.join(self.proj, ".twingauge", "channel")
        for d in ("claude", "codex"):
            os.makedirs(os.path.join(self.ch, d))
        self.sub = os.path.join(self.proj, "src")
        os.makedirs(self.sub)
        self.register(self.ch)  # a channel counts only when it is registered on the machine

    def tearDown(self):
        self.tmp.cleanup()

    def registry(self, content):
        """Write the registry of the machine verbatim (text or bytes)."""
        os.makedirs(os.path.dirname(self.registry_file), exist_ok=True)
        with open(self.registry_file, "wb") as h:
            h.write(content if isinstance(content, bytes) else content.encode("utf-8"))

    def register(self, *paths):
        self.registry(json.dumps({"v": 1, "channels": list(paths)}))

    def put(self, *names):
        for n in names:
            open(os.path.join(self.ch, "claude", n), "w").close()

    def ev(self, name="UserPromptSubmit", **f):
        return dict({"hook_event_name": name, "session_id": "s", "cwd": self.sub}, **f)

    def marker(self):
        with open(os.path.join(self.ch, ".state", "codex.json"), encoding="utf-8") as h:
            return json.load(h)

    A = "20261008T165324Z-request-review-auth.md"
    B = "20261008T170102Z-info-tests-green.md"

    def test_new_messages_notified_once(self):
        self.put(self.A, self.B)
        out = json.loads(hook.channel_output(self.ev(), self.home))
        o = out["hookSpecificOutput"]
        self.assertEqual(o["hookEventName"], "UserPromptSubmit")
        real = os.path.realpath(self.ch)  # the text carries the real path, as the engine reports cwd
        self.assertIn(f"2 new messages from Claude Code in {real}/claude/", o["additionalContext"])
        self.assertIn(f"{self.A}, {self.B}", o["additionalContext"])
        self.assertIn(f"Reply in {real}/codex/", o["additionalContext"])
        self.assertIn(f"Protocol: {real}/README.md.", o["additionalContext"])
        self.assertIn("Never edit Claude Code's files", o["additionalContext"])
        self.assertEqual(self.marker(), {"notifiedUpTo": self.B})
        self.assertIsNone(hook.channel_output(self.ev(), self.home))
        self.put("20261008T180000Z-ack-seen.md")
        again = json.loads(hook.channel_output(self.ev("SessionStart"), self.home))
        self.assertIn("1 new message from", again["hookSpecificOutput"]["additionalContext"])
        self.assertNotIn(self.A, again["hookSpecificOutput"]["additionalContext"])

    def test_invalid_names_ignored(self):
        self.put("notes.md", "20261008T165324Z-bogus-x.md", "20261008T165324Z-info-Upper.md", "20261008T165324Z-info-x.txt")
        self.assertIsNone(hook.channel_output(self.ev(), self.home))
        self.assertFalse(os.path.exists(os.path.join(self.ch, ".state")))

    def test_no_channel_and_other_events(self):
        self.put(self.A)
        self.assertIsNone(hook.channel_output(self.ev(cwd=self.tmp.name), self.home))
        for name in ("Stop", "PreToolUse", "PostToolUse", "SessionEnd"):
            self.assertIsNone(hook.channel_output(self.ev(name), self.home))
        self.assertFalse(os.path.exists(os.path.join(self.ch, ".state")))

    def test_broken_marker_is_no_marker(self):
        self.put(self.A)
        os.makedirs(os.path.join(self.ch, ".state"))
        with open(os.path.join(self.ch, ".state", "codex.json"), "w") as h:
            h.write("{not json")
        self.assertIsNotNone(hook.channel_output(self.ev(), self.home))
        self.assertEqual(self.marker(), {"notifiedUpTo": self.A})

    def test_more_than_ten_and_subagent(self):
        self.put(*[f"20261008T1700{i:02d}Z-info-m{i}.md" for i in range(12)])
        text = json.loads(hook.channel_output(self.ev(), self.home))["hookSpecificOutput"]["additionalContext"]
        self.assertIn("12 new messages", text)
        self.assertIn("and 2 more", text)
        self.assertNotIn("m11.md", text)
        self.put("20261008T190000Z-info-later.md")
        sub = session_fixture(self.tmp.name, parent="t-parent")
        self.assertIsNone(hook.channel_output(self.ev(transcript_path=sub), self.home))
        self.assertEqual(self.marker()["notifiedUpTo"], "20261008T170011Z-info-m11.md")

    def test_unregistered_channel_is_ignored(self):
        self.put(self.A)
        cases = {
            "other folder": [os.path.join(self.tmp.name, "other", ".twingauge", "channel")],
            "parent folders only": [self.proj, os.path.join(self.proj, ".twingauge")],
            "longer name": [self.ch + "-copy"],
            "empty list": [],
        }
        for label, paths in cases.items():
            with self.subTest(label):
                self.register(*paths)
                self.assertIsNone(hook.channel_output(self.ev(), self.home))
        with self.subTest("no registry file"):
            os.remove(self.registry_file)
            self.assertIsNone(hook.channel_output(self.ev(), self.home))
        self.assertFalse(os.path.exists(os.path.join(self.ch, ".state")))

    def test_registered_path_matches_after_normpath(self):
        spellings = [
            self.ch + "/",
            os.path.join(self.sub, "..", ".twingauge", "channel"),
            self.proj + "//.twingauge/./channel",
        ]
        for i, spelling in enumerate(spellings):
            with self.subTest(spelling):
                self.register(42, None, spelling)  # entries that are not strings are skipped
                self.put(f"20261009T00000{i}Z-info-n{i}.md")
                out = hook.channel_output(self.ev(), self.home)
                self.assertIsNotNone(out)
                self.assertIn(f"n{i}.md", json.loads(out)["hookSpecificOutput"]["additionalContext"])

    def test_unregistered_nearer_channel_does_not_hide_the_registered_one(self):
        near = os.path.join(self.sub, ".twingauge", "channel")  # for example committed in a cloned sub-folder
        for d in ("claude", "codex"):
            os.makedirs(os.path.join(near, d))
        open(os.path.join(near, "claude", self.B), "w").close()
        self.put(self.A)
        text = json.loads(hook.channel_output(self.ev(), self.home))["hookSpecificOutput"]["additionalContext"]
        self.assertIn(self.A, text)
        self.assertNotIn(self.B, text)
        self.assertFalse(os.path.exists(os.path.join(near, ".state")))

    def test_garbage_registry_means_no_channel(self):
        self.put(self.A)
        garbage = [
            "", "{not json", "null", "[]", json.dumps([self.ch]), "{}", '{"v": 1}',
            json.dumps({"v": 1, "channels": self.ch}),  # a string, not a list
            json.dumps({"v": 1, "channels": {self.ch: True}}),  # an object (iterating it gives its keys), not a list
            json.dumps({"v": 1, "channels": [1, None, [self.ch], {"p": self.ch}]}),  # no string entry
            b"\xff\xfe\x00 not utf-8",
            "[" * 100_000,  # nested deeper than the parser allows
        ]
        for content in garbage:
            with self.subTest(repr(content[:40])):
                self.registry(content)
                self.assertIsNone(hook.channel_output(self.ev(), self.home))
        with self.subTest("unreadable"):
            os.remove(self.registry_file)
            os.makedirs(self.registry_file)  # a folder where the file should be
            self.assertIsNone(hook.channel_output(self.ev(), self.home))
        self.assertFalse(os.path.exists(os.path.join(self.ch, ".state")))

    def test_linked_or_non_regular_messages_are_skipped(self):
        outside = os.path.join(self.tmp.name, "outside.md")
        open(outside, "w").close()
        dangling = "20261008T170200Z-info-dangling.md"
        folder = "20261008T170300Z-info-folder.md"
        self.put(self.A)
        os.symlink(outside, os.path.join(self.ch, "claude", self.B))
        os.symlink(os.path.join(self.tmp.name, "missing.md"), os.path.join(self.ch, "claude", dangling))
        os.mkdir(os.path.join(self.ch, "claude", folder))
        text = json.loads(hook.channel_output(self.ev(), self.home))["hookSpecificOutput"]["additionalContext"]
        self.assertIn("1 new message from", text)
        self.assertIn(self.A, text)
        for skipped in (self.B, dangling, folder):
            self.assertNotIn(skipped, text)
        self.assertEqual(self.marker(), {"notifiedUpTo": self.A})

    def test_linked_state_folder_disables_the_channel(self):
        self.put(self.A)
        elsewhere = os.path.join(self.tmp.name, "elsewhere")
        os.makedirs(elsewhere)
        os.symlink(elsewhere, os.path.join(self.ch, ".state"))
        self.assertIsNone(hook.channel_output(self.ev(), self.home))
        self.assertEqual(os.listdir(elsewhere), [])  # nothing written through the link

    def test_linked_marker_disables_the_channel(self):
        self.put(self.A)
        os.makedirs(os.path.join(self.ch, ".state"))
        target = os.path.join(self.tmp.name, "target.json")
        with open(target, "w", encoding="utf-8") as h:
            h.write('{"notifiedUpTo": ""}')
        link = os.path.join(self.ch, ".state", "codex.json")
        os.symlink(target, link)
        self.assertIsNone(hook.channel_output(self.ev(), self.home))
        self.assertTrue(os.path.islink(link))  # neither replaced nor written through
        with open(target, encoding="utf-8") as h:
            self.assertEqual(h.read(), '{"notifiedUpTo": ""}')

    def test_any_link_in_the_channel_disables_it(self):
        # Names are not compared: on a case-insensitive disk a link named .STATE would catch the .state write.
        self.put(self.A)
        elsewhere = os.path.join(self.tmp.name, "elsewhere")
        os.makedirs(elsewhere)
        os.symlink(elsewhere, os.path.join(self.ch, ".STATE"))
        self.assertIsNone(hook.channel_output(self.ev(), self.home))
        self.assertEqual(os.listdir(elsewhere), [])
        self.assertFalse(os.path.exists(os.path.join(self.ch, ".state", "codex.json")))


class Installer(unittest.TestCase):
    def test_append_at_end_idempotent_and_remove(self):
        other = {"hooks": [{"type": "command", "command": "echo other"}]}
        conf = {"hooks": {"Stop": [other]}}
        installer.install(conf)
        self.assertEqual(conf["hooks"]["Stop"][0], other)
        self.assertIn("codex-hook/hook.py", conf["hooks"]["Stop"][1]["hooks"][0]["command"])
        self.assertEqual(installer.install(conf), [])
        installer.remove(conf)
        self.assertEqual(conf["hooks"], {"Stop": [other]})

    def test_stale_command_is_refreshed_in_place(self):
        stale = {"hooks": [{"type": "command", "command": "/usr/bin/python3 -I /old path/codex-hook/hook.py", "timeout": 5}]}
        conf = {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo other"}]}, stale]}}
        expected = [f"{ev}:0" if ev != "Stop" else "Stop:1 (command updated)" for ev in installer.EVENTS]
        self.assertEqual(installer.install(conf), expected)
        self.assertEqual(conf["hooks"]["Stop"][1]["hooks"][0]["command"], installer.COMMAND)  # same position

    def test_command_is_quoted(self):
        py, path = "/opt/My Python/bin/python3", "/home/me/My Projects/twingauge/codex-hook/hook.py"
        cmd = installer.command(py, path)
        self.assertEqual(shlex.split(cmd), [py, "-I", path])
        conf = {}
        with mock.patch.object(installer, "COMMAND", cmd):
            installer.install(conf)
            entry = conf["hooks"]["Stop"][0]
            self.assertEqual(shlex.split(entry["hooks"][0]["command"]), [py, "-I", path])
            self.assertTrue(installer.is_ours(entry))
            self.assertEqual(installer.install(conf), [])  # idempotent while the command is unchanged
        installer.remove(conf)
        self.assertEqual(conf["hooks"], {})
        # an entry written by the previous version (unquoted) is still recognised
        self.assertTrue(installer.is_ours({"hooks": [{"command": f"/usr/bin/python3 -I {path}"}]}))
        # the real command of this clone: the interpreter that runs the installer, then the hook, both intact
        self.assertEqual(shlex.split(installer.COMMAND), [sys.executable or "python3", "-I", installer.HOOK])


if __name__ == "__main__":
    unittest.main()
