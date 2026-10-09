// The view model: reads the files written by the Claude Code plugin and the Codex hook (docs/CONTRACT.md)
// and computes everything the panel shows, labels included. No VS Code import: testable with node --test.

import { actionDuration, clock, day, dollars, duration, percent, shortDate, t, tokens, toMinute, dayAndTime } from './i18n'

export type Limit = { percent: number; resetsAt?: number }
export type Agent = { id: string; parentId?: string; type: string; description: string; status: string; startedAt: number; tokens: number; model?: string }
export type Action = { tool: string; label: string; since: number }
export type Engine = 'claude' | 'codex'
export type SessionState = {
  v: number
  /** Absent in Claude files; `codex` in the Codex hook's files. */
  engine?: Engine
  sessionId: string
  project: string
  cwd: string
  model: string
  state: 'working' | 'waiting' | 'idle' | 'closed'
  waiting: { kind: 'question' | 'permission'; since: number; tool?: string; text?: string } | null
  action?: Action | null
  lastAction?: Action & { until: number }
  /** Codex: a sub-agent's parent session and nickname. */
  parentId?: string
  nickname?: string
  /** `list`: a Codex session known only from its thread list, without hook events. Never written to disk. */
  seen?: 'list'
  tokens?: { total: number; input?: number; output?: number; cached?: number }
  context: { tokens?: number; window: number; percent?: number } | null
  costUsd: number | null
  limits: { five_hour?: Limit; seven_day?: Limit }
  /** When the limits above came with a model response. */
  limitsAt?: number
  limitHistory: [number, number][]
  agents: Agent[]
  day: string
  doneToday: number
  failedToday: number
  hours: Record<string, number>
  models?: Record<string, number>
  hourModels?: Record<string, Record<string, number>>
  cache?: { read: number; input: number; created?: number; fresh?: number }
  hourCache?: Record<string, Record<string, number>>
  contextCategories?: { name: string; tokens: number; kind: string }[]
  startedAt: number
  lastActivity: number
  updatedAt: number
}

export type PlanLimit = { key: string; kind: string; percent: number; severity: string; resetsAt?: number; model?: string; active: boolean }
export type Plan = { v: number; readAt: number; limits: PlanLimit[]; breakdown: { name: string; percent: number }[]; error?: string }

/** A Codex limit window, read through its protocol (account/rateLimits/read). */
export type CodexWindow = { label: string; percent: number; resetsAt?: number }
/** `readAt`: last successful reading; `error`: the last attempt failed. */
export type CodexLimit = { readAt: number; windows: CodexWindow[]; plan?: string; error?: string }

export type Tone = 'green' | 'orange' | 'red' | 'grey'
/** An icon id (drawn by the webview) and the theme colour that doubles it: the shape carries the meaning. */
export type Icon = { id: string; color: string }
export type Wait = { id: string; engine: Engine; project: string; text: string; since: number; forMs: number }
/** A limit row: its engine, its sign, its source on hover. */
export type LimitRow = { engine: Engine; name: string; percent: number; tone: Tone; text: string; word: string; source: string; icon: Icon | null; pace?: Pace }
/** The pace of a 7-day limit: share used against share of the window elapsed. */
export type Pace = { elapsed: number; text: string; tone: Tone }
export type View = {
  fiveHour: null | {
    percent: number
    tone: Tone
    icon: Icon | null
    text: string
    resetsAt: number
    startText: string
    resetText: string
    nowX: number
    nowText: string
    points: [number, number][]
    forecast: null | { x: number; text: string; time: string; tone: Tone }
    sentence: string
    source: string
  }
  /** What the panel says when the 5-hour chart has nothing to draw. */
  fiveHourEmpty: string
  cache: null | { percent: number; text: string; read: number; created: number; fresh: number }
  context: null | { project: string; categories: { name: string; tokens: number; kind: string }[]; total: number }
  sevenDay: null | { percent: number; tone: Tone; text: string; resetsAt?: number }
  perModel: { name: string; percent: number; tone: Tone; text: string; word: string; resetsAt?: number }[]
  codex: null | { rows: (CodexWindow & { tone: Tone; text: string })[]; readAt: number; text: string | null }
  limitRows: LimitRow[]
  planText: string
  usage: { name: string; text: string }[]
  waits: Wait[]
  agentsSummary: string
  hours: { label: string; claude: number; codex: number; models: { claude: HourModel[]; codex: HourModel[] }; current: boolean; future: boolean }[]
  today: { text: string; tooltip: string }
  readings: string
  freshness: string
  missing: boolean
}
export type HourModel = { name: string; n: number; read: number }

export const WINDOW_MS = 5 * 3600_000
export const ACTIVE_MS = 15 * 60_000
export const SLOPE_MS = 30 * 60_000
export const WAIT_ALERT_MS = 2 * 60_000
/** A pinned session stays listed for a day without news, instead of 15 minutes. */
export const PIN_MS = 24 * 3600_000
/**
 * A Codex session stays listed as idle for 2 h after its last activity: Codex reports it closed on every
 * VS Code reload although its conversation is still open in its panel.
 */
export const CODEX_IDLE_MS = 2 * 3600_000
/** Beyond this, the Codex limit is reported as stale. */
export const CODEX_STALE_MS = 15 * 60_000
/** A session seen only in the Codex list is running if it moved less than 2 minutes ago. */
export const LIST_RUNNING_MS = 2 * 60_000

export function readState(text: string): SessionState | undefined {
  try {
    const e = JSON.parse(text) as Partial<SessionState>
    return e !== null && e.v === 2 && typeof e.sessionId === 'string' && typeof e.updatedAt === 'number' ? (e as SessionState) : undefined
  } catch {
    return undefined
  }
}

export function engineOf(e: Pick<SessionState, 'engine'>): Engine {
  return e.engine === 'codex' ? 'codex' : 'claude'
}

const two = (n: number): string => String(n).padStart(2, '0')

export function percentTone(p: number): Tone {
  return p >= 90 ? 'red' : p >= 70 ? 'orange' : 'green'
}
/** A limit's icon: none when calm, then warning, flame, and a no-entry sign once reached. */
export function limitIcon(p: number, tone: Tone): Icon | null {
  if (p >= 100) return { id: 'circle-slash', color: 'charts.red' }
  if (tone === 'red') return { id: 'flame', color: 'charts.red' }
  if (tone === 'orange') return { id: 'warning', color: 'charts.orange' }
  return null
}
/** `claude-fable-5-1[1m]` → `Fable 5.1`, `gpt-5.5-codex` → `GPT-5.5 Codex`; any other id is kept as is. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id.replace(/\[.*\]$/, ''))
  if (m === null) {
    const g = /^gpt-([\d.]+)((?:-[a-z0-9]+)*)$/.exec(id)
    if (g === null) return id
    const rest = (g[2] ?? '').split('-').filter(x => x !== '').map(x => `${x.charAt(0).toUpperCase()}${x.slice(1)}`)
    return [`GPT-${g[1] ?? ''}`, ...rest].join(' ')
  }
  const name = m[1] ?? ''
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${m[2]}.${m[3]}`
}

/** Least-squares slope of the last 30 minutes, in percentage points per ms; null without enough readings. */
export function slope(points: readonly [number, number][], now: number): number | null {
  const pts = points.filter(([x]) => now - x <= SLOPE_MS)
  if (pts.length < 2) return null
  const t0 = pts[0]?.[0] ?? 0
  const t1 = pts[pts.length - 1]?.[0] ?? 0
  if (t1 - t0 < 5 * 60_000) return null
  const n = pts.length
  const mx = pts.reduce((s, [x]) => s + x, 0) / n
  const my = pts.reduce((s, [, p]) => s + p, 0) / n
  const num = pts.reduce((s, [x, p]) => s + (x - mx) * (p - my), 0)
  const den = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0)
  return den === 0 ? null : num / den
}

export function readPlan(text: string): Plan | undefined {
  try {
    const p = JSON.parse(text) as Partial<Plan>
    return p !== null && p.v === 2 && typeof p.readAt === 'number' && Array.isArray(p.limits) ? (p as Plan) : undefined
  } catch {
    return undefined
  }
}

const object = (x: unknown): Record<string, unknown> | undefined =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined

function windowLabel(min: unknown): string {
  if (typeof min !== 'number' || min <= 0) return 'Codex'
  if (min % 1440 === 0) return t.windowDays(min / 1440)
  if (min % 60 === 0) return t.windowHours(min / 60)
  return t.windowMinutes(min)
}

/** The answer of account/rateLimits/read: primary and secondary windows; `resetsAt` comes in seconds. */
export function readCodexLimits(result: unknown, now: number): CodexLimit | undefined {
  const rl = object(object(result)?.rateLimits)
  if (rl === undefined) return undefined
  const windows: CodexWindow[] = []
  for (const key of ['primary', 'secondary']) {
    const w = object(rl[key])
    if (w === undefined || typeof w.usedPercent !== 'number') continue
    windows.push({
      label: windowLabel(w.windowDurationMins),
      percent: w.usedPercent,
      ...(typeof w.resetsAt === 'number' ? { resetsAt: w.resetsAt * 1000 } : {}),
    })
  }
  return { readAt: now, windows, ...(typeof rl.planType === 'string' ? { plan: rl.planType } : {}) }
}

/** A Codex thread as its list gives it, without its text: preview and title are dropped on read. */
export type CodexThread = { id: string; parentId?: string; nickname?: string; cwd: string; createdAt: number; updatedAt: number }

/** The answer of thread/list: only ids, folder and times are kept; times come in seconds. */
export function readThreads(result: unknown): CodexThread[] {
  const data = object(result)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((raw): CodexThread[] => {
    const x = object(raw)
    if (x === undefined || typeof x.id !== 'string' || typeof x.updatedAt !== 'number') return []
    return [{
      id: x.id,
      ...(typeof x.parentThreadId === 'string' ? { parentId: x.parentThreadId } : {}),
      ...(typeof x.agentNickname === 'string' ? { nickname: x.agentNickname } : {}),
      cwd: typeof x.cwd === 'string' ? x.cwd : '',
      createdAt: (typeof x.createdAt === 'number' ? x.createdAt : x.updatedAt) * 1000,
      updatedAt: x.updatedAt * 1000,
    }]
  })
}

/**
 * Codex sessions only its thread list knows: we know when they moved, not what they do nor whether they wait
 * for you. A session whose hook already writes a file is not duplicated.
 */
export function statesFromThreads(threads: readonly CodexThread[], known: ReadonlySet<string>, now: number): SessionState[] {
  return threads
    .filter(f => !known.has(f.id))
    .map(f => ({
      v: 2,
      engine: 'codex' as const,
      seen: 'list' as const,
      sessionId: f.id,
      project: f.cwd.split(/[\\/]/).filter(x => x !== '').pop() ?? 'Codex',
      cwd: f.cwd,
      model: '',
      state: now - f.updatedAt < LIST_RUNNING_MS ? ('working' as const) : ('idle' as const),
      waiting: null,
      action: null,
      ...(f.parentId === undefined ? {} : { parentId: f.parentId }),
      ...(f.nickname === undefined ? {} : { nickname: f.nickname }),
      context: null,
      costUsd: null,
      limits: {},
      limitHistory: [],
      agents: [],
      day: day(now),
      doneToday: 0,
      failedToday: 0,
      hours: {},
      startedAt: f.createdAt,
      lastActivity: f.updatedAt,
      updatedAt: f.updatedAt,
    }))
}

const RANK: Record<Tone, number> = { grey: 0, green: 1, orange: 2, red: 3 }
/** The stronger colour between the percentage and the severity the server gives. */
function limitTone(p: number, severity: string): Tone {
  const s: Tone = severity === 'warning' ? 'orange' : severity === 'normal' ? 'green' : 'red'
  const x = percentTone(p)
  return RANK[s] > RANK[x] ? s : x
}

type Reading = { percent: number; resetsAt?: number; readAt: number; fromPlan: boolean }

/**
 * The most recent reading of a Claude limit, across all sessions and the plan reading. A session is dated by
 * its reading, never by its last write: a heartbeat rewrites the file without reading anything. A window whose
 * reset has passed says nothing any more. Resets are rounded to the minute so /usage and the headers agree.
 */
function latestReading(states: readonly SessionState[], plan: Plan | undefined, which: 'five_hour' | 'seven_day', now: number): Reading | undefined {
  const valid = (r: number | undefined): boolean => r === undefined || r > now
  const candidates: Reading[] = []
  for (const e of states) {
    const l = e.limits?.[which]
    if (l === undefined || !valid(l.resetsAt) || (which === 'five_hour' && l.resetsAt === undefined)) continue
    const readAt = e.limitsAt ?? e.limitHistory?.[e.limitHistory.length - 1]?.[0] ?? e.startedAt
    candidates.push({ percent: l.percent, ...(l.resetsAt === undefined ? {} : { resetsAt: toMinute(l.resetsAt) }), readAt, fromPlan: false })
  }
  const p = plan?.error === undefined ? plan?.limits.find(l => l.key === (which === 'five_hour' ? 'session' : 'weekly_all')) : undefined
  if (plan !== undefined && p !== undefined && valid(p.resetsAt) && !(which === 'five_hour' && p.resetsAt === undefined)) {
    candidates.push({ percent: p.percent, ...(p.resetsAt === undefined ? {} : { resetsAt: toMinute(p.resetsAt) }), readAt: plan.readAt, fromPlan: true })
  }
  // On a tie, the session wins: its headers arrive with every response.
  return candidates.sort((a, b) => b.readAt - a.readAt || Number(a.fromPlan) - Number(b.fromPlan))[0]
}

export function buildView(states: readonly SessionState[], now: number, plan?: Plan, codex?: CodexLimit): View {
  const today = day(now)
  const active = states.filter(e => e.state !== 'closed' && now - e.updatedAt <= ACTIVE_MS)
  const recent = [...states].sort((a, b) => b.updatedAt - a.updatedAt)

  // Claude limits are shared by every session of the account: take the most recent reading.
  const r5 = latestReading(states, plan, 'five_hour', now)
  let fiveHour: View['fiveHour'] = null
  if (r5?.resetsAt !== undefined) {
    const resetsAt = r5.resetsAt
    const start = resetsAt - WINDOW_MS
    const seen = new Map<number, number>()
    for (const e of states) for (const [x, p] of e.limitHistory ?? []) if (x >= start && x <= now) seen.set(x, p)
    seen.set(Math.min(r5.readAt, now), r5.percent)
    const points = [...seen.entries()].sort((a, b) => a[0] - b[0])
    const xOf = (x: number): number => Math.min(1, Math.max(0, (x - start) / WINDOW_MS))
    const k = slope(points, now)
    let forecast: NonNullable<View['fiveHour']>['forecast'] = null
    let sentence = t.notEnoughReadings
    if (k !== null) {
      const hit = k > 0 ? now + (100 - r5.percent) / k : Number.POSITIVE_INFINITY
      if (hit < resetsAt) {
        forecast = { x: xOf(hit), text: t.forecastMark(clock(hit)), time: clock(hit), tone: 'orange' }
        sentence = t.forecastPhrase(clock(hit), duration(resetsAt - hit))
      } else {
        sentence = t.holdsPhrase(clock(resetsAt))
      }
    }
    fiveHour = {
      percent: r5.percent,
      tone: percentTone(r5.percent),
      icon: limitIcon(r5.percent, percentTone(r5.percent)),
      text: percent(r5.percent),
      resetsAt,
      startText: clock(start),
      resetText: t.resets(clock(resetsAt)),
      nowX: xOf(now),
      nowText: t.now(percent(r5.percent)),
      points: points.map(([x, p]) => [xOf(x), p]),
      forecast,
      sentence,
      source: `${t.sourceAnthropic(r5.fromPlan, clock(r5.readAt))} ${t.sourceForecast}`,
    }
  }
  const noWindow = plan?.error === undefined && plan?.limits.some(l => l.key === 'session' && l.resetsAt === undefined) === true
  const fiveHourEmpty = noWindow ? t.noWindowOpen : t.limitUnknown
  const r7 = latestReading(states, plan, 'seven_day', now)
  const sevenDay: View['sevenDay'] =
    r7 === undefined
      ? null
      : {
          percent: r7.percent,
          tone: percentTone(r7.percent),
          text: `${percent(r7.percent)}${r7.resetsAt === undefined ? '' : ` · ${shortDate(r7.resetsAt, now)}`}`,
          ...(r7.resetsAt === undefined ? {} : { resetsAt: r7.resetsAt }),
        }

  // Per-model 7-day limits, from the plan. What the account does not have gets no row.
  const perModel = (plan?.limits ?? [])
    .filter(l => l.model !== undefined && (l.resetsAt === undefined || l.resetsAt > now))
    .map(l => ({
      name: l.model ?? '',
      percent: l.percent,
      tone: limitTone(l.percent, l.severity),
      text: `${percent(l.percent)}${l.resetsAt === undefined ? '' : ` · ${shortDate(l.resetsAt, now)}`}`,
      word: l.percent >= 100 ? t.reached : l.severity === 'normal' ? '' : t.warning,
      ...(l.resetsAt === undefined ? {} : { resetsAt: l.resetsAt }),
    }))
  const planText =
    plan === undefined
      ? t.planWaiting
      : plan.error !== undefined
        ? t.planUnavailable(plan.error, duration(now - plan.readAt))
        : perModel.length === 0
          ? t.planNoModelLimit(duration(now - plan.readAt))
          : t.planRead(duration(now - plan.readAt))

  // Codex limits, read through its protocol; stale after 15 minutes without a successful reading.
  const codexView: View['codex'] =
    codex === undefined
      ? null
      : {
          readAt: codex.readAt,
          rows: codex.windows
            .filter(w => w.resetsAt === undefined || w.resetsAt > now)
            .map(w => ({ ...w, tone: percentTone(w.percent), text: `${percent(w.percent)}${w.resetsAt === undefined ? '' : ` · ${shortDate(w.resetsAt, now)}`}` })),
          text:
            codex.error !== undefined && now - codex.readAt > CODEX_STALE_MS
              ? codex.windows.length === 0
                ? t.codexNotRead
                : t.codexStale(duration(now - codex.readAt))
              : null,
        }
  const claudeSource = (x: number | undefined, fromPlan = false): string => t.sourceAnthropic(fromPlan, x === undefined ? undefined : clock(x))
  const resets = new Map<string, number | undefined>()
  const resetOf = (l: { engine: Engine; name: string }): number | undefined => resets.get(`${l.engine}:${l.name}`)
  if (r7?.resetsAt !== undefined) resets.set(`claude:${t.sevenDays}`, r7.resetsAt)
  for (const m of perModel) resets.set(`claude:${m.name}`, m.resetsAt)
  for (const w of codexView?.rows ?? []) resets.set(`codex:${w.label}`, w.resetsAt)
  const limitRows: LimitRow[] = [
    ...(sevenDay === null ? [] : [{ engine: 'claude' as const, name: t.sevenDays, percent: sevenDay.percent, tone: sevenDay.tone, text: sevenDay.text, word: '', source: claudeSource(r7?.readAt, r7?.fromPlan) }]),
    ...perModel.map(m => ({ engine: 'claude' as const, name: m.name, percent: m.percent, tone: m.tone, text: m.text, word: m.word, source: claudeSource(plan?.readAt, true) })),
    ...(codexView === null || codexView.text !== null
      ? []
      : codexView.rows.map(w => ({ engine: 'codex' as const, name: w.label, percent: w.percent, tone: w.tone, text: w.text, word: '', source: t.sourceOpenAI(clock(codexView.readAt)) }))),
  ].map(l => ({ ...l, icon: limitIcon(l.percent, l.tone), ...(resetOf(l) === undefined ? {} : { pace: pace(l.percent, resetOf(l) as number, now) }) }))

  const waits: Wait[] = active
    .filter(e => e.waiting !== null && e.waiting !== undefined)
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map(e => {
      const w = e.waiting as NonNullable<SessionState['waiting']>
      const ago = duration(now - w.since)
      return { id: e.sessionId, engine: engineOf(e), project: e.project, text: w.kind === 'question' ? t.waitingQuestion(ago) : t.waitingPermission(w.tool, ago), since: w.since, forMs: now - w.since }
    })

  const ofToday = states.filter(e => e.day === today)
  const done = ofToday.reduce((s, e) => s + (e.doneToday ?? 0), 0)
  const failed = ofToday.reduce((s, e) => s + (e.failedToday ?? 0), 0)

  const hourNow = new Date(now).getHours()
  const perHour = Array.from({ length: 24 }, (_, h) => states.reduce((s, e) => s + (e.hours?.[`${today}T${two(h)}`] ?? 0), 0))
  // The axis runs from the first active hour to now, with at least 8 columns: never an empty day.
  const first = Math.min(hourNow, ...perHour.map((v, h) => (v > 0 ? h : 24)))
  const last = Math.min(23, Math.max(hourNow, first + 7))
  // Per hour and per model; an hour counted before per-model counting goes to its session's model.
  const modelsAt = (m: Engine, h: number): HourModel[] => {
    const key = `${today}T${two(h)}`
    const fresh = new Map<string, number>()
    const read = new Map<string, number>()
    for (const e of states.filter(x => engineOf(x) === m)) {
      for (const [id, n] of Object.entries(e.hourCache?.[key] ?? {})) read.set(modelName(id), (read.get(modelName(id)) ?? 0) + n)
    }
    for (const e of states.filter(x => engineOf(x) === m)) {
      const total = e.hours?.[key] ?? 0
      let counted = 0
      for (const [id, n] of Object.entries(e.hourModels?.[key] ?? {})) {
        fresh.set(modelName(id), (fresh.get(modelName(id)) ?? 0) + n)
        counted += n
      }
      if (total > counted) {
        const name = e.model === '' ? (m === 'codex' ? 'Codex' : 'Claude') : modelName(e.model)
        fresh.set(name, (fresh.get(name) ?? 0) + total - counted)
      }
    }
    for (const name of read.keys()) if (!fresh.has(name)) fresh.set(name, 0)
    return [...fresh.entries()].map(([name, n]) => ({ name, n, read: read.get(name) ?? 0 })).sort((a, b) => b.n + b.read - (a.n + a.read))
  }
  const ofEngine = (m: Engine, h: number): number =>
    states.filter(e => engineOf(e) === m).reduce((s, e) => s + (e.hours?.[`${today}T${two(h)}`] ?? 0), 0)
  const hours = perHour.slice(first, last + 1).map((_, i) => ({
    label: two(first + i),
    claude: ofEngine('claude', first + i),
    codex: ofEngine('codex', first + i),
    models: { claude: modelsAt('claude', first + i), codex: modelsAt('codex', first + i) },
    current: first + i === hourNow,
    future: first + i > hourNow,
  }))
  const engineTotal = (m: Engine): number =>
    states.filter(e => engineOf(e) === m).reduce((s, e) => s + Object.entries(e.hours ?? {}).filter(([k]) => k.startsWith(today)).reduce((x, [, v]) => x + v, 0), 0)
  const claudeTokens = engineTotal('claude')
  const codexTokens = engineTotal('codex')
  const byName = new Map<string, number>()
  for (const e of ofToday) for (const [id, n] of Object.entries(e.models ?? {})) byName.set(modelName(id), (byName.get(modelName(id)) ?? 0) + n)
  const modelSum = [...byName.values()].reduce((s, v) => s + v, 0)
  const usage = [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, text: `${tokens(n)} · ${percent((n / Math.max(1, modelSum)) * 100)}` }))
  const cost = states.filter(e => engineOf(e) === 'claude' && day(e.updatedAt) === today).reduce((s, e) => s + (e.costUsd ?? 0), 0)
  const todayView = {
    text: codexTokens > 0 ? t.todayBoth(tokens(claudeTokens), tokens(codexTokens)) : t.todayTokens(tokens(claudeTokens)),
    tooltip: t.todayTooltip(dollars(cost)),
  }
  const readingList = [
    r5 !== undefined || r7 !== undefined ? `Anthropic ${clock(Math.max(r5?.readAt ?? 0, r7?.readAt ?? 0))}` : null,
    codexView !== null && codexView.rows.length > 0 ? `OpenAI ${clock(codexView.readAt)}` : null,
  ].filter((x): x is string => x !== null)

  const lastUpdate = recent[0]?.updatedAt
  const missing = active.length === 0 && (lastUpdate === undefined || now - lastUpdate > ACTIVE_MS)
  // Today's prompt cache, Claude sessions: the share of input tokens read from the cache.
  const c = states
    .filter(e => engineOf(e) === 'claude' && e.day === today && e.cache !== undefined)
    .reduce((x, e) => ({ read: x.read + (e.cache?.read ?? 0), input: x.input + (e.cache?.input ?? 0), created: x.created + (e.cache?.created ?? 0), fresh: x.fresh + (e.cache?.fresh ?? 0) }), { read: 0, input: 0, created: 0, fresh: 0 })
  const cache = c.input === 0 ? null : {
    percent: (c.read / c.input) * 100,
    text: t.cacheShare(percent((c.read / c.input) * 100), tokens(c.read), tokens(c.input)),
    read: c.read,
    created: c.created,
    fresh: c.fresh,
  }
  // Context by category of the most recent open Claude session.
  const ctx = recent.find(e => engineOf(e) === 'claude' && e.state !== 'closed' && (e.contextCategories?.length ?? 0) > 0)
  const context = ctx === undefined ? null : {
    project: ctx.project,
    categories: (ctx.contextCategories ?? []).map(x => ({ name: x.name, tokens: x.tokens, kind: x.kind })),
    total: (ctx.contextCategories ?? []).reduce((s, x) => s + x.tokens, 0),
  }
  return {
    fiveHour,
    fiveHourEmpty,
    cache,
    context,
    sevenDay,
    perModel,
    codex: codexView,
    limitRows,
    planText,
    usage,
    waits,
    agentsSummary: t.agentsToday(done, failed),
    hours,
    today: todayView,
    readings: readingList.length === 0 ? '' : t.readings(readingList.join(' · ')),
    freshness:
      lastUpdate === undefined
        ? t.noData
        : missing
          ? t.dataMissing(duration(now - lastUpdate))
          : t.upToDate(Math.max(0, Math.round((now - lastUpdate) / 1000))),
    missing,
  }
}

// ——— The session list, Claude and Codex ———

export type Group = 'waiting' | 'running' | 'unseen' | 'idle'
export const GROUPS: readonly Group[] = ['waiting', 'running', 'unseen', 'idle']
export type AgentRow = { id: string; engine: Engine; label: string; description: string; tooltip: string; running: boolean; icon: Icon; model?: string; children: AgentRow[] }
export type SessionRow = {
  id: string
  engine: Engine
  project: string
  /** The whole line, for tests and screen readers. */
  description: string
  /** The figures (without the model, its chip says it) and what the session does: two lines in the panel. */
  figures: string
  doing: string
  tooltip: string[]
  group: Group
  icon: Icon
  /** The short model name, for its colour shade. */
  model?: string
  pinned: boolean
  hidden: boolean
  agents: AgentRow[]
}
export type Prefs = {
  pinned: ReadonlySet<string>
  hidden: ReadonlySet<string>
  unseen: ReadonlySet<string>
  showHidden: boolean
}
export type Sessions = {
  groups: { group: Group; title: string; rows: SessionRow[] }[]
  waiting: number
  running: number
  unseen: number
  hidden: number
}

function groupOf(e: SessionState, prefs: Prefs): Group {
  if (e.waiting !== null && e.waiting !== undefined) return 'waiting'
  if (e.state === 'working' || e.state === 'waiting') return 'running'
  if (prefs.unseen.has(e.sessionId)) return 'unseen'
  return 'idle'
}

/** One icon per state; `working` stays still, since spinning icons ignore the reduced-motion setting. */
function sessionIcon(e: SessionState, group: Group): Icon {
  if (group === 'waiting') return { id: e.waiting?.kind === 'question' ? 'question' : 'shield', color: 'charts.orange' }
  if (group === 'running') return { id: 'pulse', color: 'charts.green' }
  if (group === 'unseen') return { id: 'done', color: 'charts.blue' }
  return { id: 'idle', color: 'descriptionForeground' }
}

const agentIcon = (running: boolean): Icon => ({ id: 'agent', color: running ? 'charts.green' : 'descriptionForeground' })

/** The start of each row, visible without hovering: model, context, cost (tokens for Codex, no public price). */
function sessionFigures(e: SessionState): string[] {
  const out: string[] = []
  if (e.model !== '') out.push(modelName(e.model))
  if (e.context?.percent !== undefined) out.push(t.context(percent(e.context.percent)))
  if (engineOf(e) === 'codex') {
    if (e.tokens !== undefined && e.tokens.total > 0) out.push(t.tokensCount(tokens(e.tokens.total)))
  } else if (e.costUsd !== null && e.costUsd !== undefined) out.push(t.apiEquivalent(dollars(e.costUsd)))
  return out
}

/** What the session does, last: the longest text, cut first when the panel is narrow. */
function sessionDoing(e: SessionState, group: Group, now: number): string {
  if (e.seen === 'list') return t.listOnly(group === 'idle', duration(now - e.lastActivity))
  if (group === 'waiting') {
    const w = e.waiting
    return t.waitingFor(w?.kind === 'question' ? (w.text !== undefined && w.text !== '' ? w.text : t.question) : t.permission(w?.tool))
  }
  if (group === 'running') {
    const a = e.action
    if (a === null || a === undefined) return t.working
    const d = actionDuration(now - a.since)
    return `${a.label}${d === '' ? '' : ` · ${d}`}`
  }
  if (group === 'unseen') return t.done(e.lastAction?.label)
  return t.idleFor(duration(now - e.lastActivity), e.lastAction?.label)
}

function sessionTooltip(e: SessionState, group: Group, pinned: boolean, now: number): string[] {
  const codex = engineOf(e) === 'codex'
  const l = [`**${e.project}** · ${codex ? 'Codex' : 'Claude'}${e.model === '' ? '' : ` · ${modelName(e.model)}`}`]
  if (e.seen === 'list') {
    l.push(t.tip.listOnly(duration(now - e.lastActivity)), t.tip.noHook, t.tip.openOnly)
    return l
  }
  if (group === 'waiting' && e.waiting) {
    const w = e.waiting
    l.push(t.tip.waitingSince(duration(now - w.since), w.kind === 'question' ? (w.text ?? t.question) : t.permission(w.tool)))
  } else if (group === 'running') {
    l.push(e.action ? t.tip.runningSince(duration(now - e.action.since), e.action.label) : t.working)
  } else {
    l.push(group === 'unseen' ? t.tip.unseenSince(duration(now - e.lastActivity)) : t.tip.idleSince(duration(now - e.lastActivity)))
  }
  if (e.lastAction !== undefined && group !== 'running') l.push(t.tip.lastAction(e.lastAction.label))
  if (e.context?.percent !== undefined) {
    const detail = e.context.tokens === undefined ? '' : t.tip.contextDetail(tokens(e.context.tokens), tokens(e.context.window))
    l.push(t.tip.context(percent(e.context.percent), detail))
  }
  if (codex) {
    if (e.tokens !== undefined) l.push(t.tip.codexTokens(tokens(e.tokens.total)))
  } else if (e.costUsd !== null && e.costUsd !== undefined) {
    l.push(t.tip.cost(dollars(e.costUsd)))
  }
  if (pinned) l.push(t.tip.pinned)
  l.push(t.tip.open)
  return l
}

function claudeAgents(e: SessionState, now: number): AgentRow[] {
  const rows = new Map<string, AgentRow>()
  for (const a of e.agents ?? []) {
    const running = a.status === 'running'
    rows.set(a.id, {
      id: a.id,
      engine: 'claude',
      label: a.description,
      description: `${a.model === undefined ? '' : `${modelName(a.model)} · `}${a.tokens > 0 ? `${tokens(a.tokens)} · ` : ''}${running ? duration(now - a.startedAt) : t.agentWaiting}`,
      tooltip: a.type,
      running,
      icon: agentIcon(running),
      ...(a.model === undefined ? {} : { model: modelName(a.model) }),
      children: [],
    })
  }
  const roots: AgentRow[] = []
  for (const a of e.agents ?? []) {
    const row = rows.get(a.id)
    const parent = a.parentId === undefined ? undefined : rows.get(a.parentId)
    if (row === undefined) continue
    if (parent !== undefined) parent.children.push(row)
    else roots.push(row)
  }
  return roots
}

function codexAgent(e: SessionState, now: number): AgentRow {
  const running = e.state === 'working' || e.state === 'waiting'
  const doing = e.action ? e.action.label : running ? t.working : t.done()
  const tk = e.tokens === undefined || e.tokens.total === 0 ? '' : `${tokens(e.tokens.total)} · `
  return {
    id: e.sessionId,
    engine: 'codex',
    label: e.nickname ?? t.subAgent,
    description: `${e.model === '' ? '' : `${modelName(e.model)} · `}${tk}${doing}${running ? ` · ${duration(now - e.startedAt)}` : ''}`,
    tooltip: `${t.codexSubAgent}${e.model === '' ? '' : ` · ${modelName(e.model)}`}`,
    running,
    icon: agentIcon(running),
    ...(e.model === '' ? {} : { model: modelName(e.model) }),
    children: [],
  }
}

/**
 * The session list: grouped by what needs you, with a stable order inside each group (pinned first, then by
 * project) so rows do not jump. Codex sub-agents sit under their parent. A hidden session comes back by itself
 * when it waits for you.
 */
export function buildSessions(states: readonly SessionState[], now: number, prefs: Prefs): Sessions {
  const alive = (e: SessionState): boolean => {
    const age = now - e.updatedAt
    if (prefs.pinned.has(e.sessionId) && age <= PIN_MS && (e.state !== 'closed' || engineOf(e) === 'codex')) return true
    return engineOf(e) === 'codex' ? age <= CODEX_IDLE_MS : e.state !== 'closed' && age <= ACTIVE_MS
  }
  const living = states.filter(alive)
  const codexParents = new Set(living.filter(e => engineOf(e) === 'codex' && e.parentId === undefined).map(e => e.sessionId))
  const children = new Map<string, SessionState[]>()
  const roots: SessionState[] = []
  for (const e of living) {
    if (engineOf(e) === 'codex' && e.parentId !== undefined && codexParents.has(e.parentId)) {
      children.set(e.parentId, [...(children.get(e.parentId) ?? []), e])
    } else roots.push(e)
  }
  let hidden = 0
  const rows: SessionRow[] = []
  for (const e of roots) {
    const group = groupOf(e, prefs)
    const isHidden = prefs.hidden.has(e.sessionId)
    if (isHidden && group !== 'waiting' && !prefs.showHidden) {
      hidden++
      continue
    }
    const pinned = prefs.pinned.has(e.sessionId)
    const codex = engineOf(e) === 'codex'
    const figures = sessionFigures(e)
    const doing = sessionDoing(e, group, now)
    rows.push({
      id: e.sessionId,
      engine: engineOf(e),
      project: codex && e.parentId !== undefined ? `${e.project} · ${e.nickname ?? t.subAgent}` : e.project,
      description: [...figures, doing].join(' · '),
      figures: figures.filter(x => e.model === '' || x !== modelName(e.model)).join(' · '),
      doing,
      tooltip: sessionTooltip(e, group, pinned, now),
      group,
      icon: sessionIcon(e, group),
      ...(e.model === '' ? {} : { model: modelName(e.model) }),
      pinned,
      hidden: isHidden,
      agents: codex
        ? (children.get(e.sessionId) ?? []).sort((a, b) => a.startedAt - b.startedAt || a.sessionId.localeCompare(b.sessionId)).map(x => codexAgent(x, now))
        : claudeAgents(e, now),
    })
  }
  const order = (a: SessionRow, b: SessionRow): number =>
    Number(b.pinned) - Number(a.pinned) || a.project.localeCompare(b.project) || a.engine.localeCompare(b.engine) || a.id.localeCompare(b.id)
  const groups = GROUPS.map(g => ({ group: g, title: t.groups[g], rows: rows.filter(l => l.group === g).sort(order) }))
  const n = (g: Group): number => groups.find(x => x.group === g)?.rows.length ?? 0
  return { groups, waiting: n('waiting'), running: n('running'), unseen: n('unseen'), hidden }
}

/**
 * "Done, unseen": a session that goes from working to idle while the panel is hidden is marked; the mark goes
 * away as soon as it works, waits or closes again. The extension clears the rest when you look at the panel.
 */
export function updateUnseen(
  unseen: ReadonlySet<string>,
  previous: ReadonlyMap<string, string>,
  states: readonly SessionState[],
  visible: boolean,
): { unseen: Set<string>; previous: Map<string, string> } {
  const u = new Set(unseen)
  const p = new Map<string, string>()
  for (const e of states) {
    const before = previous.get(e.sessionId)
    if (e.state === 'working' || e.state === 'waiting' || e.state === 'closed') u.delete(e.sessionId)
    else if (before === 'working' && e.state === 'idle' && !visible) u.add(e.sessionId)
    p.set(e.sessionId, e.state)
  }
  return { unseen: u, previous: p }
}

// ——— Status bar ———

/** The visible text of a label, without its `$(name)` icons. */
export function visibleText(s: string): string {
  return s.replace(/\$\([a-z0-9~-]+\)\s?/g, '')
}

export const BAR_MAX = 30

/** One item, 30 visible characters at most; the detail is in the tooltip. */
export function barText(v: View, o: { waiting?: number; muted?: boolean } = {}): string {
  const n = o.waiting ?? v.waits.length
  const rank = ['warning', 'flame', 'circle-slash']
  const worst = [v.fiveHour?.icon ?? null, ...v.limitRows.map(l => l.icon)]
    .filter((x): x is Icon => x !== null)
    .sort((a, b) => rank.indexOf(b.id) - rank.indexOf(a.id))[0]
  const icon = o.muted === true ? '$(bell-slash)' : n > 0 ? '$(bell-dot)' : `$(${worst?.id ?? 'dashboard'})`
  if (v.missing && n === 0 && v.codex === null) return `${icon} ${t.bar.noData}`
  const c = v.fiveHour
  const five = c === null ? null : t.bar.five(c.text)
  const fc = c?.forecast ? ` → ≈ ${c.forecast.time}` : ''
  const seven = v.sevenDay === null ? null : t.bar.seven(percent(v.sevenDay.percent))
  const base = five ?? seven ?? t.bar.product
  const candidates =
    n > 0
      ? [`${t.bar.waiting(n)} · ${base}${fc}`, `${t.bar.waiting(n)} · ${base}`, t.bar.waiting(n)]
      : [
          five !== null && seven !== null ? `${base}${fc} · ${seven}` : null,
          `${base}${fc}`,
          five !== null && seven !== null ? `${base} · ${seven}` : null,
          base,
        ].filter((x): x is string => x !== null)
  const choice = candidates.find(x => visibleText(x).length <= BAR_MAX) ?? candidates[candidates.length - 1] ?? base
  return `${icon} ${choice}`
}

/** The status bar tooltip: both engines' limits and the sources. */
export function barTooltip(v: View, o: { waiting: number; running: number; unseen: number; mutedUntil?: number }): string {
  const l = [`**${t.bar.product}**`]
  const c = v.fiveHour
  if (c !== null) l.push(t.barTip.five(`${c.text}${c.forecast ? ` · ${c.forecast.text}` : ''} · ${c.resetText}`))
  if (v.sevenDay !== null) l.push(t.barTip.seven(v.sevenDay.text))
  for (const m of v.perModel) l.push(`${m.name} · ${m.text}${m.word === '' ? '' : ` · ${m.word}`}`)
  if (v.codex !== null) {
    if (v.codex.text !== null) l.push(v.codex.text)
    else for (const w of v.codex.rows) l.push(t.barTip.codex(w.label, w.text))
  }
  l.push(t.barTip.counts(o.waiting, o.running, o.unseen))
  if (v.readings !== '') l.push(`_${v.readings}_`)
  if (o.mutedUntil !== undefined) l.push(t.barTip.muted(clock(o.mutedUntil)))
  return l.join('  \n')
}

export type Alert = { key: string; message: string; severe: boolean; sessionId?: string }

/** Notifications to send: one per threshold and window, one per wait longer than 2 minutes. */
export function alerts(v: View, sent: ReadonlySet<string>): Alert[] {
  const out: Alert[] = []
  const thresholds = (name: string, key: string, p: number, reset: string): void => {
    for (const s of [80, 95]) {
      const k = `${key}-${s}`
      if (p >= s && !sent.has(k)) out.push({ key: k, severe: s === 95, message: t.alert.limit(name, percent(p), reset) })
    }
  }
  if (v.fiveHour !== null) thresholds(t.alert.fiveHours, `5h-${v.fiveHour.resetsAt}`, v.fiveHour.percent, ` (${v.fiveHour.resetText})`)
  if (v.sevenDay !== null) thresholds(t.alert.sevenDays, `7d-${v.sevenDay.resetsAt ?? ''}`, v.sevenDay.percent, '')
  for (const m of v.perModel) thresholds(t.alert.model(m.name), `model-${m.name}-${m.resetsAt ?? ''}`, m.percent, '')
  for (const w of v.codex?.rows ?? []) thresholds(t.alert.codex(w.label), `codex-${w.label}-${w.resetsAt ?? ''}`, w.percent, '')
  for (const s of v.waits) {
    if (s.forMs < WAIT_ALERT_MS) continue
    const k = `wait-${s.id}-${s.since}`
    if (!sent.has(k)) out.push({ key: k, severe: false, sessionId: s.id, message: t.alert.waiting(s.project, `${s.text.charAt(0).toLowerCase()}${s.text.slice(1)}`) })
  }
  return out
}

// ——— Agent channel (docs/CHANNEL.md): a folder with claude/ and codex/ message files, read by file name only ———

export type ChannelMessage = { side: 'claude' | 'codex'; at: number; kind: string; subject: string; name: string }
export type Channel = { forClaude: number; forCodex: number; unanswered: number; latest: (ChannelMessage & { time: string })[]; text: string }

/** `20261008T165324Z-request-review-auth.md`: the time (UTC), the kind, the subject. Other files are ignored. */
export const MESSAGE_NAME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(request|response|ack|info)-([a-z0-9-]{1,60})\.md$/
export function readMessageName(side: 'claude' | 'codex', name: string): ChannelMessage | undefined {
  const m = MESSAGE_NAME.exec(name)
  if (m === null) return undefined
  const at = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)
  return { side, at, kind: m[7]!, subject: m[8]!.replace(/-/g, ' '), name }
}

/**
 * New for an agent: the other side's messages newer than its own latest message. Unanswered: requests that no
 * message from the other side has followed.
 */
export function buildChannel(messages: readonly ChannelMessage[], now: number): Channel {
  const sorted = [...messages].sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
  const lastOf = (side: 'claude' | 'codex'): number => Math.max(0, ...sorted.filter(m => m.side === side).map(m => m.at))
  const forClaude = sorted.filter(m => m.side === 'codex' && m.at > lastOf('claude')).length
  const forCodex = sorted.filter(m => m.side === 'claude' && m.at > lastOf('codex')).length
  const unanswered = sorted.filter(m => m.kind === 'request' && !sorted.some(r => r.side !== m.side && r.at > m.at)).length
  const latest = sorted.slice(-6).reverse().map(m => ({ ...m, time: day(m.at) === day(now) ? clock(m.at) : dayAndTime(m.at, now) }))
  return { forClaude, forCodex, unanswered, latest, text: messages.length === 0 ? t.channelEmpty : t.channelCounts(forClaude, forCodex, unanswered) }
}

const WEEK_MS = 7 * 24 * 3600_000
/**
 * The pace of a 7-day limit: share used against share of the window elapsed. Ahead when usage runs faster
 * than time; then the estimated time the limit is hit if the pace holds (≈).
 */
export function pace(used: number, resetsAt: number, now: number): Pace {
  const elapsed = Math.min(1, Math.max(0, 1 - (resetsAt - now) / WEEK_MS))
  const gap = Math.round(used - elapsed * 100)
  // In the first 5% of the window (about 8 hours) a projection would be noise: none is made.
  if (elapsed < 0.05 || used <= 0) return { elapsed, text: t.pace.early, tone: 'green' }
  const hit = now + ((100 - used) / used) * (elapsed * WEEK_MS)
  if (gap > 0 && hit < resetsAt) return { elapsed, text: t.pace.ahead(gap, shortDate(hit, now)), tone: 'orange' }
  return { elapsed, text: gap > 0 ? t.pace.aheadHolds(gap) : t.pace.onPace(Math.round(elapsed * 100)), tone: 'green' }
}
