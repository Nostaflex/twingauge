# TwinGauge data contract — v2

Three producers/consumers share plain JSON files. Nothing else crosses between them.

| Writer | File | Reader |
|---|---|---|
| Claude Code plugin (`claude-plugin/`) | `~/.claude/twingauge/sessions/<sessionId>.json` | VS Code extension |
| Claude Code plugin | `~/.claude/twingauge/plan.json` | VS Code extension |
| Codex hook (`codex-hook/`) | `~/.claude/twingauge/codex/<sessionId>.json` | VS Code extension |

Rules for every writer:
- Write atomically: write `<file>.tmp`, then rename over the target.
- Never write prompt text, command text, file contents, full paths outside `cwd`, tokens or credentials.
  `cwd` itself (the project folder's absolute path) is written, locally.
  A question text (AskUserQuestion) is cut to 80 characters; an action label carries the tool name and a short
  detail only (file base name, the model's short Bash description).
- Display wording (labels such as "5-hour window") is NOT written to files: the extension localizes it.
  The only free text in files: `project`, `action.label`, `lastAction.label`, `waiting.text`, `waiting.tool`,
  agent `description`, model ids, limit `model` display names coming from the provider.
- Action labels use the form `Tool: detail` (colon, one space). Prefixes: `Bash: <description>` (Codex: `Shell: <description>`),
  `Edit: <basename>`, `Agent: <description>`, `Question: <text>`, `MCP: <server / tool>`.

## Session file (`v: 2`)

```ts
type Waiting = { kind: 'question' | 'permission'; since: number; tool?: string; text?: string }
type Action = { tool: string; label: string; since: number }
type Agent = { id: string; parentId?: string; type: string; description: string; status: string;
               startedAt: number; tokens: number; model?: string }
type Limit = { percent: number; resetsAt?: number }          // resetsAt in ms since epoch

type SessionState = {
  v: 2
  engine?: 'codex'                                           // absent for Claude Code
  sessionId: string
  project: string                                            // base name of cwd
  cwd: string
  model: string                                              // provider model id, '' if unknown
  state: 'working' | 'waiting' | 'idle' | 'closed'
  waiting: Waiting | null
  action: Action | null
  lastAction?: Action & { until: number }
  context: { tokens?: number; window: number; percent?: number } | null
  costUsd: number | null                                     // API-equivalent cost, Claude only
  limits: { five_hour?: Limit; seven_day?: Limit }
  limitsAt?: number                                          // when the limits above were read from a model response
  limitHistory: [number, number][]                           // [ms, five-hour percent], two hours at most
  agents: Agent[]
  day: string                                                // local YYYY-MM-DD
  doneToday: number
  failedToday: number
  hours: Record<string, number>                              // new tokens per local hour, key YYYY-MM-DDTHH
  models: Record<string, number>                             // new tokens today per model id
  hourModels?: Record<string, Record<string, number>>        // per hour, per model
  cache?: { read: number; input: number; created?: number; fresh?: number }   // input tokens today
  hourCache?: Record<string, Record<string, number>>         // cache-read tokens per hour, per model
  contextCategories?: { name: string; tokens: number; kind: string }[]
  tokens?: { total: number; input: number; output: number; cached: number }   // Codex only
  parentId?: string; nickname?: string; vu?: 'list'          // Codex only (sub-agents, list-only sessions)
  startedAt: number
  lastActivity: number
  updatedAt: number
}
```

Agent `status` values are the engine's own (`pending`, `running`, `waiting`, `completed`, `failed`, `killed`).

## Plan file (`v: 2`)

```ts
type PlanLimit = { key: string; kind: string; percent: number; severity: string; resetsAt?: number;
                   model?: string; active: boolean }
type Plan = { v: 2; readAt: number; limits: PlanLimit[]; breakdown: { name: string; percent: number }[]; error?: string }
```

`kind` is the provider's own (`session` = 5-hour window, `weekly_all`, `weekly_model`, …); `key` is `kind`
or `kind:model`. The extension builds the label from `kind` and `model` in the user's language.

## Versioning

A reader ignores files whose `v` it does not know. A writer resuming a session reads the previous file
only if its `v` matches.
