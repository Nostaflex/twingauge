import type { EngineInterface, Register, Timer } from 'claude-code'

import {
  ACTIVE,
  addTokens,
  mergeAgents,
  newTokens,
  actionLabel,
  questionLabel,
  readLimits,
  parsePlan,
  markAlreadyFinished,
  rollDay,
  newState,
  addCache,
  resumeState,
  pushHistory,
  type Waiting,
  type SessionState,
  type Plan,
} from './state'
import { candidateDirs, newMessages, notificationText, parseMarker, readRegistry, serializeMarker } from './channel'

/** At most one write every 2 s. */
const WRITE_INTERVAL_MS = 2000
const HEARTBEAT_MS = 60_000
const AGENT_POLL_MS = 5000
/** Plan limits are re-read at most every 5 min, across all sessions. */
const PLAN_MS = 5 * 60_000
/** The /usage endpoint; the engine's opaque handle adds the credential, never visible to the plugin. */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

let state: SessionState | undefined
let sessionPath = ''
let planPath = ''
let planInFlight = false
let lastWrite = 0
let pendingWrite: Timer | undefined
let agentPoll: Timer | undefined
let failureReported = false
let channelFailureReported = false
const agentTokens: Record<string, number> = {}
const agentModels: Record<string, string> = {}
const counted = new Set<string>()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await init($, e.cwd)
      $.clock.every(HEARTBEAT_MS, () => {
        void heartbeat($)
      })
    } catch (err) {
      report($, err)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (state !== undefined) {
      state.state = state.waiting === null ? 'working' : 'waiting'
      state.lastActivity = await $.clock.now()
      await schedule($)
    }
    return next(e)
  })

  // Each model request: tokens for the hour and the agent, then context and limits.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      if (state !== undefined && result.usage !== null) {
        const n = newTokens(result.usage)
        addTokens(state, await $.clock.now(), n, result.usage.model)
        addCache(state, result.usage, await $.clock.now(), result.usage.model)
        const model = result.usage.model
        if (e.agentId !== undefined) {
          agentTokens[e.agentId] = (agentTokens[e.agentId] ?? 0) + n
          if (model) agentModels[e.agentId] = model
        } else {
          // The actual model of the response: correct even after a model switch mid-session.
          if (model) state.model = model
          await refreshUsage($, true)
        }
        await schedule($)
      }
    } catch (err) {
      report($, err)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (state !== undefined) {
        if (e.agentId !== undefined) await pollAgents($)
        else {
          // A wait does not outlive the end of the turn: the answer has necessarily arrived.
          state.waiting = null
          state.action = null
          state.state = 'idle'
          state.lastActivity = await $.clock.now()
          await refreshUsage($, true)
          await readCategories($)
          await write($)
        }
      }
    } catch (err) {
      report($, err)
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    try {
      if (state !== undefined) {
        applyUsage(state, e.context, e.rateLimits, e.cost?.usd, await $.clock.now(), true)
        await schedule($)
      }
    } catch (err) {
      report($, err)
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      if (r.deny === undefined) await pollAgents($)
    } catch (err) {
      report($, err)
    }
    return r
  })

  // The current action, never with a command text; a question asked to the user puts the
  // session in a wait. A wait, question or permission, ends with the call.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const main = e.agentId === undefined
    const question = tool === 'AskUserQuestion'
    const args = e as unknown as Readonly<Record<string, unknown>>
    try {
      if (main && state !== undefined) {
        const ms = await $.clock.now()
        state.action = { tool, label: actionLabel(tool, args), since: ms }
        if (question) await startWaiting($, { kind: 'question', since: ms, text: questionLabel(args) })
        else await schedule($)
      }
    } catch (err) {
      report($, err)
    }
    try {
      return await next(e)
    } finally {
      try {
        if (state !== undefined) {
          if (main) {
            if (state.action !== null) state.lastAction = { ...state.action, until: await $.clock.now() }
            state.action = null
          }
          if ((question && main) || state.waiting?.kind === 'permission') await stopWaiting($)
          else if (main) await schedule($)
        }
      } catch (err) {
        report($, err)
      }
    }
  })

  // The real permission prompt shown to the user: observed, never answered.
  // In auto mode the classifier decides without this signal, so no false wait appears.
  on('classic.PermissionRequest', async ($, e, next) => {
    try {
      await startWaiting($, { kind: 'permission', since: await $.clock.now(), tool: e.tool_name })
    } catch (err) {
      report($, err)
    }
    return next(e)
  })

  // Agent channel: new Codex messages are named to the model, main session only.
  on('classic.SessionStart', async ($, e, next) => withChannel($, e, await next(e)))
  on('classic.UserPromptSubmit', async ($, e, next) => withChannel($, e, await next(e)))

  on('session.end', async ($, e, next) => {
    try {
      if (state !== undefined) {
        state.state = 'closed'
        state.waiting = null
        state.action = null
        await write($)
      }
    } catch (err) {
      report($, err)
    }
    return next(e)
  })
}

async function init($: EngineInterface, cwd: string): Promise<void> {
  const id = await $.session.id()
  const root = await $.session.root()
  const home = await homeDir($)
  sessionPath = `${home}/.claude/twingauge/sessions/${id}.json`
  planPath = `${home}/.claude/twingauge/plan.json`
  const ms = await $.clock.now()
  let previous: string | undefined
  try {
    previous = await $.fs.read(sessionPath)
  } catch {
    // No file yet: a new session.
  }
  state = resumeState(newState(id, root === '' ? cwd : root, await $.session.model(), ms), previous, ms)
  markAlreadyFinished(await $.agent.list(), counted)
  await refreshUsage($)
  await write($)
  void refreshPlan($)
}

/** The home folder: HOME, or USERPROFILE when HOME is unset or empty (Windows). */
async function homeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) || ((await $.env.get('USERPROFILE')) ?? '')
}

/**
 * Re-reads the plan limits, including per-model ones, if plan.json is older than 5 min.
 * A failed read is written too, so it is not retried before 5 min.
 */
async function refreshPlan($: EngineInterface): Promise<void> {
  if (planInFlight || planPath === '') return
  planInFlight = true
  try {
    const ms = await $.clock.now()
    let readAt = 0
    try {
      const previous = JSON.parse(await $.fs.read(planPath)) as { readAt?: unknown }
      if (typeof previous.readAt === 'number') readAt = previous.readAt
    } catch {
      // No plan.json yet: read it now.
    }
    if (ms - readAt < PLAN_MS) return
    const handle = await $.session.authorize()
    if (handle === null) return
    const r = await $.http.fetch(USAGE_URL, { auth: handle.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    let plan: Plan
    try {
      plan = r.status === 200 ? parsePlan(r.text, ms) : { v: 2, readAt: ms, limits: [], breakdown: [], error: `HTTP ${r.status}` }
    } catch {
      plan = { v: 2, readAt: ms, limits: [], breakdown: [], error: 'unreadable response' }
    }
    await $.fs.write(planPath, JSON.stringify(plan))
  } catch (err) {
    report($, err)
  } finally {
    planInFlight = false
  }
}

function applyUsage(
  e: SessionState,
  context: { tokens?: number; window: number; percent?: number },
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[],
  usd: number | undefined,
  ms: number,
  fresh: boolean,
): void {
  e.context = { window: context.window, ...(context.tokens === undefined ? {} : { tokens: context.tokens }), ...(context.percent === undefined ? {} : { percent: context.percent }) }
  if (usd !== undefined) e.costUsd = usd
  const limits = readLimits(rateLimits)
  e.limits = { ...e.limits, ...limits }
  // Timestamped only when a model response brings it: at startup the engine may return an old reading.
  if (fresh && (limits.five_hour !== undefined || limits.seven_day !== undefined)) e.limitsAt = ms
  if (limits.five_hour !== undefined) e.limitHistory = pushHistory(e.limitHistory, ms, limits.five_hour.percent)
}

/** Context per category, estimated locally (free, no network call), at the end of each turn. */
async function readCategories($: EngineInterface): Promise<void> {
  if (state === undefined) return
  const u = await $.session.usage({ breakdown: 'summary' })
  const c = u.context.breakdown?.categories
  if (c !== undefined) state.contextCategories = c.filter(x => x.kind !== 'deferred').map(x => ({ name: x.name, tokens: x.tokens, kind: x.kind }))
}

async function refreshUsage($: EngineInterface, fresh = false): Promise<void> {
  if (state === undefined) return
  const u = await $.session.usage()
  applyUsage(state, u.context, u.rateLimits, u.cost?.usd, await $.clock.now(), fresh)
}

async function pollAgents($: EngineInterface): Promise<void> {
  if (state === undefined) return
  const ms = await $.clock.now()
  rollDay(state, ms)
  const r = mergeAgents(state.agents, await $.agent.list(), ms, agentTokens, counted, agentModels)
  state.agents = r.agents
  state.doneToday += r.done
  state.failedToday += r.failed
  const active = r.agents.some(a => ACTIVE.has(a.status))
  if (active && agentPoll === undefined) {
    agentPoll = $.clock.every(AGENT_POLL_MS, () => {
      void pollAgents($)
    })
  } else if (!active && agentPoll !== undefined) {
    agentPoll.cancel()
    agentPoll = undefined
  }
  await schedule($)
}

async function startWaiting($: EngineInterface, w: Waiting): Promise<void> {
  if (state === undefined) return
  state.waiting = w
  state.state = 'waiting'
  await write($)
}

async function stopWaiting($: EngineInterface): Promise<void> {
  if (state === undefined) return
  state.waiting = null
  state.state = 'working'
  state.lastActivity = await $.clock.now()
  await write($)
}

/** Writes now if the last write is 2 s old or more, otherwise once, later. */
async function schedule($: EngineInterface): Promise<void> {
  if (pendingWrite !== undefined) return
  const delay = WRITE_INTERVAL_MS - ((await $.clock.now()) - lastWrite)
  if (delay <= 0) {
    await write($)
    return
  }
  pendingWrite = $.clock.after(delay, () => {
    pendingWrite = undefined
    void write($)
  })
}

async function write($: EngineInterface): Promise<void> {
  if (state === undefined || sessionPath === '') return
  try {
    const ms = await $.clock.now()
    state.updatedAt = ms
    lastWrite = ms
    await $.fs.write(sessionPath, JSON.stringify(state))
  } catch (err) {
    report($, err)
  }
}

async function heartbeat($: EngineInterface): Promise<void> {
  if (state === undefined || state.state === 'closed') return
  const ms = await $.clock.now()
  rollDay(state, ms)
  if (ms - lastWrite >= HEARTBEAT_MS - 5000) await write($)
  await refreshPlan($)
}

/** Adds the channel notification to a hook result; any failure leaves the result unchanged. */
async function withChannel<R extends { additionalContext?: string[] }>($: EngineInterface, e: { cwd: string; agent_id?: string }, r: R): Promise<R> {
  if (e.agent_id !== undefined) return r
  try {
    const text = await channelNotice($, e.cwd)
    return text === null ? r : { ...r, additionalContext: [...(r.additionalContext ?? []), text] }
  } catch (err) {
    if (!channelFailureReported) {
      channelFailureReported = true
      $.ui.log(`twingauge: cannot read the agent channel (${String(err)}). New Codex messages will not be announced.`)
    }
    return r
  }
}

/** Finds the registered channel, names the new Codex messages and moves the marker; null when nothing is new. */
async function channelNotice($: EngineInterface, cwd: string): Promise<string | null> {
  const home = await homeDir($)
  // Only a channel registered on this machine counts: a cloned repository can carry one (docs/CHANNEL.md).
  // The registry holds real paths, like the cwd the engine reports, so a plain string comparison is enough.
  const registryPath = `${home}/.claude/twingauge/channels.json`
  if (home === '' || !(await $.fs.exists(registryPath))) return null
  const registered = readRegistry(await $.fs.read(registryPath))
  for (const dir of candidateDirs(cwd, home)) {
    const channel = `${dir === '/' ? '' : dir}/.twingauge/channel`
    if (!registered.includes(channel)) continue
    if (!(await $.fs.exists(`${channel}/claude`)) || !(await $.fs.exists(`${channel}/codex`))) continue
    // Links are never followed: any link in the channel folder or in .state/ disables the channel, before the
    // marker is read or written. No name is compared: a case-insensitive disk writes .state/ through .STATE.
    if ((await $.fs.list(channel)).some(f => f.isLink)) return null
    if ((await $.fs.exists(`${channel}/.state`)) && (await $.fs.list(`${channel}/.state`)).some(f => f.isLink)) return null
    const markerPath = `${channel}/.state/claude.json`
    let marker: string | undefined
    if (await $.fs.exists(markerPath)) marker = String(await $.fs.read(markerPath))
    const names = (await $.fs.list(`${channel}/codex`)).filter(f => f.kind === 'file' && !f.isLink).map(f => f.name)
    const fresh = newMessages(names, parseMarker(marker))
    if (fresh.length === 0) return null
    // No rename in the API: a single write, which creates .state/ as needed.
    await $.fs.write(markerPath, serializeMarker(fresh[fresh.length - 1] as string))
    return notificationText(fresh, channel)
  }
  return null
}

/** No silent failure: warn once, without breaking the session. */
function report($: EngineInterface, err: unknown): void {
  if (failureReported) return
  failureReported = true
  $.ui.log(`twingauge: cannot write the session state (${String(err)}). The VS Code panel will show missing data.`)
}
