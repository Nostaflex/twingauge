import type { AgentInfo, On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

const START = new Date(2026, 9, 7, 10, 0).getTime()
const FILE = '/h/.claude/twingauge/sessions/s1.json'
const PLAN = '/h/.claude/twingauge/plan.json'
/** Excerpt of a real /usage endpoint response. */
const USAGE = JSON.stringify({
  five_hour: { utilization: 2.0, resets_at: '2026-10-07T22:30:00+00:00' },
  limits: [
    { kind: 'session', group: 'session', percent: 2, severity: 'normal', resets_at: '2026-10-07T22:30:00+00:00', scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 45, severity: 'normal', resets_at: '2026-10-07T22:00:00+00:00', scope: null, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 75, severity: 'warning', resets_at: '2026-10-07T22:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: true },
  ],
  seven_day_breakdown: { rows: [{ key: 'claude_code', display_name: 'Claude Code', percent: 100 }, { key: 'chat', display_name: 'Chats', percent: 0 }] },
})

/** The world under the plugin: one session, an in-memory disk, configurable tools. */
function world(on: On) {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/h' })
  const m = {
    clock,
    writes: [] as { path: string; state: Record<string, unknown> }[],
    agents: [] as AgentInfo[],
    percent: 30,
    diskFailure: false,
    log: [] as string[],
    decision: 'allow' as 'allow' | 'ask' | 'deny',
    release: () => {},
    hold: false,
    disk: {} as Record<string, string>,
    calls: [] as string[],
    status: 200,
    handle: { handle: 'opaque-handle', kind: 'bearer' } as { handle: string; kind: 'bearer' } | null,
    model: 'claude-fable-5-1',
  }
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/w/demo' }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: START,
      context: { tokens: 370_000, window: 1_000_000, percent: 37 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: m.percent, resetsAt: '2026-10-07T12:40:00.000Z' },
        { kind: 'seven_day', percentUsed: 18 },
      ],
      cost: { usd: 3.12 },
      ...(e.breakdown === undefined ? {} : { context: { tokens: 370_000, window: 1_000_000, percent: 37, breakdown: { categories: [
        { name: 'System prompt', tokens: 20_000, color: 'x', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 350_000, color: 'x', isDeferred: false, kind: 'used' },
        { name: 'MCP tools', tokens: 9_000, color: 'x', isDeferred: true, kind: 'deferred' },
        { name: 'Free space', tokens: 630_000, color: 'x', isDeferred: false, kind: 'free' },
      ] } as never } }),
    },
  }))
  on('agent.list', () => ({ value: m.agents }))
  on('fs.write', ($, e) => {
    if (m.diskFailure) return { deny: 'disk full' }
    m.writes.push({ path: e.path, state: JSON.parse(e.text) as Record<string, unknown> })
    m.disk[e.path] = e.text
    return { value: undefined }
  })
  on('fs.read', ($, e) => (m.disk[e.path] === undefined ? { deny: 'missing' } : { value: m.disk[e.path] as string }))
  on('session.authorize', () => ({ value: m.handle }))
  on('http.fetch', ($, e) => {
    m.calls.push(JSON.stringify(e))
    return { value: { status: m.status, ok: m.status === 200, headers: {}, text: m.status === 200 ? USAGE : 'no' } }
  })
  on('ui.log', ($, e) => {
    m.log.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 2000, model: m.model },
    }
  })
  on('tool.check', () => ({ decision: m.decision }))
  on('tool.call', { tool: 'AskUserQuestion' }, () =>
    new Promise(r => {
      m.release = () => r({ result: { questions: [], answers: {} } })
    }),
  )
  on('tool.call', async () => {
    if (m.hold) await new Promise<void>(r => (m.release = r))
    return { result: 'ok' }
  })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // The bottom of the permission chain: the native prompt, not the plugin.
  on('classic.PermissionRequest', () => ({}))
  return m
}

const sessionWrites = (m: ReturnType<typeof world>) => m.writes.filter(w => w.path === FILE)
const last = (m: ReturnType<typeof world>) => sessionWrites(m).at(-1)?.state ?? {}
const plan = (m: ReturnType<typeof world>) => m.writes.filter(w => w.path === PLAN).at(-1)?.state

async function open($: Engine): Promise<void> {
  await $.session.start({ cwd: '/w/demo', surface: null, isInteractive: true })
}

async function step($: Engine, agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
  let s = await stream.next()
  while (s.done !== true) s = await stream.next()
}

test('on startup, the session file carries project, model, context and limits', async ($, on) => {
  const m = world(on)
  await open($)
  const e = last(m)
  expect(m.writes[0]?.path).toBe(FILE)
  expect(e.v).toBe(2)
  expect(e.project).toBe('demo')
  expect(e.model).toBe('claude-fable-5-1')
  expect(e.context).toEqual({ window: 1_000_000, tokens: 370_000, percent: 37 })
  expect(e.costUsd).toBe(3.12)
  expect((e.limits as { five_hour: { percent: number } }).five_hour.percent).toBe(30)
})

test('after a request, at most one write every 2 s, with the hour tokens', async ($, on) => {
  const m = world(on)
  await open($)
  await m.clock.advance(10)
  const before = sessionWrites(m).length
  await step($)
  await step($)
  await step($)
  expect(sessionWrites(m).length).toBe(before)
  await m.clock.advance(2000)
  expect(sessionWrites(m).length).toBe(before + 1)
  expect(last(m).hours).toEqual({ '2026-10-07T10': 3 * 3500 })
})

test('an open question puts the session in a wait, the answer releases it', async ($, on) => {
  const m = world(on)
  await open($)
  const call = $.tool.call({ tool: 'AskUserQuestion', questions: [], tool_use_id: 'q1' } as never)
  await m.clock.advance(10)
  expect(last(m).state).toBe('waiting')
  expect((last(m).waiting as { kind: string }).kind).toBe('question')
  expect((last(m).action as { label: string }).label).toBe('Question: ')
  m.release()
  await call
  expect(last(m).waiting).toBeNull()
})

test('in auto mode, a long command decided by the classifier never creates a wait', async ($, on) => {
  const m = world(on)
  await open($)
  m.decision = 'ask'
  m.hold = true
  await $.tool.check({ tool: 'Bash', input: { command: 'sleep 30' }, tool_use_id: 'p1' })
  const call = $.tool.call({ tool: 'Bash', command: 'sleep 30', description: 'Wait', tool_use_id: 'p1' } as never)
  await m.clock.advance(30_000)
  expect(sessionWrites(m).every(w => w.state.waiting === null)).toBe(true)
  m.release()
  await call
  expect(sessionWrites(m).every(w => w.state.waiting === null)).toBe(true)
})

test('a real permission request puts the session in a wait within 2 s, unanswered by the plugin; the end of the call clears it', async ($, on) => {
  const m = world(on)
  await open($)
  m.hold = true
  const call = $.tool.call({ tool: 'Bash', command: 'rm x', tool_use_id: 'p2' } as never)
  await m.clock.advance(100)
  const r = await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm x' } })
  expect((r as { decision?: unknown }).decision).toBeUndefined()
  await m.clock.advance(100)
  const w = last(m).waiting as { kind: string; tool: string; since: number }
  expect(w.kind).toBe('permission')
  expect(w.tool).toBe('Bash')
  expect(last(m).state).toBe('waiting')
  m.release()
  await call
  expect(last(m).waiting).toBeNull()
  expect(last(m).state).toBe('working')
})

test('the current action shows with its label; a command holding a secret leaves no trace', async ($, on) => {
  const m = world(on)
  await open($)
  await m.clock.advance(3000)
  m.hold = true
  const call = $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer SECRET-XYZ"', description: 'Run the tests', tool_use_id: 'p3' } as never)
  await m.clock.advance(100)
  expect(last(m).action).toEqual({ tool: 'Bash', label: 'Bash: Run the tests', since: START + 3000 })
  m.release()
  await call
  await m.clock.advance(3000)
  expect(last(m).action).toBeNull()
  expect((last(m).lastAction as { label: string }).label).toBe('Bash: Run the tests')
  expect(m.writes.some(w => JSON.stringify(w.state).includes('SECRET-XYZ'))).toBe(false)
  m.hold = false
  await $.tool.call({ tool: 'Edit', file_path: '/w/demo/src/secret-dir/page.tsx', old_string: 'a', new_string: 'b', tool_use_id: 'p4' } as never)
  await m.clock.advance(3000)
  expect((last(m).lastAction as { label: string }).label).toBe('Edit: page.tsx')
  expect(m.writes.some(w => JSON.stringify(w.state).includes('secret-dir'))).toBe(false)
})

test('a spawned agent shows with its parent; once completed, it leaves and is counted', async ($, on) => {
  const m = world(on)
  await open($)
  m.agents = [
    { id: 'a1', type: 'general-purpose', description: 'Review parser', status: 'running' },
    { id: 'a2', parentId: 'a1', type: 'Explore', description: 'Find callers', status: 'running' },
  ]
  await $.agent.spawn({ prompt: 'p', description: 'Review parser', subagentType: 'general-purpose' } as never)
  await step($, 'a1')
  await m.clock.advance(2000)
  const agents = last(m).agents as { id: string; parentId?: string; tokens: number }[]
  expect(agents.map(a => a.id)).toEqual(['a1', 'a2'])
  expect(agents[1]?.parentId).toBe('a1')
  m.agents = [
    { id: 'a1', type: 'general-purpose', description: 'Review parser', status: 'completed' },
    { id: 'a2', parentId: 'a1', type: 'Explore', description: 'Find callers', status: 'completed' },
  ]
  await m.clock.advance(5000)
  await m.clock.advance(2000)
  expect(last(m).agents).toEqual([])
  expect(last(m).doneToday).toBe(2)
})

test('session end is written', async ($, on) => {
  const m = world(on)
  await open($)
  await $.session.end({ reason: 'exit', sessionId: 's1' } as never)
  expect(last(m).state).toBe('closed')
})

test('disk failure: the request completes and the failure is reported once', async ($, on) => {
  const m = world(on)
  await open($)
  m.diskFailure = true
  await m.clock.advance(3000)
  await step($)
  await step($)
  await m.clock.advance(3000)
  await step($)
  expect(m.log.length).toBe(1)
  expect(m.log[0]).toContain('twingauge')
})

test('tokens today per model', async ($, on) => {
  const m = world(on)
  await open($)
  await step($)
  await m.clock.advance(2000)
  expect(last(m).models).toEqual({ 'claude-fable-5-1': 3500 })
})

test('plan: on startup, one read through the opaque handle, plan.json written with the per-model limit', async ($, on) => {
  const m = world(on)
  await open($)
  await m.clock.advance(10)
  expect(m.calls.length).toBe(1)
  expect(m.calls[0]).toContain('https://api.anthropic.com/api/oauth/usage')
  expect(m.calls[0]).toContain('opaque-handle')
  expect(m.calls[0]).toContain('oauth-2025-04-20')
  const p = plan(m) as { v: number; limits: Record<string, unknown>[]; breakdown: unknown[] }
  expect(p.v).toBe(2)
  expect(p.limits.map(l => l.key)).toEqual(['session', 'weekly_all', 'weekly_scoped:Fable'])
  expect(p.limits.map(l => l.kind)).toEqual(['session', 'weekly_all', 'weekly_scoped'])
  expect(p.limits.some(l => 'label' in l)).toBe(false)
  expect(p.limits[2]).toMatchObject({ percent: 75, severity: 'warning', model: 'Fable', active: true })
  expect(p.breakdown).toEqual([{ name: 'Claude Code', percent: 100 }, { name: 'Chats', percent: 0 }])
})

test('plan: re-read at most every 5 min, across all sessions', async ($, on) => {
  const m = world(on)
  m.disk[PLAN] = JSON.stringify({ v: 2, readAt: START - 60_000, limits: [], breakdown: [] })
  await open($)
  await m.clock.advance(10)
  expect(m.calls.length).toBe(0)
  await m.clock.advance(4 * 60_000)
  expect(m.calls.length).toBe(1)
})

test('plan: a server refusal is written, without breaking the session', async ($, on) => {
  const m = world(on)
  m.status = 401
  await open($)
  await m.clock.advance(10)
  expect((plan(m) as { error: string }).error).toBe('HTTP 401')
  expect(m.log.length).toBe(0)
})

test('plan: without a first-party account, no call', async ($, on) => {
  const m = world(on)
  m.handle = null
  await open($)
  await m.clock.advance(10)
  expect(m.calls.length).toBe(0)
  expect(plan(m)).toBeUndefined()
})

test('a limit reading is timestamped by the response that brings it, never by startup or the heartbeat', async ($, on) => {
  const m = world(on)
  await open($)
  expect(last(m).limitsAt).toBeUndefined()
  await m.clock.advance(5000)
  await step($)
  await m.clock.advance(2000)
  expect(last(m).limitsAt).toBe(START + 5000)
  const n = sessionWrites(m).length
  await m.clock.advance(3 * 60_000)
  expect(sessionWrites(m).length).toBeGreaterThan(n)
  expect(last(m).limitsAt).toBe(START + 5000)
})

test('models: the session follows the model of its latest response; each agent keeps its own', async ($, on) => {
  const m = world(on)
  await open($)
  m.model = 'claude-opus-5-5'
  await step($)
  await m.clock.advance(2000)
  expect(last(m).model).toBe('claude-opus-5-5')
  m.agents = [{ id: 'a1', type: 'Explore', description: 'Search', status: 'running' }]
  m.model = 'claude-haiku-4-5-20251001'
  await $.agent.spawn({ prompt: 'p', description: 'Search', subagentType: 'Explore' } as never)
  await step($, 'a1')
  await m.clock.advance(5000)
  await m.clock.advance(2000)
  expect((last(m).agents as { model?: string }[])[0]?.model).toBe('claude-haiku-4-5-20251001')
  expect(last(m).model).toBe('claude-opus-5-5')
})

test('resume: a session reopened the same day keeps its tokens, models, limits and start', async ($, on) => {
  const m = world(on)
  const before = {
    v: 2, sessionId: 's1', project: 'demo', cwd: '/w/demo', model: 'claude-opus-5-5', state: 'working', waiting: null,
    action: { tool: 'Bash', label: 'Bash: x', since: START - 70_000 }, context: null, costUsd: 3, limits: { seven_day: { percent: 18 } },
    limitsAt: START - 60_000, limitHistory: [[START - 60_000, 29]], agents: [{ id: 'a', type: 't', description: 'd', status: 'running', startedAt: 0, tokens: 0 }],
    day: '2026-10-07', doneToday: 2, failedToday: 1, hours: { '2026-10-07T09': 1000 }, models: { 'claude-opus-5-5': 1000 },
    startedAt: START - 3600_000, lastActivity: START - 60_000, updatedAt: START - 60_000,
  }
  m.disk[FILE] = JSON.stringify(before)
  await open($)
  const e = last(m)
  expect(e.hours).toEqual({ '2026-10-07T09': 1000 })
  expect(e.models).toEqual({ 'claude-opus-5-5': 1000 })
  expect([e.doneToday, e.failedToday, e.startedAt, e.limitsAt]).toEqual([2, 1, START - 3600_000, START - 60_000])
  expect((e.limitHistory as unknown[]).length).toBe(2)
  // What belonged to the previous process does not survive: action, wait, agents.
  expect([e.action, e.waiting, e.agents, e.state]).toEqual([null, null, [], 'idle'])
})

test('resume: another day or another session starts from zero', async ($, on) => {
  const m = world(on)
  m.disk[FILE] = JSON.stringify({ v: 2, sessionId: 's1', day: '2026-10-06', hours: { '2026-10-06T09': 1000 }, models: { x: 1 }, doneToday: 4, failedToday: 0, limits: {}, limitHistory: [], startedAt: 0 })
  await open($)
  expect([last(m).hours, last(m).models, last(m).doneToday]).toEqual([{}, {}, 0])
})

test('resume: a file with another contract version is ignored', async ($, on) => {
  const m = world(on)
  m.disk[FILE] = JSON.stringify({ v: 1, sessionId: 's1', day: '2026-10-07', hours: { '2026-10-07T09': 1000 }, models: {}, doneToday: 4, failedToday: 0, limits: {}, limitHistory: [], startedAt: 0 })
  await open($)
  expect([last(m).hours, last(m).doneToday]).toEqual([{}, 0])
})

test('cache and context per category: read at each response and at the end of the turn', async ($, on) => {
  const m = world(on)
  await open($)
  await step($)
  await $.turn.complete({ turnId: 't', answer: '' } as never)
  await m.clock.advance(2000)
  expect(last(m).cache).toEqual({ read: 90_000, input: 93_000, created: 2000, fresh: 1000 })
  expect(last(m).hourCache).toEqual({ '2026-10-07T10': { 'claude-fable-5-1': 90_000 } })
  expect(last(m).contextCategories).toEqual([
    { name: 'System prompt', tokens: 20_000, kind: 'used' },
    { name: 'Messages', tokens: 350_000, kind: 'used' },
    { name: 'Free space', tokens: 630_000, kind: 'free' },
  ])
})
