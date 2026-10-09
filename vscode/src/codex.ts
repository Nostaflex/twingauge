// The Codex engine, kept open while VS Code is: its limit every 60 s, its thread list every 15 s, through its
// protocol (JSON-RPC, one line per message). Codex keeps its own credentials and reads its own files: the
// extension opens nothing under ~/.codex. No VS Code import: testable with a fake Codex.

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import { readCodexLimits, readThreads, type CodexLimit, type CodexThread } from './model'

type Proc = ChildProcessByStdio<Writable, Readable, null>

export type Delays = { limit: number; threads: number; request: number; restart: number }
/** A limit reading takes OpenAI's server well under a second; the thread list stays on this machine. */
export const DELAYS: Delays = { limit: 60_000, threads: 15_000, request: 20_000, restart: 30_000 }

const SOURCES = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown']

export class CodexEngine {
  private p: Proc | undefined
  private readonly pending = new Map<number, (r: unknown) => void>()
  private lastId = 0
  private timers: NodeJS.Timeout[] = []
  private readonly busy = new Set<string>()
  private silent = 0
  private stopped = false

  /** `onLimit(undefined)`: the reading failed or the engine died; the view keeps the last reading and says so. */
  constructor(
    private readonly bin: string,
    private readonly onLimit: (l: CodexLimit | undefined) => void,
    private readonly onThreads: (f: CodexThread[]) => void,
    private readonly d: Delays = DELAYS,
  ) {}

  start(): void {
    if (this.stopped || this.p !== undefined) return
    const p = spawn(this.bin, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] })
    this.p = p
    let buffer = ''
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (d: string) => {
      buffer += d
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i)
        buffer = buffer.slice(i + 1)
        try {
          const o = JSON.parse(line) as { id?: unknown; result?: unknown; error?: unknown }
          const done = typeof o.id === 'number' ? this.pending.get(o.id) : undefined
          if (done !== undefined) done(o.error === undefined ? o.result : undefined)
        } catch {
          // Unreadable line: ignored. Codex notifications have no id and are not used here.
        }
      }
    })
    p.stdin.on('error', () => {})
    p.on('error', () => this.died(p))
    p.on('exit', () => this.died(p))
    void this.initialize(p)
  }

  stop(): void {
    this.stopped = true
    this.clear()
    const p = this.p
    this.p = undefined
    p?.kill()
  }

  private async initialize(p: Proc): Promise<void> {
    const r = await this.request('initialize', { clientInfo: { name: 'twingauge', title: 'TwinGauge', version: '1.0.0' } })
    if (this.p !== p) return
    if (r === undefined) {
      p.kill()
      return
    }
    this.send({ method: 'initialized' })
    void this.readLimit()
    void this.readList()
    this.timers.push(
      setInterval(() => void this.readLimit(), this.d.limit),
      setInterval(() => void this.readList(), this.d.threads),
    )
  }

  private async readLimit(): Promise<void> {
    const r = await this.one('limit', 'account/rateLimits/read', {})
    if (r === null) return
    this.onLimit(r === undefined ? undefined : readCodexLimits(r, Date.now()))
  }

  private async readList(): Promise<void> {
    const r = await this.one('threads', 'thread/list', { limit: 50, sortKey: 'updated_at', sourceKinds: SOURCES })
    if (r !== null && r !== undefined) this.onThreads(readThreads(r))
  }

  /**
   * One request at a time per kind. `null`: the engine died or was stopped meanwhile (died() reported it);
   * `undefined`: no answer. Two silences in a row: the engine is restarted.
   */
  private async one(kind: string, method: string, params: unknown): Promise<unknown> {
    const p = this.p
    if (p === undefined || this.busy.has(kind)) return null
    this.busy.add(kind)
    try {
      const r = await this.request(method, params)
      if (this.p !== p || this.stopped) return null
      if (r === undefined && ++this.silent >= 2) p.kill()
      if (r !== undefined) this.silent = 0
      return r
    } finally {
      this.busy.delete(kind)
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise(resolve => {
      const id = ++this.lastId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(undefined)
      }, this.d.request)
      this.pending.set(id, r => {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(r)
      })
      this.send({ id, method, params })
    })
  }

  private send(o: unknown): void {
    this.p?.stdin.write(`${JSON.stringify(o)}\n`)
  }

  /** The engine died: the failure is reported once, pending requests end, it restarts after a delay. */
  private died(p: Proc): void {
    if (this.p !== p) return
    this.p = undefined
    this.clear()
    this.onLimit(undefined)
    if (!this.stopped) this.timers.push(setTimeout(() => this.start(), this.d.restart))
  }

  private clear(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    for (const done of [...this.pending.values()]) done(undefined)
    this.pending.clear()
    this.silent = 0
  }
}
