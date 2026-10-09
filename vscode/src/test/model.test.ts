import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import * as fs from 'node:fs'
import * as path from 'node:path'

import { actionDuration, day, setLanguage, shortDate, tokens, webviewStrings } from '../i18n'
import {
  alerts,
  BAR_MAX,
  barText,
  barTooltip,
  buildChannel,
  buildSessions,
  buildView,
  limitIcon,
  modelName,
  pace,
  readCodexLimits,
  readMessageName,
  readPlan,
  readState,
  readThreads,
  statesFromThreads,
  updateUnseen,
  visibleText,
  type CodexLimit,
  type Plan,
  type Prefs,
  type SessionState,
} from '../model'

const T = (h: number, m: number): number => new Date(2026, 9, 7, h, m).getTime()
const NOW = T(12, 10)

beforeEach(() => {
  setLanguage('en')
})

function state(p: Partial<SessionState> = {}): SessionState {
  return {
    v: 2,
    sessionId: 's1',
    project: 'demo',
    cwd: '/w/demo',
    model: 'claude-fable-5-1[1m]',
    state: 'working',
    waiting: null,
    context: { window: 1_000_000, tokens: 370_000, percent: 37 },
    costUsd: 3.12,
    limits: { five_hour: { percent: 42, resetsAt: T(14, 40) }, seven_day: { percent: 18, resetsAt: new Date(2026, 9, 12, 9, 0).getTime() } },
    limitHistory: [[T(11, 40), 26], [T(11, 50), 31], [T(12, 0), 37], [T(12, 10), 42]],
    agents: [],
    day: day(NOW),
    doneToday: 0,
    failedToday: 0,
    hours: {},
    startedAt: T(9, 0),
    lastActivity: NOW - 10_000,
    updatedAt: NOW - 4000,
    ...p,
  }
}

test('the 5-hour chart places the window start, now and the reset', () => {
  const c = buildView([state()], NOW).fiveHour
  assert.ok(c)
  assert.equal(c.startText, '09:40')
  assert.equal(c.resetText, 'resets 14:40')
  assert.equal(c.nowX, 0.5)
  assert.equal(c.text, '42%')
})

test('the slope of the last 30 minutes gives the time the limit is hit', () => {
  const c = buildView([state()], NOW).fiveHour
  assert.equal(c?.forecast?.text, '≈ limit around 13:57')
  assert.match(c?.sentence ?? '', /^At this pace: limit around 13:57, 4[23] min before the reset\.$/)
})

test('at a slow pace "you will last"; without readings, no forecast', () => {
  const slow = buildView([state({ limitHistory: [[T(11, 40), 41], [T(12, 10), 42]] })], NOW).fiveHour
  assert.equal(slow?.forecast, null)
  assert.equal(slow?.sentence, 'At this pace you will last until the 14:40 reset.')
  assert.equal(buildView([state({ limitHistory: [] })], NOW).fiveHour?.sentence, 'Not enough readings yet for a forecast.')
})

test('a 5-hour window already reset draws no stale chart', () => {
  assert.equal(buildView([state({ limits: { five_hour: { percent: 90, resetsAt: T(12, 0) } } })], NOW).fiveHour, null)
})

test('waits: active sessions only, most recent first, with their duration', () => {
  const v = buildView([
    state({ sessionId: 'a' }),
    state({ sessionId: 'b', project: 'api', state: 'waiting', waiting: { kind: 'question', since: NOW - 180_000 } }),
    state({ sessionId: 'c', state: 'waiting', waiting: { kind: 'question', since: NOW }, updatedAt: NOW - 20 * 60_000 }),
  ], NOW)
  assert.deepEqual(v.waits.map(w => [w.id, w.text]), [['b', 'Question open for 3 min']])
})

test('agent tree with parent, tokens, model and duration', () => {
  const s = buildSessions([state({ agents: [
    { id: 'a1', type: 'general-purpose', description: 'Review', status: 'running', startedAt: NOW - 120_000, tokens: 84_000 },
    { id: 'a2', parentId: 'a1', type: 'Explore', description: 'Find callers', status: 'running', startedAt: NOW - 60_000, tokens: 12_000, model: 'claude-haiku-4-5-20251001' },
    { id: 'a3', type: 'general-purpose', description: 'Reviewer', status: 'pending', startedAt: NOW, tokens: 0 },
  ], doneToday: 7 })], NOW, PREFS)
  const agents = s.groups.flatMap(g => g.rows)[0]?.agents ?? []
  assert.deepEqual(agents.map(a => a.id), ['a1', 'a3'])
  assert.equal(agents[0]?.description, '84k · 2 min')
  assert.equal(agents[0]?.children[0]?.description, 'Haiku 4.5 · 12k · 1 min')
  assert.equal(agents[1]?.description, 'waiting')
  assert.equal(buildView([state({ doneToday: 7 })], NOW).agentsSummary, 'Finished today: 7 · failed: 0')
})

test('the hours add up every session of the day, hour by hour', () => {
  const v = buildView([
    state({ hours: { '2026-10-07T09': 400_000, '2026-10-07T11': 500_000 } }),
    state({ sessionId: 's2', state: 'closed', hours: { '2026-10-07T11': 20_000, '2026-10-06T11': 999 } }),
  ], NOW)
  const h = Object.fromEntries(v.hours.map(x => [x.label, x.claude]))
  assert.equal(h['09'], 400_000)
  assert.equal(h['11'], 520_000)
  assert.equal(v.hours[0]?.label, '09')
  assert.equal(v.hours.find(x => x.label === '12')?.current, true)
  assert.equal(v.hours.find(x => x.label === '13')?.future, true)
})

test('alerts at 80% and 95% once each, a wait after 2 minutes', () => {
  const sent = new Set<string>()
  const v = buildView([state({ limits: { five_hour: { percent: 96, resetsAt: T(14, 40) } }, state: 'waiting', waiting: { kind: 'permission', since: NOW - 150_000, tool: 'Bash' } })], NOW)
  const a = alerts(v, sent)
  assert.equal(a.length, 3)
  assert.equal(a.filter(x => x.severe).length, 1)
  assert.equal(a.find(x => x.sessionId === 's1')?.message, 'demo is waiting for you: permission requested (Bash) for 3 min.')
  for (const x of a) sent.add(x.key)
  assert.equal(alerts(v, sent).length, 0)
  const early = buildView([state({ state: 'waiting', waiting: { kind: 'question', since: NOW - 60_000 } })], NOW)
  assert.equal(alerts(early, new Set()).filter(x => x.sessionId !== undefined).length, 0)
})

test('status bar, missing data and formats', () => {
  const v = buildView([state({ state: 'waiting', waiting: { kind: 'question', since: NOW } })], NOW)
  assert.equal(barText(v), '$(bell-dot) 1 waiting · 5h 42% → ≈ 13:57')
  assert.equal(barText(v, { waiting: 0 }), '$(dashboard) 5h 42% → ≈ 13:57 · 7d 18%')
  assert.equal(barText(v, { waiting: 2, muted: true }), '$(bell-slash) 2 waiting · 5h 42% → ≈ 13:57')
  const old = buildView([state({ updatedAt: NOW - 40 * 60_000 })], NOW)
  assert.equal(old.missing, true)
  assert.equal(old.freshness, 'No data for 40 min')
  assert.equal(barText(old), '$(dashboard) TwinGauge: no data')
  assert.equal(modelName('claude-fable-5-1[1m]'), 'Fable 5.1')
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5')
  assert.equal(tokens(1_900_000), '1.9M')
  assert.equal(readState('not json'), undefined)
  assert.equal(readState('{"v":1,"sessionId":"x","updatedAt":1}'), undefined)
})

const PLAN: Plan = {
  v: 2,
  readAt: NOW - 120_000,
  limits: [
    { key: 'session', kind: 'session', percent: 2, severity: 'normal', resetsAt: T(14, 40), active: false },
    { key: 'weekly_all', kind: 'weekly_all', percent: 45, severity: 'normal', resetsAt: T(23, 59), active: false },
    { key: 'weekly_scoped:Fable', kind: 'weekly_scoped', percent: 75, severity: 'warning', resetsAt: T(23, 59), model: 'Fable', active: true },
  ],
  breakdown: [{ name: 'Claude Code', percent: 100 }, { name: 'Chats', percent: 0 }],
}

test('per-model limits: Fable at 75%, orange because the server says "warning"', () => {
  const v = buildView([state()], NOW, PLAN)
  assert.deepEqual(v.perModel.map(m => [m.name, m.tone, m.text, m.word]), [['Fable', 'orange', '75% · 23:59', 'warning']])
  assert.equal(v.planText, 'Read 2 min ago')
  assert.match(barTooltip(v, { waiting: 0, running: 1, unseen: 0 }), /Fable · 75% · 23:59 · warning/)
})

test('per-model limits: alerts at 80 and 95%, a reset limit disappears', () => {
  const high: Plan = { ...PLAN, limits: [{ ...PLAN.limits[2]!, percent: 96 }] }
  const a = alerts(buildView([state()], NOW, high), new Set())
  assert.deepEqual(a.filter(x => x.key.startsWith('model-')).map(x => x.message), ['Fable 7-day limit at 96%.', 'Fable 7-day limit at 96%.'])
  const past: Plan = { ...PLAN, limits: [{ ...PLAN.limits[2]!, resetsAt: NOW - 1 }] }
  assert.equal(buildView([state()], NOW, past).perModel.length, 0)
})

test('plan missing, failing or without per-model limits: a clear text', () => {
  assert.equal(buildView([state()], NOW).planText, 'Plan limits: waiting for the first reading.')
  assert.equal(buildView([state()], NOW, { ...PLAN, error: 'HTTP 401' }).planText, 'Plan limits unavailable (HTTP 401), read 2 min ago.')
  assert.match(buildView([state()], NOW, { ...PLAN, limits: [] }).planText, /^No model-specific limit/)
  assert.equal(readPlan('{"v":2}'), undefined)
  assert.equal(readPlan(JSON.stringify({ ...PLAN, v: 1 })), undefined)
})

test("today's usage per model, all sessions, short names", () => {
  const v = buildView([
    state({ models: { 'claude-fable-5-1': 900_000, 'claude-haiku-4-5-20251001': 39_000 } }),
    state({ sessionId: 's2', models: { 'claude-fable-5-1[1m]': 300_000, 'claude-opus-5-5': 61_000 } }),
  ], NOW)
  assert.deepEqual(v.usage, [
    { name: 'Fable 5.1', text: '1.2M · 92%' },
    { name: 'Opus 5.5', text: '61k · 5%' },
    { name: 'Haiku 4.5', text: '39k · 3%' },
  ])
})

const PREFS: Prefs = { pinned: new Set(), hidden: new Set(), unseen: new Set(), showHidden: false }
const codex = (p: Partial<SessionState> = {}): SessionState =>
  state({ engine: 'codex', sessionId: 'x1', model: 'gpt-5-codex', costUsd: null, limits: {}, limitHistory: [], context: null, ...p })

test('only the forecast carries ≈; every cost says "API eq."; today says its scope', () => {
  const v = buildView([state({ hours: { '2026-10-07T11': 1000 } }), codex({ hours: { '2026-10-07T11': 400 } })], NOW, PLAN)
  assert.match(v.fiveHour?.forecast?.text ?? '', /^≈ /)
  assert.match(v.fiveHour?.source ?? '', /^Official: Anthropic, read at 12:10\. The ≈ forecast is an estimate/)
  const rows = buildSessions([state(), codex()], NOW, PREFS).groups.flatMap(g => g.rows)
  for (const r of rows) assert.doesNotMatch(r.description, /≈/)
  assert.match(rows.find(r => r.engine === 'claude')?.figures ?? '', /\$3\.12 API eq\.$/)
  assert.equal(v.today.text, '1k Claude · 400 Codex')
  assert.match(v.today.tooltip, /Claude Code and Codex sessions.*API equivalent.*Codex: no public price/)
  assert.deepEqual(v.limitRows.map(l => [l.engine, l.name]), [['claude', '7 days'], ['claude', 'Fable']])
})

test('Codex limit: read through the protocol, one row per window; stale, it says so', () => {
  const read = readCodexLimits({ rateLimits: { limitId: 'codex', planType: 'prolite', primary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: 1791972400 }, secondary: null } }, NOW)
  assert.deepEqual(read, { readAt: NOW, windows: [{ label: '7 days', percent: 3, resetsAt: 1791972400_000 }], plan: 'prolite' })
  assert.equal(readCodexLimits({ other: 1 }, NOW), undefined)
  const v = buildView([state()], NOW, PLAN, read as CodexLimit)
  const l = v.limitRows.find(x => x.engine === 'codex')
  assert.equal(l?.name, '7 days')
  assert.equal(l?.text, '3% · Wed 10/14')
  assert.equal(l?.source, 'Official: OpenAI, read by Codex at 12:10.')
  assert.match(v.readings, /OpenAI 12:10/)
  const stale = buildView([state()], NOW, PLAN, { ...(read as CodexLimit), readAt: NOW - 20 * 60_000, error: 'Codex unreachable' })
  assert.equal(stale.codex?.text, 'Codex: last reading 20 min ago.')
  assert.equal(stale.limitRows.some(x => x.engine === 'codex'), false)
  const high = buildView([state()], NOW, PLAN, { readAt: NOW, windows: [{ label: '7 days', percent: 96, resetsAt: T(23, 0) }] })
  assert.equal(alerts(high, new Set()).filter(a => a.key.startsWith('codex-')).length, 2)
})

test('the status bar fits in 30 visible characters, whatever the case, in both languages', () => {
  for (const lang of ['en', 'fr']) {
    setLanguage(lang)
    const cases = [
      buildView([state()], NOW),
      buildView([state({ limits: { seven_day: { percent: 18 } } })], NOW),
      buildView([state({ limitHistory: [] })], NOW),
    ]
    for (const v of cases) for (const waiting of [0, 1, 12]) for (const muted of [false, true]) {
      assert.ok(visibleText(barText(v, { waiting, muted })).length <= BAR_MAX, barText(v, { waiting, muted }))
    }
  }
})

test('groups, badge = waiting rows, a hidden session comes back when it waits, a pinned one stays', () => {
  const states = [
    state({ sessionId: 'a', project: 'api', state: 'waiting', waiting: { kind: 'question', since: NOW - 60_000, text: 'Where should the summary go?' } }),
    state({ sessionId: 'b', project: 'demo' }),
    codex({ sessionId: 'c', project: 'web', state: 'waiting', waiting: { kind: 'permission', since: NOW, tool: 'shell' } }),
    state({ sessionId: 'd', project: 'shop', state: 'idle', lastActivity: NOW - 12 * 60_000, lastAction: { tool: 'Edit', label: 'Edit: page.tsx', since: 0, until: 0 } }),
    state({ sessionId: 'e', project: 'old', state: 'idle', updatedAt: NOW - 3 * 3600_000 }),
  ]
  const s = buildSessions(states, NOW, { ...PREFS, hidden: new Set(['c', 'd']), pinned: new Set(['e']) })
  const g = Object.fromEntries(s.groups.map(x => [x.group, x.rows.map(l => l.id)]))
  assert.deepEqual(g, { waiting: ['a', 'c'], running: ['b'], unseen: [], idle: ['e'] })
  assert.equal(s.waiting, 2)
  assert.equal(s.hidden, 1)
  const a = s.groups[0]?.rows[0]
  assert.equal(a?.description, 'Fable 5.1 · context 37% · $3.12 API eq. · waiting for you · Where should the summary go?')
  // The panel draws two lines: the figures without the model (its chip says it), then what the session does.
  assert.equal(a?.figures, 'context 37% · $3.12 API eq.')
  assert.equal(a?.doing, 'waiting for you · Where should the summary go?')
  assert.equal(s.groups[0]?.rows[1]?.description, 'GPT-5 Codex · waiting for you · permission shell')
  assert.equal(s.groups[0]?.rows[1]?.hidden, true)
  const all = buildSessions(states, NOW, { ...PREFS, hidden: new Set(['d']), showHidden: true })
  assert.equal(all.groups.find(x => x.group === 'idle')?.rows[0]?.description, 'Fable 5.1 · context 37% · $3.12 API eq. · idle 12 min · Edit: page.tsx')
})

test('a Codex sub-agent sits under its parent session, with its nickname and tokens', () => {
  const s = buildSessions([
    codex({ sessionId: 'p', state: 'working', action: { tool: 'shell', label: 'Shell: review', since: NOW - 45_000 } }),
    codex({ sessionId: 'f', parentId: 'p', nickname: 'reviewer', state: 'working', tokens: { total: 12_000 }, startedAt: NOW - 60_000 }),
  ], NOW, PREFS)
  const running = s.groups.find(x => x.group === 'running')?.rows ?? []
  assert.equal(running.length, 1)
  assert.equal(running[0]?.description, 'GPT-5 Codex · Shell: review · 40 s')
  assert.deepEqual(running[0]?.agents.map(x => [x.label, x.description, x.engine]), [['reviewer', 'GPT-5 Codex · 12k · working · 1 min', 'codex']])
})

test('"done, unseen" when a session finishes with the panel hidden; nothing when it is visible', () => {
  const before = new Map([['a', 'working'], ['b', 'working']])
  const after = [state({ sessionId: 'a', state: 'idle' }), state({ sessionId: 'b', state: 'idle' })]
  const hidden = updateUnseen(new Set(), before, after, false)
  assert.deepEqual([...hidden.unseen].sort(), ['a', 'b'])
  assert.equal(updateUnseen(new Set(), before, after, true).unseen.size, 0)
  const again = updateUnseen(hidden.unseen, hidden.previous, [state({ sessionId: 'a', state: 'working' }), state({ sessionId: 'b', state: 'idle' })], false)
  assert.deepEqual([...again.unseen], ['b'])
  const s = buildSessions([state({ sessionId: 'b', state: 'idle', lastAction: { tool: 'Bash', label: 'Bash: tests', since: 0, until: 0 } })], NOW, { ...PREFS, unseen: again.unseen })
  assert.equal(s.unseen, 1)
  assert.equal(s.groups.find(x => x.group === 'unseen')?.rows[0]?.description, 'Fable 5.1 · context 37% · $3.12 API eq. · done · Bash: tests')
})

test('stable order by project in each group, pinned first; durations in 10 s steps', () => {
  const states = ['zeta', 'alpha', 'mu'].map((p, i) => state({ sessionId: `s${i}`, project: p, lastActivity: NOW - i * 1000 }))
  assert.deepEqual(buildSessions(states, NOW, PREFS).groups[1]?.rows.map(l => l.project), ['alpha', 'mu', 'zeta'])
  assert.deepEqual(buildSessions(states, NOW, { ...PREFS, pinned: new Set(['s0']) }).groups[1]?.rows.map(l => l.project), ['zeta', 'alpha', 'mu'])
  assert.deepEqual([29_000, 30_000, 47_000, 61_000].map(actionDuration), ['', '30 s', '40 s', '1 min'])
})

test('the compiled extension opens no path under ~/.codex', () => {
  const dir = path.join(__dirname, '..')
  const js = fs.readdirSync(dir).filter(n => n.endsWith('.js')).map(n => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n')
  // No string in the code points under .codex; comments do not count.
  assert.doesNotMatch(js, /['"`](?:[^'"`\n]*[\\/])?\.codex(?:[\\/][^'"`\n]*)?['"`]/)
  assert.match(js, /['"`]account\/rateLimits\/read['"`]/)
  assert.match(js, /['"`]thread\/list['"`]/)
})

test('meaningful icons: one shape per meaning, the colour doubles it, nothing under 70%', () => {
  const ids = (es: SessionState[], prefs: Prefs = PREFS): Record<string, string> =>
    Object.fromEntries(buildSessions(es, NOW, prefs).groups.flatMap(g => g.rows).map(l => [l.id, `${l.icon.id} ${l.icon.color}`]))
  const agent = (id: string, status: string) => ({ id, type: 't', description: id, status, startedAt: T(12, 0), tokens: 0 })
  const es = [
    state({ sessionId: 'q', state: 'waiting', waiting: { kind: 'question', since: NOW } }),
    state({ sessionId: 'p', state: 'waiting', waiting: { kind: 'permission', since: NOW, tool: 'Bash' } }),
    state({ sessionId: 'm', agents: [agent('a1', 'running'), agent('a2', 'pending')] }),
    state({ sessionId: 'n', state: 'idle' }),
    state({ sessionId: 'r', state: 'idle' }),
  ]
  assert.deepEqual(ids(es, { ...PREFS, unseen: new Set(['n']) }), {
    q: 'question charts.orange',
    p: 'shield charts.orange',
    m: 'pulse charts.green',
    n: 'done charts.blue',
    r: 'idle descriptionForeground',
  })
  const m = buildSessions(es, NOW, PREFS).groups.flatMap(g => g.rows).find(l => l.id === 'm')
  assert.deepEqual(m?.agents.map(a => `${a.icon.id} ${a.icon.color}`), ['agent charts.green', 'agent descriptionForeground'])

  assert.equal(limitIcon(69, 'green'), null)
  assert.equal(limitIcon(75, 'orange')?.id, 'warning')
  assert.equal(limitIcon(93, 'red')?.id, 'flame')
  assert.equal(limitIcon(100, 'red')?.id, 'circle-slash')
  // The server may say "warning" under 70%: the icon follows the tone, not only the number.
  assert.equal(limitIcon(60, 'orange')?.id, 'warning')

  const calm = buildView([state()], NOW)
  assert.equal(calm.fiveHour?.icon, null)
  assert.ok(calm.limitRows.every(l => l.icon === null))
  assert.equal(barText(calm, { waiting: 0 }).startsWith('$(dashboard) '), true)
  const tense = buildView([state({ limits: { five_hour: { percent: 75, resetsAt: T(14, 40) }, seven_day: { percent: 18 } } })], NOW, PLAN, {
    readAt: NOW,
    windows: [{ label: '7 days', percent: 100, resetsAt: T(23, 0) }],
  })
  assert.equal(tense.fiveHour?.icon?.id, 'warning')
  assert.deepEqual(tense.limitRows.map(l => l.icon?.id ?? '-'), ['-', 'warning', 'circle-slash'])
  // The status bar shows the worst limit when nothing waits; a wait and mute come first.
  assert.equal(barText(tense, { waiting: 0 }).startsWith('$(circle-slash) '), true)
  assert.equal(barText(tense, { waiting: 1 }).startsWith('$(bell-dot) '), true)
  assert.equal(barText(tense, { waiting: 1, muted: true }).startsWith('$(bell-slash) '), true)
})

test('reset dates: the date from 24 h on, rounded to the minute; one reset gives one date', () => {
  const thu = new Date(2026, 9, 8, 11, 10).getTime()
  const reset = new Date(2026, 9, 15, 0, 0).getTime()
  assert.equal(shortDate(reset, thu), 'Thu 10/15')
  // /usage gives the same reset 98 ms earlier, at 23:59:59.902 the day before.
  assert.equal(shortDate(reset - 98, thu), 'Thu 10/15')
  assert.equal(shortDate(new Date(2026, 9, 8, 12, 59, 59, 902).getTime(), thu), '13:00')
  const plan: Plan = { v: 2, readAt: thu - 120_000, breakdown: [], limits: [
    { key: 'weekly_scoped:Fable', kind: 'weekly_scoped', percent: 1, severity: 'normal', resetsAt: reset - 96, model: 'Fable', active: false }] }
  const v = buildView([state({ updatedAt: thu - 4000, lastActivity: thu - 4000, day: day(thu), limitHistory: [],
    limits: { five_hour: { percent: 2, resetsAt: new Date(2026, 9, 8, 13, 0).getTime() }, seven_day: { percent: 1, resetsAt: reset } } })], thu, plan)
  assert.deepEqual(v.limitRows.map(l => l.text), ['1% · Thu 10/15', '1% · Thu 10/15'])
})

test('the view takes the most recent reading, never the most recently written file', () => {
  const thu = new Date(2026, 9, 8, 11, 10).getTime()
  const J = (h: number, m: number): number => new Date(2026, 9, 8, h, m).getTime()
  const base = { day: day(thu), agents: [], lastActivity: thu - 60_000 }
  // An idle session rewritten 4 s ago by its heartbeat, with yesterday's readings and past resets.
  const yesterday = state({ ...base, sessionId: 'idle', state: 'idle', updatedAt: thu - 4000,
    limits: { five_hour: { percent: 14, resetsAt: J(0, 30) }, seven_day: { percent: 48, resetsAt: J(0, 0) } },
    limitHistory: [[new Date(2026, 9, 7, 23, 32).getTime(), 14]] })
  const active = state({ ...base, sessionId: 'active', updatedAt: thu - 30_000, limitsAt: thu - 30_000,
    limits: { five_hour: { percent: 2, resetsAt: J(13, 0) }, seven_day: { percent: 1, resetsAt: new Date(2026, 9, 15).getTime() } },
    limitHistory: [[thu - 30_000, 2]] })
  const v = buildView([yesterday, active], thu)
  assert.equal(v.fiveHour?.text, '2%')
  assert.equal(v.sevenDay?.percent, 1)
  // Even with resets still ahead, an old reading loses to a recent one.
  const old = { ...yesterday, limits: { five_hour: { percent: 14, resetsAt: J(13, 0) }, seven_day: { percent: 48, resetsAt: new Date(2026, 9, 15).getTime() } } }
  assert.equal(buildView([old, active], thu).sevenDay?.percent, 1)
  // A file without limitsAt is dated by its last history point.
  assert.equal(buildView([old, { ...active, limitsAt: undefined }], thu).sevenDay?.percent, 1)
  // The plan reading wins when it is more recent than every session.
  const plan: Plan = { v: 2, readAt: thu - 10_000, breakdown: [], limits: [
    { key: 'session', kind: 'session', percent: 3, severity: 'normal', resetsAt: J(13, 0) - 98, active: true },
    { key: 'weekly_all', kind: 'weekly_all', percent: 2, severity: 'normal', resetsAt: new Date(2026, 9, 15).getTime() - 98, active: false }] }
  const f = buildView([yesterday, active], thu, plan)
  assert.equal(f.fiveHour?.text, '3%')
  assert.equal(f.sevenDay?.percent, 2)
  assert.match(f.fiveHour?.source ?? '', /plan, read at 11:09/)
  assert.equal(f.readings, 'Read: Anthropic 11:09')
  // Alert keys do not change from one source to the other: the reset is rounded to the minute.
  assert.equal(f.sevenDay?.resetsAt, new Date(2026, 9, 15).getTime())
})

test('models, context and cost in every row without hovering; the model of each agent', () => {
  assert.equal(modelName('gpt-5.5-codex'), 'GPT-5.5 Codex')
  assert.equal(modelName('gpt-5.5'), 'GPT-5.5')
  assert.equal(modelName('gpt-6-astra'), 'GPT-6 Astra')
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5')
  const s = buildSessions([
    state({ sessionId: 'm', model: 'claude-opus-5-5', action: { tool: 'Bash', label: 'Bash: probe', since: NOW - 5000 },
      agents: [{ id: 'a1', type: 'Explore', description: 'Search', status: 'running', startedAt: NOW - 60_000, tokens: 12_000, model: 'claude-haiku-4-5-20251001' }] }),
    codex({ sessionId: 'c', state: 'idle', tokens: { total: 1_200_000 }, lastActivity: NOW - 120_000 }),
  ], NOW, PREFS)
  const l = s.groups.flatMap(g => g.rows)
  assert.equal(l.find(x => x.id === 'm')?.description, 'Opus 5.5 · context 37% · $3.12 API eq. · Bash: probe')
  assert.deepEqual(l.find(x => x.id === 'm')?.agents.map(a => a.description), ['Haiku 4.5 · 12k · 1 min'])
  assert.equal(l.find(x => x.id === 'c')?.description, 'GPT-5 Codex · 1.2M tokens · idle 2 min')
})

test('Codex sessions seen through its list: no text, no duplicate with the hook', () => {
  const s = NOW / 1000
  const threads = readThreads({ data: [
    { id: 'r', sessionId: 'r', cwd: '/w/demo', createdAt: s - 3600, updatedAt: s - 20, status: { type: 'notLoaded' }, preview: 'SECRET first message', name: 'SECRET title' },
    { id: 'f', sessionId: 'f', parentThreadId: 'r', agentNickname: 'Probe', cwd: '/w/demo', createdAt: s - 600, updatedAt: s - 300, status: { type: 'notLoaded' }, preview: 'SECRET' },
    { id: 'h', sessionId: 'h', cwd: '/w/web', createdAt: s - 60, updatedAt: s - 5, status: { type: 'notLoaded' }, preview: 'SECRET' },
    { id: 'z', cwd: '/w/x' },
  ], nextCursor: null })
  assert.equal(JSON.stringify(threads).includes('SECRET'), false)
  assert.deepEqual(threads.map(f => f.id), ['r', 'f', 'h'])
  // "h" already has a file written by the hook: the list does not duplicate it.
  const listed = statesFromThreads(threads, new Set(['h']), NOW)
  assert.deepEqual(listed.map(e => [e.sessionId, e.engine, e.state, e.project, e.parentId ?? '-']), [
    ['r', 'codex', 'working', 'demo', '-'],
    ['f', 'codex', 'idle', 'demo', 'r'],
  ])
  const hooked = codex({ sessionId: 'h', project: 'web', state: 'working' })
  const rows = buildSessions([hooked, ...listed], NOW, PREFS).groups.flatMap(g => g.rows)
  assert.deepEqual(rows.map(l => l.id).sort(), ['h', 'r'])
  const r = rows.find(l => l.id === 'r')
  assert.equal(r?.description, 'active 1 min ago · seen in the Codex list')
  assert.match(r?.tooltip.join(' ') ?? '', /seen in the Codex list/)
  assert.deepEqual(r?.agents.map(a => a.label), ['Probe'])
})

test('Codex: a session stays idle 2 h after its last activity, even when a reload closed it', () => {
  const s = buildSessions([
    codex({ sessionId: 'closed', state: 'closed', updatedAt: NOW - 49 * 60_000, lastActivity: NOW - 49 * 60_000 }),
    codex({ sessionId: 'old', state: 'idle', updatedAt: NOW - 3 * 3600_000, lastActivity: NOW - 3 * 3600_000 }),
    state({ sessionId: 'claude-closed', state: 'closed', updatedAt: NOW - 60_000 }),
  ], NOW, PREFS)
  assert.deepEqual(s.groups.flatMap(g => g.rows).map(l => l.id), ['closed'])
  assert.equal(s.groups.find(g => g.group === 'idle')?.rows[0]?.description, 'GPT-5 Codex · idle 49 min')
})

test('5-hour window: without an open window the panel says so instead of "limit unknown"', () => {
  const plan: Plan = { v: 2, readAt: NOW - 60_000, breakdown: [], limits: [
    { key: 'session', kind: 'session', percent: 0, severity: 'normal', active: false }] }
  const none = state({ limits: { seven_day: { percent: 2 } }, limitHistory: [] })
  const v = buildView([none], NOW, plan)
  assert.equal(v.fiveHour, null)
  assert.equal(v.fiveHourEmpty, 'No 5-hour window open: it starts with your next request to Claude.')
  assert.match(buildView([none], NOW).fiveHourEmpty, /^Limit unknown for now/)
})

test('agent channel: read by file names only; new for each side and unanswered requests', () => {
  assert.equal(readMessageName('codex', 'README.md'), undefined)
  assert.equal(readMessageName('codex', '20261008T165324Z-note-x.md'), undefined)
  assert.equal(readMessageName('codex', '20261008T165324Z-request-Bad_Name.md'), undefined)
  const m = (side: 'claude' | 'codex', name: string) => readMessageName(side, name)!
  const msgs = [
    m('claude', '20261007T213226Z-ack-handover.md'),
    m('codex', '20261008T075437Z-response-resume.md'),
    m('codex', '20261008T165324Z-request-final-review.md'),
  ]
  assert.equal(msgs[2]?.subject, 'final review')
  const c = buildChannel(msgs, Date.UTC(2026, 9, 8, 17, 0))
  assert.deepEqual([c.forClaude, c.forCodex, c.unanswered], [2, 0, 1])
  assert.equal(c.latest[0]?.kind, 'request')
  assert.equal(c.text, '2 new for Claude · 1 unanswered')
  const answered = buildChannel([...msgs, m('claude', '20261008T170000Z-response-final-review.md')], Date.UTC(2026, 9, 8, 17, 5))
  assert.deepEqual([answered.forClaude, answered.forCodex, answered.unanswered, answered.text], [0, 1, 0, '1 new for Codex'])
  assert.equal(buildChannel([], 0).text, 'No message yet.')
})

test('pace, cache and context by category', () => {
  const reset = NOW + 3.5 * 24 * 3600_000 // half the week elapsed
  assert.match(pace(20, reset, NOW).text, /^on pace \(50% of the week/)
  assert.equal(pace(3, NOW + 7 * 24 * 3600_000 - 60_000, NOW).tone, 'green')
  const fast = pace(80, reset, NOW)
  assert.equal(fast.tone, 'orange')
  assert.match(fast.text, /^30 pts ahead · ≈ limit /)
  const v = buildView([state({ cache: { read: 90_000, input: 100_000 }, contextCategories: [{ name: 'Messages', tokens: 300_000, kind: 'used' }, { name: 'Free space', tokens: 700_000, kind: 'free' }] })], NOW, PLAN)
  assert.equal(v.cache?.text, '90% read from cache · 90k of 100k')
  assert.equal(v.context?.total, 1_000_000)
  assert.ok(v.limitRows.every(l => l.pace !== undefined))
})

test('cache: reads per hour and per model in the histogram; the day detail for the ring', () => {
  const v = buildView([state({ hours: { '2026-10-07T11': 1000 }, hourModels: { '2026-10-07T11': { 'claude-opus-5-5': 1000 } },
    hourCache: { '2026-10-07T11': { 'claude-opus-5-5': 9000 } }, cache: { read: 9000, input: 10_000, created: 600, fresh: 400 } })], NOW)
  assert.deepEqual(v.hours.find(h => h.label === '11')?.models.claude, [{ name: 'Opus 5.5', n: 1000, read: 9000 }])
  assert.deepEqual([v.cache?.read, v.cache?.created, v.cache?.fresh, Math.round(v.cache?.percent ?? 0)], [9000, 600, 400, 90])
})

test('French: same numbers, French words and formats', () => {
  setLanguage('fr-ca')
  const v = buildView([state({ hours: { '2026-10-07T11': 1_900_000 } })], NOW, PLAN)
  assert.equal(v.fiveHour?.text, '42 %')
  assert.equal(v.fiveHour?.forecast?.text, '≈ limite vers 13:57')
  assert.equal(v.limitRows[0]?.name, '7 jours')
  assert.equal(v.perModel[0]?.word, 'attention')
  assert.equal(v.today.text, '1,9 M jetons')
  const row = buildSessions([state()], NOW, PREFS).groups.flatMap(g => g.rows)[0]
  assert.equal(row?.figures, 'contexte 37 % · 3,12 $ éq. API')
  assert.equal(shortDate(new Date(2026, 9, 15).getTime(), NOW), 'jeu. 15/10')
  assert.equal(barText(v, { waiting: 1 }), '$(bell-dot) 1 t’attend · 5 h 42 %')
  // The webview receives plain strings only: functions would not survive postMessage.
  const w = webviewStrings()
  assert.equal(JSON.stringify(w).includes('{0} masquée(s)'), true)
  assert.ok(Object.values(w).every(x => typeof x !== 'function'))
})
