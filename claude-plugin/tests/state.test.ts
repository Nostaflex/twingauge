import { describe, expect, test } from 'claude-code/testing'

import {
  addTokens,
  actionLabel,
  questionLabel,
  hourKey,
  mergeAgents,
  newTokens,
  readLimits,
  markAlreadyFinished,
  projectName,
  newState,
  pushHistory,
} from '../hooks/state'

const H10 = new Date(2026, 9, 7, 10, 15).getTime()

describe('state', () => {
  test('project, local hour and new tokens', () => {
    expect(projectName('/home/u/projects/demo')).toBe('demo')
    expect(hourKey(H10)).toBe('2026-10-07T10')
    expect(newTokens({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100 })).toBe(115)
  })
  test('tokens add up per hour and the day resets', () => {
    const e = newState('s', '/w/demo', 'm', H10)
    addTokens(e, H10, 100)
    addTokens(e, H10 + 60_000, 50)
    addTokens(e, H10 + 3600_000, 7)
    expect(e.hours).toEqual({ '2026-10-07T10': 150, '2026-10-07T11': 7 })
    e.doneToday = 3
    addTokens(e, H10 + 24 * 3600_000, 1)
    expect(e.hours).toEqual({ '2026-10-08T10': 1 })
    expect(e.doneToday).toBe(0)
  })
  test('limits in milliseconds, other windows ignored', () => {
    expect(readLimits([
      { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-07T12:40:00.000Z' },
      { kind: 'seven_day', percentUsed: 18 },
      { kind: 'spend_limit', percentUsed: 3 },
    ])).toEqual({ five_hour: { percent: 42, resetsAt: Date.parse('2026-10-07T12:40:00.000Z') }, seven_day: { percent: 18 } })
  })
  test('five-hour history: one reading per change or every 5 min, two hours kept', () => {
    let h: [number, number][] = []
    h = pushHistory(h, 0, 10)
    h = pushHistory(h, 60_000, 10)
    h = pushHistory(h, 120_000, 11)
    h = pushHistory(h, 500_000, 11)
    expect(h.map(([, p]) => p)).toEqual([10, 11, 11])
    h = pushHistory(h, 3 * 3600_000, 50)
    expect(h).toEqual([[3 * 3600_000, 50]])
  })
  test('active agents kept with parent and tokens; completed and failed counted once', () => {
    const counted = new Set<string>()
    const r1 = mergeAgents([], [
      { id: 'a', type: 'general-purpose', description: 'Review', status: 'running' },
      { id: 'b', parentId: 'a', type: 'Explore', description: 'Search', status: 'pending' },
    ], 1000, { a: 84_000 }, counted)
    expect(r1.agents.map(a => [a.id, a.parentId, a.tokens, a.startedAt])).toEqual([['a', undefined, 84_000, 1000], ['b', 'a', 0, 1000]])
    const r2 = mergeAgents(r1.agents, [
      { id: 'a', type: 'general-purpose', description: 'Review', status: 'completed' },
      { id: 'b', parentId: 'a', type: 'Explore', description: 'Search', status: 'failed' },
    ], 9000, {}, counted)
    expect([r2.agents.length, r2.done, r2.failed]).toEqual([0, 1, 1])
    const r3 = mergeAgents([], [{ id: 'a', type: 't', description: 'd', status: 'completed' }], 10_000, {}, counted)
    expect(r3.done).toBe(0)
  })
  test('a vanished agent counts as completed; agents finished before startup do not count', () => {
    const counted = new Set<string>()
    markAlreadyFinished([{ id: 'old', type: 't', description: 'd', status: 'completed' }], counted)
    const r = mergeAgents(
      [{ id: 'x', type: 't', description: 'd', status: 'running', startedAt: 0, tokens: 0 }],
      [{ id: 'old', type: 't', description: 'd', status: 'completed' }],
      5, {}, counted,
    )
    expect([r.done, r.failed]).toEqual([1, 0])
  })
})

test('action label: tool, description, file name, question; never a command or a path', () => {
  expect(actionLabel('Bash', { command: 'rm -rf /tmp/x', description: 'Clean the cache' })).toBe('Bash: Clean the cache')
  expect(actionLabel('Bash', { command: 'ls' })).toBe('Bash')
  expect(actionLabel('Edit', { file_path: '/home/u/projects/secret/page.tsx' })).toBe('Edit: page.tsx')
  expect(actionLabel('Agent', { description: 'Review parser', prompt: 'long private text' })).toBe('Agent: Review parser')
  expect(actionLabel('AskUserQuestion', { questions: [{ question: 'Where to write the summary?' }] })).toBe('Question: Where to write the summary?')
  expect(actionLabel('mcp__github__create_issue', {})).toBe('MCP: github / create_issue')
  expect(actionLabel('WebSearch', { query: 'text' })).toBe('WebSearch')
  const long = 'x'.repeat(200)
  expect(actionLabel('Bash', { description: long }).length).toBe(80)
  expect(questionLabel({ questions: [{ question: long }] }).endsWith('…')).toBe(true)
})
