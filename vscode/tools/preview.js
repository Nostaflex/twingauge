// Writes preview pages of the panel (dark, light, high contrast) with sample data, for screenshots and design
// checks: `npm run compile && node tools/preview.js` (LANG_UI=fr for French, TENSE=1 for high limits, WIDTH=300).
const fs = require('node:fs')
const path = require('node:path')
const { setLanguage, day, webviewStrings } = require('../out/i18n.js')
const { buildView, buildSessions, buildChannel, readMessageName } = require('../out/model.js')

setLanguage(process.env.LANG_UI || 'en')
const T = (h, m) => new Date(2026, 9, 7, h, m).getTime()
const N = T(12, 10)
const base = { v: 2, cwd: '/w', limitHistory: [], agents: [], day: day(N), doneToday: 0, failedToday: 0, hours: {}, startedAt: T(9, 0), costUsd: null }
const lim = { five_hour: { percent: 42, resetsAt: T(14, 40) }, seven_day: { percent: 18, resetsAt: new Date(2026, 9, 12, 9, 0).getTime() } }
const states = [
  { ...base, sessionId: 'a', project: 'billing-api', model: 'claude-opus-5-5', state: 'waiting', waiting: { kind: 'question', since: N - 180000, text: 'Keep the v1 endpoint?' }, context: { window: 200000, percent: 74 }, costUsd: 0.48, limits: lim, lastActivity: N - 180000, updatedAt: N - 4000 },
  { ...base, sessionId: 'b', project: 'web-app', model: 'claude-fable-5-1[1m]', state: 'working', waiting: null, context: { window: 1000000, percent: 37 }, costUsd: 3.12, limits: lim,
    action: { tool: 'Bash', label: 'Bash: Run the test suite', since: N - 50000 },
    limitHistory: [[T(9, 40), 0], [T(10, 30), 8], [T(11, 10), 15], [T(11, 40), 26], [T(11, 50), 31], [T(12, 0), 37], [T(12, 10), 42]],
    agents: [
      { id: 'x1', type: 'general-purpose', description: 'Review the auth module', status: 'running', startedAt: N - 120000, tokens: 84000 },
      { id: 'x2', parentId: 'x1', type: 'Explore', description: 'Find the callers', status: 'running', startedAt: N - 60000, tokens: 12000, model: 'claude-haiku-4-5-20251001' },
      { id: 'x3', type: 'general-purpose', description: 'Research caching options', status: 'running', startedAt: N - 360000, tokens: 231000 },
    ],
    doneToday: 7, hours: { '2026-10-07T07': 120000, '2026-10-07T08': 340000, '2026-10-07T09': 410000, '2026-10-07T10': 280000, '2026-10-07T11': 520000, '2026-10-07T12': 230000 },
    lastActivity: N - 5000, updatedAt: N - 4000 },
  { ...base, sessionId: 'c', project: 'docs', model: 'claude-sonnet-5-5', state: 'idle', waiting: null, context: { window: 200000, percent: 9 }, costUsd: 0.21, limits: lim, lastActivity: N - 720000, updatedAt: N - 30000,
    lastAction: { tool: 'Edit', label: 'Edit: README.md', since: 0, until: 0 } },
]
states[1].models = { 'claude-fable-5-1': 1700000, 'claude-opus-5-5': 160000 }
states[1].cache = { read: 1520000, input: 1700000, created: 120000, fresh: 60000 }
states[1].hourCache = { '2026-10-07T08': { 'claude-fable-5-1': 900000 }, '2026-10-07T09': { 'claude-fable-5-1': 1300000 }, '2026-10-07T10': { 'claude-fable-5-1': 400000 }, '2026-10-07T11': { 'claude-fable-5-1': 1900000 } }
states[1].contextCategories = [{ name: 'System prompt', tokens: 18000, kind: 'used' }, { name: 'Tools', tokens: 41000, kind: 'used' }, { name: 'Memory', tokens: 22000, kind: 'used' }, { name: 'Messages', tokens: 289000, kind: 'used' }, { name: 'Free space', tokens: 597000, kind: 'free' }, { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' }]
states[2].models = { 'claude-sonnet-5-5': 40000 }
const plan = { v: 2, readAt: N - 120000, breakdown: [{ name: 'Claude Code', percent: 100 }], limits: [
  { key: 'weekly_all', kind: 'weekly_all', percent: 45, severity: 'normal', resetsAt: T(23, 59), active: false },
  { key: 'weekly_scoped:Fable', kind: 'weekly_scoped', percent: 75, severity: 'warning', resetsAt: T(23, 59), model: 'Fable', active: true }] }
const codex = { readAt: N - 300000, plan: 'pro', windows: [{ label: process.env.LANG_UI === 'fr' ? '7 jours' : '7 days', percent: 3, resetsAt: new Date(2026, 9, 14, 12, 6).getTime() }] }
states.push({ ...base, engine: 'codex', sessionId: 'x', project: 'web-app', model: 'gpt-5-codex', state: 'working', waiting: null, context: null, limits: {}, tokens: { total: 400000 },
  action: { tool: 'shell', label: 'Shell: Build the bundle', since: N - 20000 }, hours: { '2026-10-07T11': 300000, '2026-10-07T12': 100000 }, models: { 'gpt-5-codex': 400000 }, lastActivity: N - 5000, updatedAt: N - 3000 })
// TENSE=1: high limits, to see the flame and no-entry icons.
if (process.env.TENSE) {
  plan.limits[1].percent = 93
  codex.windows[0].percent = 100
}
const view = buildView(states, N, plan, codex)
const channel = process.env.CHANNEL ? buildChannel([readMessageName('claude', '20261007T101000Z-ack-handover.md'), readMessageName('codex', '20261007T094000Z-request-final-review.md'), readMessageName('codex', '20261007T093000Z-response-resume.md')], N) : undefined
const sessions = buildSessions(states, N, { pinned: new Set(['c']), hidden: new Set(), unseen: new Set(), showHidden: false })
const themes = {
  dark: { body: 'vscode-dark', bg: '#181818', v: { foreground: '#cccccc', descriptionForeground: '#9d9d9d', 'charts-green': '#89d185', 'charts-orange': '#d18616', 'charts-red': '#f14c4c', 'charts-purple': '#b180d7', 'charts-blue': '#4daafc', 'list-hoverBackground': '#2a2d2e', focusBorder: '#0078d4' } },
  light: { body: 'vscode-light', bg: '#f8f8f8', v: { foreground: '#3b3b3b', descriptionForeground: '#717171', 'charts-green': '#388a34', 'charts-orange': '#d18616', 'charts-red': '#e51400', 'charts-purple': '#652d90', 'charts-blue': '#1a85ff', 'list-hoverBackground': '#e8e8e8', focusBorder: '#005fb8' } },
  contrast: { body: 'vscode-high-contrast', bg: '#000000', v: { foreground: '#ffffff', descriptionForeground: '#ffffff', 'charts-green': '#89d185', 'charts-orange': '#d18616', 'charts-red': '#f48771', 'charts-purple': '#b180d7', 'charts-blue': '#75beff', contrastBorder: '#6fc3df', focusBorder: '#f38518' } },
}
const payload = { type: 'view', view, sessions, channel, strings: webviewStrings() }
for (const [name, t] of Object.entries(themes)) {
  const vars = Object.entries(t.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';')
  const html = `<!doctype html><html lang="${process.env.LANG_UI || 'en'}"><head><meta charset="utf-8"><link rel="stylesheet" href="../media/panel.css">
<style>:root{${vars};--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Menlo,monospace}html{background:${t.bg}}body{width:${process.env.WIDTH || 300}px;box-sizing:border-box}</style></head>
<body class="${t.body}"><div id="app"></div><script src="../media/panel.js"></script><script>window.postMessage(${JSON.stringify(payload)}, '*');setTimeout(()=>{const d=document.querySelector('details.today');if(d)d.open=true},50)</script></body></html>`
  fs.writeFileSync(path.join(__dirname, `preview-${name}.html`), html)
}
console.log('ok', Object.keys(themes).join(' '))
