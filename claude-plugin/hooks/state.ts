// Session state as the plugin writes it and the VS Code extension reads it.
// Pure logic: no call to $, testable on its own. The contract is versioned by `v`.

/** A wait: a question asked to the user (its text, cut) or a permission prompt shown to them (the tool). */
export type Waiting = { kind: 'question' | 'permission'; since: number; tool?: string; text?: string }
/** The current action: the tool and a short label, never a command text or a full path. */
export type Action = { tool: string; label: string; since: number }
export type Agent = {
  id: string
  parentId?: string
  type: string
  description: string
  status: string
  startedAt: number
  tokens: number
  /** The model of its latest response. */
  model?: string
}
export type Limit = { percent: number; resetsAt?: number }
export type SessionState = {
  v: 2
  sessionId: string
  project: string
  cwd: string
  model: string
  state: 'working' | 'waiting' | 'idle' | 'closed'
  waiting: Waiting | null
  action: Action | null
  lastAction?: Action & { until: number }
  context: { tokens?: number; window: number; percent?: number } | null
  costUsd: number | null
  limits: { five_hour?: Limit; seven_day?: Limit }
  /** When the limits were last brought by a model response; the heartbeat does not change it. */
  limitsAt?: number
  /** Five-hour limit readings: [time in ms, percent], two hours at most. */
  limitHistory: [number, number][]
  agents: Agent[]
  day: string
  doneToday: number
  failedToday: number
  /** New tokens per local hour, key "YYYY-MM-DDTHH". */
  hours: Record<string, number>
  /** New tokens today per model, key: model id. */
  models: Record<string, number>
  /** New tokens per hour and per model, for the per-model stacked histogram. */
  hourModels?: Record<string, Record<string, number>>
  /** Input tokens today, including those read from the prompt cache. */
  cache?: { read: number; input: number; created?: number; fresh?: number }
  /** Cache-read tokens per hour and per model, for the fresh / cached histogram. */
  hourCache?: Record<string, Record<string, number>>
  /** Context per category, as /context shows it, estimated locally by the engine. */
  contextCategories?: { name: string; tokens: number; kind: string }[]
  startedAt: number
  lastActivity: number
  updatedAt: number
}

/** Agents that are displayed; other statuses are final. */
export const ACTIVE = new Set(['pending', 'running', 'waiting'])
const FAILURES = new Set(['failed', 'killed'])

export function newState(sessionId: string, cwd: string, model: string, ms: number): SessionState {
  return {
    v: 2,
    sessionId,
    project: projectName(cwd),
    cwd,
    model,
    state: 'idle',
    waiting: null,
    action: null,
    context: null,
    costUsd: null,
    limits: {},
    limitHistory: [],
    agents: [],
    day: localDay(ms),
    doneToday: 0,
    failedToday: 0,
    hours: {},
    models: {},
    startedAt: ms,
    lastActivity: ms,
    updatedAt: ms,
  }
}

const LABEL_MAX = 80
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export function cut(s: string, n = LABEL_MAX): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const baseName = (v: unknown): string => text(v).split('/').filter(s => s !== '').pop() ?? ''

/**
 * The label of an action: the tool name, the short description written by the model, the file
 * name without its path, the cut question. Never a command, a prompt or a full path.
 */
export function actionLabel(tool: string, a: Readonly<Record<string, unknown>>): string {
  if (tool === 'Bash') return cut(text(a.description) === '' ? 'Bash' : `Bash: ${text(a.description)}`)
  if (FILE_TOOLS.has(tool)) {
    const f = baseName(a.file_path ?? a.notebook_path)
    return cut(f === '' ? tool : `${tool}: ${f}`)
  }
  if (tool === 'Agent') return cut(`Agent: ${text(a.description)}`)
  if (tool === 'AskUserQuestion') return cut(`Question: ${questionLabel(a)}`)
  if (tool.startsWith('mcp__')) return cut(`MCP: ${tool.slice(5).replace(/__/g, ' / ')}`)
  return cut(tool)
}

/** The first question asked to the user, cut to 80 characters. */
export function questionLabel(a: Readonly<Record<string, unknown>>): string {
  const q = Array.isArray(a.questions) ? (a.questions[0] as unknown) : undefined
  return cut(typeof q === 'object' && q !== null ? text((q as { question?: unknown }).question) : '')
}

export function projectName(cwd: string): string {
  const parts = cwd.split('/').filter(p => p !== '')
  return parts[parts.length - 1] ?? cwd
}

const two = (n: number): string => String(n).padStart(2, '0')

/** The local date, "YYYY-MM-DD". */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** The local hour, "YYYY-MM-DDTHH". */
export function hourKey(ms: number): string {
  return `${localDay(ms)}T${two(new Date(ms).getHours())}`
}

/** New tokens of a request: input, cache writes and output; cache reads do not count. */
export function newTokens(u: {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
}): number {
  return u.input_tokens + u.output_tokens + u.cache_creation_input_tokens
}

/**
 * A reopened session (VS Code reload, resume) keeps what its file already knows about the day:
 * tokens, models, counts, limits and their history, start time. What belonged to the previous process
 * (action, wait, agents) starts over. Another day resets the daily counters.
 */
export function resumeState(fresh: SessionState, raw: string | undefined, ms: number): SessionState {
  let old: Partial<SessionState> | undefined
  try {
    old = raw === undefined ? undefined : (JSON.parse(raw) as Partial<SessionState>)
  } catch {
    old = undefined
  }
  if (old === undefined || old === null || old.v !== 2 || old.sessionId !== fresh.sessionId) return fresh
  const e: SessionState = {
    ...fresh,
    day: typeof old.day === 'string' ? old.day : fresh.day,
    hours: { ...(old.hours ?? {}) },
    models: { ...(old.models ?? {}) },
    ...(old.cache === undefined ? {} : { cache: { ...old.cache } }),
    ...(old.hourCache === undefined ? {} : { hourCache: { ...old.hourCache } }),
    ...(old.hourModels === undefined ? {} : { hourModels: { ...old.hourModels } }),
    doneToday: old.doneToday ?? 0,
    failedToday: old.failedToday ?? 0,
    limits: { ...(old.limits ?? {}) },
    ...(old.limitsAt === undefined ? {} : { limitsAt: old.limitsAt }),
    limitHistory: [...(old.limitHistory ?? [])],
    startedAt: old.startedAt ?? fresh.startedAt,
    ...(old.lastAction === undefined ? {} : { lastAction: old.lastAction }),
  }
  rollDay(e, ms)
  return e
}

/** The prompt cache: tokens read from the cache, over all inputs of the response. */
export function addCache(
  e: SessionState,
  u: { input_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
  ms?: number,
  model?: string,
): void {
  const read = u.cache_read_input_tokens ?? 0
  const created = u.cache_creation_input_tokens ?? 0
  const fresh = u.input_tokens ?? 0
  const c = e.cache ?? { read: 0, input: 0 }
  e.cache = { read: c.read + read, input: c.input + read + created + fresh, created: (c.created ?? 0) + created, fresh: (c.fresh ?? 0) + fresh }
  if (ms !== undefined && model !== undefined && model !== '' && read > 0) {
    const k = hourKey(ms)
    const h = (e.hourCache ??= {})
    h[k] = { ...(h[k] ?? {}), [model]: (h[k]?.[model] ?? 0) + read }
  }
}

/** On a new day: resets the daily counters and keeps only today's hours. */
export function rollDay(e: SessionState, ms: number): void {
  const d = localDay(ms)
  if (e.day === d) return
  e.day = d
  e.cache = { read: 0, input: 0 }
  e.doneToday = 0
  e.failedToday = 0
  e.models = {}
  for (const k of Object.keys(e.hours)) if (!k.startsWith(d)) delete e.hours[k]
  for (const k of Object.keys(e.hourModels ?? {})) if (!k.startsWith(d)) delete e.hourModels?.[k]
  for (const k of Object.keys(e.hourCache ?? {})) if (!k.startsWith(d)) delete e.hourCache?.[k]
}

export function addTokens(e: SessionState, ms: number, n: number, model?: string): void {
  rollDay(e, ms)
  const k = hourKey(ms)
  e.hours[k] = (e.hours[k] ?? 0) + n
  if (model !== undefined && model !== '') {
    e.models[model] = (e.models[model] ?? 0) + n
    const h = (e.hourModels ??= {})
    h[k] = { ...(h[k] ?? {}), [model]: (h[k]?.[model] ?? 0) + n }
  }
}

/** The engine's limits; `resetsAt` comes in as ISO 8601 and goes out in milliseconds. */
export function readLimits(
  rl: readonly { kind: string; percentUsed: number; resetsAt?: string }[],
): SessionState['limits'] {
  const out: SessionState['limits'] = {}
  for (const w of rl) {
    if (w.kind !== 'five_hour' && w.kind !== 'seven_day') continue
    const r = w.resetsAt === undefined ? Number.NaN : Date.parse(w.resetsAt)
    out[w.kind] = Number.isNaN(r) ? { percent: w.percentUsed } : { percent: w.percentUsed, resetsAt: r }
  }
  return out
}

/** Adds a five-hour limit reading if it moved or after 5 min; keeps two hours. */
export function pushHistory(h: [number, number][], ms: number, pct: number): [number, number][] {
  const last = h[h.length - 1]
  const kept = h.filter(([t]) => ms - t <= 2 * 3600_000)
  if (last === undefined || last[1] !== pct || ms - last[0] >= 300_000) kept.push([ms, pct])
  return kept
}

type ListedAgent = { id: string; parentId?: string; type: string; description: string; status: string }

/**
 * Merges the engine's list with the agents already known. A completed or failed agent
 * is counted once; an agent that vanished without a final status counts as completed.
 */
export function mergeAgents(
  known: readonly Agent[],
  list: readonly ListedAgent[],
  ms: number,
  tokens: Readonly<Record<string, number>>,
  counted: Set<string>,
  models: Readonly<Record<string, string>> = {},
): { agents: Agent[]; done: number; failed: number } {
  let done = 0
  let failed = 0
  const byId = new Map(known.map(a => [a.id, a]))
  const seen = new Set<string>()
  const agents: Agent[] = []
  for (const a of list) {
    seen.add(a.id)
    if (ACTIVE.has(a.status)) {
      agents.push({
        id: a.id,
        ...(a.parentId === undefined ? {} : { parentId: a.parentId }),
        type: a.type,
        description: a.description,
        status: a.status,
        startedAt: byId.get(a.id)?.startedAt ?? ms,
        tokens: tokens[a.id] ?? 0,
        ...(models[a.id] === undefined ? {} : { model: models[a.id] }),
      })
    } else if (!counted.has(a.id) && (byId.has(a.id) || a.status === 'completed' || FAILURES.has(a.status))) {
      counted.add(a.id)
      if (FAILURES.has(a.status)) failed++
      else done++
    }
  }
  for (const a of known) {
    if (!seen.has(a.id) && !counted.has(a.id)) {
      counted.add(a.id)
      done++
    }
  }
  return { agents, done, failed }
}

/** At startup: agents already finished do not count for the current day. */
export function markAlreadyFinished(list: readonly ListedAgent[], counted: Set<string>): void {
  for (const a of list) if (!ACTIVE.has(a.status)) counted.add(a.id)
}

/** A plan limit as the /usage endpoint describes it. No display label: the extension builds it. */
export type PlanLimit = {
  key: string
  kind: string
  percent: number
  severity: string
  resetsAt?: number
  model?: string
  active: boolean
}
/** Plan limits, shared by all sessions: ~/.claude/twingauge/plan.json. */
export type Plan = { v: 2; readAt: number; limits: PlanLimit[]; breakdown: { name: string; percent: number }[]; error?: string }

const object = (x: unknown): Record<string, unknown> | undefined =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined

/** Parses the /usage endpoint response; keeps only the limit list and the per-surface breakdown. */
export function parsePlan(raw: string, ms: number): Plan {
  const j = object(JSON.parse(raw)) ?? {}
  const limits: PlanLimit[] = []
  for (const item of Array.isArray(j.limits) ? j.limits : []) {
    const l = object(item)
    if (l === undefined || typeof l.percent !== 'number') continue
    const name = object(object(object(l.scope)?.model))?.display_name
    const model = typeof name === 'string' && name !== '' ? name : undefined
    const kind = String(l.kind ?? '')
    const resetsAt = typeof l.resets_at === 'string' ? Date.parse(l.resets_at) : Number.NaN
    limits.push({
      key: model === undefined ? kind : `${kind}:${model}`,
      kind,
      percent: l.percent,
      severity: typeof l.severity === 'string' ? l.severity : 'normal',
      ...(Number.isNaN(resetsAt) ? {} : { resetsAt }),
      ...(model === undefined ? {} : { model }),
      active: l.is_active === true,
    })
  }
  const rows = object(j.seven_day_breakdown)?.rows
  const breakdown = (Array.isArray(rows) ? rows : []).flatMap(r => {
    const o = object(r)
    return o !== undefined && typeof o.display_name === 'string' && typeof o.percent === 'number' ? [{ name: o.display_name, percent: o.percent }] : []
  })
  return { v: 2, readAt: ms, limits, breakdown }
}
