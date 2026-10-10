import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as vscode from 'vscode'

import { CodexEngine } from './codex'
import { CHANNEL_README } from './channel-readme'
import { setLanguage, t, webviewStrings } from './i18n'
import {
  alerts,
  barText,
  barTooltip,
  buildChannel,
  buildSessions,
  buildView,
  MESSAGE_NAME,
  readMessageName,
  readPlan,
  readState,
  statesFromThreads,
  updateUnseen,
  type Channel,
  type ChannelMessage,
  type CodexLimit,
  type CodexThread,
  type Engine,
  type Prefs,
  type SessionState,
  type Sessions,
  type View,
} from './model'

const ROOT = path.join(os.homedir(), '.claude', 'twingauge')
const CLAUDE_DIR = path.join(ROOT, 'sessions')
const CODEX_DIR = path.join(ROOT, 'codex')
const PLAN = path.join(ROOT, 'plan.json')
const KEEP_MS = 7 * 24 * 3600_000
/** Durations change every 10 s. */
const TICK_MS = 10_000
/** The Codex engine starts 15 s after VS Code, never during startup; then it stays open. */
const CODEX_FIRST_MS = 15_000
const MUTE_MS = 3600_000
/** "Done, unseen" clears after the panel has been visible for 5 s. */
const SEEN_MS = 5000

export function activate(ctx: vscode.ExtensionContext): void {
  setLanguage(vscode.env.language)
  const g = ctx.globalState
  const set = (key: string): Set<string> => new Set(g.get<string[]>(key, []))
  const prefs: Prefs & { pinned: Set<string>; hidden: Set<string>; unseen: Set<string> } = {
    pinned: set('pinned'),
    hidden: set('hidden'),
    unseen: set('unseen'),
    showHidden: false,
  }
  let previous = new Map<string, string>()
  let codexLimit = g.get<CodexLimit>('codexLimit')
  let threads: CodexThread[] = []
  let mutedUntil = g.get<number>('mutedUntil', 0)
  const sent = new Set<string>(g.get<string[]>('alerts', []))
  let states: SessionState[] = []
  let view: View | undefined
  let sessions: Sessions | undefined

  const panel = new Panel(ctx.extensionUri)
  // The "TwinGauge" output channel: what the extension sees, so that no failure stays silent.
  const log = vscode.window.createOutputChannel('TwinGauge', { log: true })
  log.info(`version ${String((ctx.extension.packageJSON as { version?: unknown }).version)} · VS Code ${vscode.version} · ${vscode.env.language}`)
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  bar.command = 'twingauge.panel.focus'
  bar.show()
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('twingauge.panel', panel, { webviewOptions: { retainContextWhenHidden: true } }), bar)

  const muted = (): boolean => mutedUntil > Date.now()
  const keep = (key: string, s: ReadonlySet<string>): void => {
    void g.update(key, [...s])
  }

  const refresh = (): void => {
    const now = Date.now()
    states = readAll(threads)
    const u = updateUnseen(prefs.unseen, previous, states, panel.visible)
    previous = u.previous
    if (u.unseen.size !== prefs.unseen.size || [...u.unseen].some(x => !prefs.unseen.has(x))) {
      prefs.unseen = u.unseen
      keep('unseen', prefs.unseen)
    }
    // A closed session needs no pin nor hide mark any more.
    for (const e of states) {
      if (e.state !== 'closed') continue
      if (prefs.pinned.delete(e.sessionId)) keep('pinned', prefs.pinned)
      if (prefs.hidden.delete(e.sessionId)) keep('hidden', prefs.hidden)
    }
    view = buildView(states, now, readPlanFile(), codexLimit)
    sessions = buildSessions(states, now, prefs)
    const n = sessions.waiting
    panel.badge(n > 0 ? { value: n, tooltip: t.bar.waiting(n) } : undefined)
    bar.text = barText(view, { waiting: n, muted: muted() })
    bar.tooltip = new vscode.MarkdownString(barTooltip(view, { waiting: n, running: sessions.running, unseen: sessions.unseen, ...(muted() ? { mutedUntil } : {}) }))
    bar.backgroundColor = n > 0 || (view.fiveHour?.percent ?? 0) >= 90 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
    panel.show(view, sessions, readChannel())
    const fresh = alerts(view, sent)
    for (const a of fresh) {
      sent.add(a.key)
      // While muted, the event is recorded without a notification: it will not come back afterwards.
      if (!muted()) notify(a.message, a.severe, a.sessionId === undefined ? undefined : states.find(e => e.sessionId === a.sessionId))
    }
    if (fresh.length > 0) void g.update('alerts', [...sent].slice(-200))
    void vscode.commands.executeCommand('setContext', 'twingauge.muted', muted())
    void vscode.commands.executeCommand('setContext', 'twingauge.showHidden', prefs.showHidden)
    void vscode.commands.executeCommand('setContext', 'twingauge.hasHidden', sessions.hidden > 0 || prefs.showHidden)
  }
  panel.onReady = () => {
    if (view !== undefined) panel.show(view, sessions, readChannel())
  }
  let slow = 0
  panel.onMeasure = (ms, detail) => {
    if (ms > 50 && slow++ < 20) log.warn(`panel redrawn in ${ms.toFixed(1)} ms (target: under 50 ms) · ${detail}`)
  }
  panel.onOpen = (engine, id) => {
    if (prefs.unseen.delete(id)) keep('unseen', prefs.unseen)
    void open(engine, id)
    refresh()
  }

  let seenTimer: NodeJS.Timeout | undefined
  panel.onVisibility = visible => {
    if (seenTimer !== undefined) clearTimeout(seenTimer)
    if (!visible || prefs.unseen.size === 0) return
    seenTimer = setTimeout(() => {
      prefs.unseen = new Set()
      keep('unseen', prefs.unseen)
      refresh()
    }, SEEN_MS)
  }

  // A right-click in the panel passes the row's context (data-vscode-context): its id and engine.
  type Target = { id: string; engine: Engine }
  const targetOf = (x: unknown): Target | undefined => {
    const c = x as { webviewSection?: unknown; id?: unknown; engine?: unknown } | null
    if (typeof c !== 'object' || c === null || c.webviewSection !== 'session' || typeof c.id !== 'string') return undefined
    return { id: c.id, engine: c.engine === 'codex' ? 'codex' : 'claude' }
  }
  const gesture = (id: string, f: (x: Target) => void): vscode.Disposable =>
    vscode.commands.registerCommand(id, (x: unknown) => {
      const target = targetOf(x)
      if (target === undefined) return
      f(target)
      refresh()
    })
  let muteTimer: NodeJS.Timeout | undefined
  const armMute = (): void => {
    if (muteTimer !== undefined) clearTimeout(muteTimer)
    if (muted()) muteTimer = setTimeout(refresh, mutedUntil - Date.now() + 100)
  }
  armMute()
  ctx.subscriptions.push(
    gesture('twingauge.open', x => {
      if (prefs.unseen.delete(x.id)) keep('unseen', prefs.unseen)
      void open(x.engine, x.id)
    }),
    gesture('twingauge.pin', x => {
      prefs.pinned.add(x.id)
      keep('pinned', prefs.pinned)
    }),
    gesture('twingauge.unpin', x => {
      prefs.pinned.delete(x.id)
      keep('pinned', prefs.pinned)
    }),
    gesture('twingauge.hide', x => {
      prefs.hidden.add(x.id)
      keep('hidden', prefs.hidden)
    }),
    gesture('twingauge.unhide', x => {
      prefs.hidden.delete(x.id)
      keep('hidden', prefs.hidden)
    }),
    vscode.commands.registerCommand('twingauge.showHidden', () => {
      prefs.showHidden = true
      refresh()
    }),
    vscode.commands.registerCommand('twingauge.hideHidden', () => {
      prefs.showHidden = false
      refresh()
    }),
    vscode.commands.registerCommand('twingauge.mute', () => {
      mutedUntil = Date.now() + MUTE_MS
      void g.update('mutedUntil', mutedUntil)
      armMute()
      refresh()
    }),
    vscode.commands.registerCommand('twingauge.unmute', () => {
      mutedUntil = 0
      void g.update('mutedUntil', 0)
      armMute()
      refresh()
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('twingauge.channelFolder')) {
        watchChannel()
        refresh()
      }
    }),
  )

  // The files are watched, plus a 10 s tick for durations and missed events.
  for (const d of [CLAUDE_DIR, CODEX_DIR]) fs.mkdirSync(d, { recursive: true })
  prune()
  let soonTimer: NodeJS.Timeout | undefined
  const soon = (): void => {
    if (soonTimer !== undefined) clearTimeout(soonTimer)
    soonTimer = setTimeout(refresh, 250)
  }
  const watchers: fs.FSWatcher[] = []
  const watch = (d: string): void => {
    try {
      watchers.push(fs.watch(d, soon))
    } catch {
      // Watching unavailable: the 10 s tick takes over.
    }
  }
  for (const d of [CLAUDE_DIR, CODEX_DIR, ROOT]) watch(d)
  // The channel folders change with the settings, the workspace and "Create agent channel": watched apart.
  let channelWatchers: fs.FSWatcher[] = []
  const watchChannel = (): void => {
    for (const w of channelWatchers) w.close()
    channelWatchers = []
    const c = channelFolder()
    for (const side of c === undefined ? [] : ['claude', 'codex']) {
      try {
        channelWatchers.push(fs.watch(path.join(c as string, side), soon))
      } catch {
        // The 10 s tick takes over.
      }
    }
  }
  watchChannel()
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      watchChannel()
      refresh()
    }),
    vscode.commands.registerCommand('twingauge.createChannel', async () => {
      const folder = vscode.workspace.workspaceFolders?.length === 1
        ? vscode.workspace.workspaceFolders[0]
        : await vscode.window.showWorkspaceFolderPick()
      if (folder === undefined) {
        if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) void vscode.window.showWarningMessage(t.channelNoFolder)
        return
      }
      // Only in a trusted workspace; a channel the repository already ships is registered only on explicit consent.
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage(t.channelUntrusted)
        return
      }
      const d = path.join(folder.uri.fsPath, CHANNEL_DIR)
      if (isChannel(d)) {
        const n = messageCount(d)
        const choice = await vscode.window.showWarningMessage(t.channelConfirm(folder.name, n), { modal: true }, t.channelRegister)
        if (choice !== t.channelRegister) return
      }
      const result = createChannel(folder.uri.fsPath)
      if (result === 'refused') {
        void vscode.window.showErrorMessage(t.channelRefused(folder.name))
        return
      }
      void vscode.window.showInformationMessage(result === 'created' ? t.channelCreated(folder.name) : t.channelExists(folder.name))
      watchChannel()
      refresh()
      void vscode.window.showTextDocument(vscode.Uri.file(path.join(d, 'README.md')), { preview: true })
    }),
  )
  const tick = setInterval(refresh, TICK_MS)

  // Codex, read by Codex itself: its limit and its thread list. The extension opens nothing under ~/.codex.
  const onLimit = (l: CodexLimit | undefined): void => {
    if (l === undefined) log.warn('Codex limit: reading failed or the Codex engine stopped')
    codexLimit = l ?? { ...(codexLimit ?? { readAt: Date.now(), windows: [] }), error: t.codexUnreachable }
    void g.update('codexLimit', codexLimit)
    refresh()
  }
  let lastThreads = ''
  const onThreads = (f: CodexThread[]): void => {
    const k = JSON.stringify(f)
    if (k === lastThreads) return
    lastThreads = k
    threads = f
    log.info(`Codex list: ${f.length} threads, ${f.filter(x => Date.now() - x.updatedAt <= 2 * 3600_000).length} active in the last 2 h`)
    refresh()
  }
  let engine: CodexEngine | undefined
  const firstCodex = setTimeout(() => {
    const bin = codexBinary()
    if (bin === undefined) {
      log.info('Codex not found: Codex limits and sessions are not shown')
      return
    }
    log.info(`Codex engine: ${bin}`)
    engine = new CodexEngine(bin, onLimit, onThreads)
    engine.start()
  }, CODEX_FIRST_MS)
  ctx.subscriptions.push({
    dispose: () => {
      for (const w of [...watchers, ...channelWatchers]) w.close()
      clearInterval(tick)
      clearTimeout(firstCodex)
      engine?.stop()
      log.dispose()
      for (const x of [soonTimer, seenTimer, muteTimer]) if (x !== undefined) clearTimeout(x)
    },
  })
  refresh()
}

export function deactivate(): void {}

function readFolder(d: string, engine: Engine): SessionState[] {
  const out: SessionState[] = []
  let names: string[] = []
  try {
    names = fs.readdirSync(d).filter(n => n.endsWith('.json'))
  } catch {
    return out
  }
  for (const n of names) {
    try {
      const e = readState(fs.readFileSync(path.join(d, n), 'utf8'))
      if (e !== undefined) out.push(engine === 'codex' ? { ...e, engine: 'codex' } : e)
    } catch {
      // File being written: read again on the next pass.
    }
  }
  return out
}

/** Claude, Codex through its hook, then Codex through its list for sessions the hook does not see. */
function readAll(threads: readonly CodexThread[]): SessionState[] {
  const hooked = readFolder(CODEX_DIR, 'codex')
  return [...readFolder(CLAUDE_DIR, 'claude'), ...hooked, ...statesFromThreads(threads, new Set(hooked.map(e => e.sessionId)), Date.now())]
}

const CHANNEL_DIR = path.join('.twingauge', 'channel')
const REGISTRY = path.join(ROOT, 'channels.json')
/** A real folder, not a link: nothing in a repository may redirect the channel elsewhere. */
function realDir(p: string): boolean {
  try {
    return fs.lstatSync(p).isDirectory()
  } catch {
    return false
  }
}
/** `.twingauge/channel` with its two sides, every component a real folder. */
const isChannel = (d: string): boolean => realDir(path.dirname(d)) && realDir(d) && realDir(path.join(d, 'claude')) && realDir(path.join(d, 'codex'))

/** The channels registered on this machine (docs/CHANNEL.md): the only ones the panel, the plugin and the hook use. */
function registeredChannels(): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as { channels?: unknown }
    return Array.isArray(j.channels) ? j.channels.filter((x): x is string => typeof x === 'string').map(realPath) : []
  } catch {
    return []
  }
}

/** Links resolved and the disk's own case, as the engines report a session's working directory (on macOS /tmp is /private/tmp). */
function realPath(p: string): string {
  try {
    return fs.realpathSync.native(p)
  } catch {
    return path.normalize(p)
  }
}

function registerChannel(d: string): void {
  const all = registeredChannels()
  if (!all.includes(realPath(d))) all.push(realPath(d))
  fs.mkdirSync(ROOT, { recursive: true })
  const tmp = `${REGISTRY}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ v: 1, channels: all }, null, 2)}\n`)
  fs.renameSync(tmp, REGISTRY)
}

/** The agent channel: the setting if given (an explicit choice), otherwise a registered `.twingauge/channel` of the workspace. */
function channelFolder(): string | undefined {
  const setting = vscode.workspace.getConfiguration('twingauge').get<string>('channelFolder', '').trim()
  const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
  if (setting !== '') {
    const d = path.isAbsolute(setting) ? setting : folders[0] === undefined ? undefined : path.join(folders[0], setting)
    return d !== undefined && isChannel(d) ? d : undefined
  }
  const registered = registeredChannels()
  return folders.map(f => path.join(f, CHANNEL_DIR)).find(d => registered.includes(realPath(d)) && isChannel(d))
}

/**
 * Creates the channel, its protocol file and registers it. Refuses when any component is a link (a repository
 * could redirect the writes elsewhere). Existing files are kept. Returns 'created', 'existed' or 'refused'.
 */
function createChannel(root: string): 'created' | 'existed' | 'refused' {
  const d = path.join(root, CHANNEL_DIR)
  const parts = [path.dirname(d), d, ...['claude', 'codex', '.state', 'README.md', '.gitignore'].map(n => path.join(d, n))]
  for (const p of parts) {
    try {
      if (fs.lstatSync(p).isSymbolicLink()) return 'refused'
    } catch {
      // Absent: created below.
    }
  }
  const existed = isChannel(d)
  for (const side of ['claude', 'codex', '.state']) fs.mkdirSync(path.join(d, side), { recursive: true })
  const put = (name: string, text: string): void => {
    const p = path.join(d, name)
    if (!fs.existsSync(p)) fs.writeFileSync(p, text)
  }
  put('README.md', CHANNEL_README)
  put('.gitignore', '.state/\n')
  registerChannel(d)
  return existed ? 'existed' : 'created'
}

/** Message files already in a channel folder, both sides: what registering it would announce. */
function messageCount(d: string): number {
  let n = 0
  for (const side of ['claude', 'codex']) {
    try {
      n += fs.readdirSync(path.join(d, side)).filter(x => MESSAGE_NAME.test(x)).length
    } catch {
      // No such side yet.
    }
  }
  return n
}

/** File names only: the panel never opens a message body itself. */
function readChannel(): Channel | undefined {
  const d = channelFolder()
  if (d === undefined) return undefined
  const msgs: ChannelMessage[] = []
  for (const side of ['claude', 'codex'] as const) {
    try {
      // Regular files only: a link planted in a shared repository is never followed.
      for (const f of fs.readdirSync(path.join(d, side), { withFileTypes: true })) {
        const m = f.isFile() && !f.isSymbolicLink() ? readMessageName(side, f.name) : undefined
        if (m !== undefined) msgs.push(m)
      }
    } catch {
      // Unreadable folder: the channel shows as empty.
    }
  }
  return buildChannel(msgs, Date.now())
}

async function openMessage(id: string): Promise<void> {
  const d = channelFolder()
  const [side, name] = id.split('/')
  if (d === undefined || (side !== 'claude' && side !== 'codex') || name === undefined || !MESSAGE_NAME.test(name)) return
  const file = path.join(d, side, name)
  try {
    if (!fs.lstatSync(file).isFile()) return
  } catch {
    return // gone meanwhile
  }
  await vscode.window.showTextDocument(vscode.Uri.file(path.join(d, side, name)), { preview: true })
}

function readPlanFile(): ReturnType<typeof readPlan> {
  try {
    return readPlan(fs.readFileSync(PLAN, 'utf8'))
  } catch {
    return undefined
  }
}

/** Session files older than seven days serve no purpose any more. */
function prune(): void {
  for (const d of [CLAUDE_DIR, CODEX_DIR]) {
    try {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n)
        if (n.endsWith('.json') && Date.now() - fs.statSync(p).mtimeMs > KEEP_MS) fs.unlinkSync(p)
      }
    } catch {
      // Pruning is optional.
    }
  }
}

/** The Codex binary: the one shipped with the Codex extension first, then a `codex` on the PATH. */
function codexBinary(): string | undefined {
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const ext = vscode.extensions.getExtension('openai.chatgpt')?.extensionPath
  if (ext !== undefined) {
    const bin = path.join(ext, 'bin')
    try {
      for (const platform of fs.readdirSync(bin)) {
        const c = path.join(bin, platform, exe)
        if (fs.existsSync(c)) return c
      }
    } catch {
      // No bin folder in this version of the Codex extension: try the PATH.
    }
  }
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) {
    const c = path.join(d, exe)
    if (d !== '' && fs.existsSync(c)) return c
  }
  return undefined
}

async function open(engine: Engine, id: string): Promise<void> {
  if (engine === 'codex') {
    await vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme}://openai.chatgpt/local/${encodeURIComponent(id)}`))
    return
  }
  try {
    await vscode.commands.executeCommand('claude-vscode.primaryEditor.open', id)
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme}://anthropic.claude-code/open?session=${encodeURIComponent(id)}`))
  }
}

function notify(message: string, severe: boolean, e?: SessionState): void {
  const buttons = e === undefined ? [] : [t.alert.open]
  const shown = severe ? vscode.window.showErrorMessage(message, ...buttons) : vscode.window.showWarningMessage(message, ...buttons)
  void shown.then(choice => {
    if (choice === t.alert.open && e !== undefined) void open(e.engine === 'codex' ? 'codex' : 'claude', e.sessionId)
  })
}

/** The panel: limits, sessions, agents and today's usage, drawn in one webview. */
class Panel implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined
  private lastBadge: vscode.ViewBadge | undefined
  onReady: () => void = () => {}
  onVisibility: (visible: boolean) => void = () => {}
  onOpen: (engine: Engine, id: string) => void = () => {}
  onMeasure: (ms: number, detail: string) => void = () => {}

  constructor(private readonly root: vscode.Uri) {}

  get visible(): boolean {
    return this.view?.visible ?? false
  }

  /** The badge on the TwinGauge icon: the sessions waiting for you. */
  badge(b: vscode.ViewBadge | undefined): void {
    this.lastBadge = b
    if (this.view !== undefined) this.view.badge = b
  }

  resolveWebviewView(v: vscode.WebviewView): void {
    this.view = v
    v.badge = this.lastBadge
    v.onDidChangeVisibility(() => this.onVisibility(v.visible))
    const media = vscode.Uri.joinPath(this.root, 'media')
    v.webview.options = { enableScripts: true, localResourceRoots: [media] }
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
    const css = v.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css'))
    const js = v.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js'))
    v.webview.html = `<!doctype html><html lang="${vscode.env.language}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${v.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css.toString()}"></head>
<body><div id="app" aria-live="polite"></div><script nonce="${nonce}" src="${js.toString()}"></script></body></html>`
    v.webview.onDidReceiveMessage((m: { type?: string; engine?: Engine; id?: string; ms?: number; detail?: string }) => {
      if (m.type === 'ready') this.onReady()
      if (m.type === 'measure' && typeof m.ms === 'number') this.onMeasure(m.ms, String(m.detail ?? ''))
      if (m.type === 'message' && typeof m.id === 'string') void openMessage(m.id)
      if (m.type === 'open' && typeof m.id === 'string') this.onOpen(m.engine === 'codex' ? 'codex' : 'claude', m.id)
    })
  }

  show(view: View, sessions?: Sessions, channel?: Channel): void {
    void this.view?.webview.postMessage({ type: 'view', view, sessions, channel, strings: webviewStrings() })
  }
}
