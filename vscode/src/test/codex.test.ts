import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { CodexEngine } from '../codex'
import type { CodexThread, CodexLimit } from '../model'

/** A fake Codex: it answers the protocol with JSON lines and puts its pid in every answer. */
function fakeCodex(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-'))
  const bin = path.join(d, 'codex')
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
let n = 0
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => {
  buffer += d
  for (let i = buffer.indexOf('\\n'); i >= 0; i = buffer.indexOf('\\n')) {
    const o = JSON.parse(buffer.slice(0, i))
    buffer = buffer.slice(i + 1)
    if (o.id === undefined) continue
    let result = {}
    if (o.method === 'account/rateLimits/read') {
      n++
      result = { rateLimits: { primary: { usedPercent: n, windowDurationMins: 10080, resetsAt: 1792000000 }, planType: 'pid-' + process.pid } }
    }
    if (o.method === 'thread/list') result = { data: [{ id: 'fil-' + process.pid, cwd: '/w/demo', createdAt: 1, updatedAt: 2, preview: 'text' }] }
    process.stdout.write(JSON.stringify({ id: o.id, result }) + '\\n')
  }
})
`,
  )
  fs.chmodSync(bin, 0o755)
  return bin
}

const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
/** Wait for a condition, not a duration: macOS delays the first launch of a freshly written executable. */
async function until(cond: () => boolean, max = 10_000): Promise<void> {
  const end = Date.now() + max
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition never met')
    await wait(10)
  }
}

test('one Codex process reads the limit at every tick, restarts if it dies, stops with VS Code', async () => {
  const limits: (CodexLimit | undefined)[] = []
  const lists: CodexThread[][] = []
  const read = (): CodexLimit[] => limits.filter((l): l is CodexLimit => l !== undefined)
  const m = new CodexEngine(fakeCodex(), l => limits.push(l), f => lists.push(f), { limit: 40, threads: 40, request: 5000, restart: 60 })
  try {
    m.start()
    await until(() => read().length >= 3 && lists.length >= 1)
    // The same process from one reading to the next: its counter rises, its pid does not change.
    assert.deepEqual(read().slice(0, 3).map(l => l.windows[0]?.percent), [1, 2, 3])
    assert.equal(new Set(read().map(l => l.plan)).size, 1)
    assert.equal(JSON.stringify(lists).includes('text'), false)

    // The process dies: the failure is reported, then a new process takes over.
    const first = read()[0]?.plan
    process.kill(Number(first?.slice(4)))
    await until(() => limits.includes(undefined) && read().at(-1)?.plan !== first)
  } finally {
    m.stop()
  }
  // Stopped: no more readings.
  const n = limits.length
  await wait(150)
  assert.equal(limits.length, n)
})

test('without a Codex binary: one reported failure, no exception', async () => {
  const limits: (CodexLimit | undefined)[] = []
  const m = new CodexEngine('/does/not/exist/codex', l => limits.push(l), () => {}, { limit: 40, threads: 40, request: 200, restart: 5000 })
  try {
    m.start()
    await until(() => limits.length > 0)
    await wait(100)
  } finally {
    m.stop()
  }
  assert.deepEqual(limits, [undefined])
})
