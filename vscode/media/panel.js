// TwinGauge panel: draws what the extension computes, nothing more. Every word comes from the extension
// (`strings`), already in the user's language.
;(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage() {}, getState() {}, setState() {} }
  const app = document.getElementById('app')
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const clamp = p => Math.max(0, Math.min(100, Number(p) || 0))
  const anchor = x => (x > 0.82 ? 'end' : x < 0.18 ? 'start' : 'middle')
  let state = (vscode.getState && vscode.getState()) || {}
  let last = ''
  let S = {}

  // TwinGauge's own line icons, drawn on a 16×16 grid (MIT, like the rest of the project).
  const ICONS = {
    question: '<circle cx="8" cy="8" r="6.25"/><path d="M6.1 6.3a2 2 0 1 1 2.7 1.9c-.5.2-.8.6-.8 1.1v.5"/><circle class="dot" cx="8" cy="11.5" r=".7"/>',
    shield: '<path d="M8 1.75l5.25 2v3.9c0 3.2-2.2 5.6-5.25 6.6-3.05-1-5.25-3.4-5.25-6.6v-3.9z"/><path d="M5.9 8.1l1.5 1.5 2.8-3"/>',
    pulse: '<path d="M1.5 8.5h2.8l1.6-4.2 3.1 8 1.6-3.8h3.9"/>',
    done: '<circle cx="8" cy="8" r="6.25"/><path d="M5.2 8.2l2 2 3.7-4"/>',
    idle: '<path d="M12.9 10.1A5.6 5.6 0 0 1 5.9 3.1a5.6 5.6 0 1 0 7 7z"/>',
    agent: '<rect x="3" y="5.25" width="10" height="8" rx="2.25"/><path d="M8 2.5v2.75"/><circle class="dot" cx="6.1" cy="9.25" r=".8"/><circle class="dot" cx="9.9" cy="9.25" r=".8"/>',
    warning: '<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.4v3.4"/><circle class="dot" cx="8" cy="11.6" r=".7"/>',
    flame: '<path d="M8 14.4c-2.7 0-4.4-1.8-4.4-4.2 0-2.6 2-3.8 2.6-6.6 1.4 1 2.1 2.4 2.1 3.6.6-.4 1-1.2 1.1-2 1.5 1.2 3 3 3 5 0 2.4-1.7 4.2-4.4 4.2z"/>',
    'circle-slash': '<circle cx="8" cy="8" r="6.25"/><path d="M3.6 12.4l8.8-8.8"/>',
    watch: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.6V8l2.3 1.5"/>',
    pin: '<path d="M9.6 1.9l4.5 4.5-1.9.7-2.3 2.3.3 3-1 1L2.6 6.8l1-1 3 .3 2.3-2.3z"/><path d="M5.6 10.4L2 14"/>',
  }
  const TONE = { 'charts.orange': 'orange', 'charts.red': 'red', 'charts.green': 'green', 'charts.blue': 'blue' }

  // A meaningful icon: the shape carries the meaning, the colour doubles it, screen readers read it.
  function icon(i, meaning) {
    if (!i || !ICONS[i.id]) return ''
    const m = meaning || (S.meaning && S.meaning[i.id]) || ''
    return `<svg class="ico tone-text-${TONE[i.color] || 'grey'}" viewBox="0 0 16 16" role="img" aria-label="${esc(m)}"><title>${esc(m)}</title>${ICONS[i.id]}</svg>`
  }

  // Each engine's sign, readable without colour: a four-point star for Claude, a hexagon for Codex.
  function sign(engine) {
    return engine === 'codex'
      ? '<svg class="sign codex" viewBox="0 0 10 10" aria-label="Codex" role="img"><polygon points="5,0.6 9,2.8 9,7.2 5,9.4 1,7.2 1,2.8"/></svg>'
      : '<svg class="sign claude" viewBox="0 0 10 10" aria-label="Claude" role="img"><path d="M5 0.5 Q5 5 9.5 5 Q5 5 5 9.5 Q5 5 0.5 5 Q5 5 5 0.5 z"/></svg>'
  }

  function chart(c) {
    const W = 1000
    const H = 100
    const pts = c.points.map(([x, p]) => `${(x * W).toFixed(1)},${(H - clamp(p)).toFixed(1)}`)
    const first = c.points[0]
    const lastPt = c.points[c.points.length - 1]
    const area = pts.length > 1 ? `<polygon class="area" points="${(first[0] * W).toFixed(1)},${H} ${pts.join(' ')} ${(lastPt[0] * W).toFixed(1)},${H}"/>` : ''
    const line = pts.length > 1 ? `<polyline class="line" points="${pts.join(' ')}"/>` : ''
    const nx = c.nowX * W
    const ny = H - clamp(c.percent)
    const fc = c.forecast ? `<line class="forecast" x1="${nx}" y1="${ny}" x2="${(c.forecast.x * W).toFixed(1)}" y2="0"/>` : ''
    // Two label rows: the forecast above, "now" below, never overlapping.
    const fcRow = c.forecast ? `<div class="labels"><span class="tone-text-orange ${anchor(c.forecast.x)}" style="left:${c.forecast.x * 100}%" title="${esc(S.forecastTip)}">${esc(c.forecast.text)}</span></div>` : ''
    return `<div class="chart" title="${esc(c.source)}">
  ${fcRow}<div class="labels"><span class="${anchor(c.nowX)}" style="left:${c.nowX * 100}%">${esc(c.nowText)}</span></div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(c.sentence)}">
    <rect class="elapsed" x="0" y="0" width="${nx}" height="${H}"/>
    <line class="hundred" x1="0" y1="1" x2="${W}" y2="1"/>
    ${area}${line}${fc}
    <line class="now" x1="${nx}" y1="0" x2="${nx}" y2="${H}"/>
  </svg>
  <div class="axis"><span class="start" style="left:0">${esc(c.startText)}</span><span class="end" style="left:100%">${esc(c.resetText)}</span></div>
</div>
<p class="sentence ${c.forecast ? 'tone-text-orange' : 'muted'}">${c.forecast ? icon({ id: 'watch', color: 'charts.orange' }) : ''}${esc(c.sentence)}</p>`
  }

  function limitRow(l) {
    // The tick marks the elapsed share of the window: a bar past it is using faster than time.
    const tick = l.pace ? `<span class="tick" style="left:${(l.pace.elapsed * 100).toFixed(1)}%"></span>` : ''
    const track = `<span class="track" role="img" aria-label="${clamp(l.percent)}%"><span class="fill tone-${l.tone}" style="width:${clamp(l.percent)}%"></span>${tick}</span>`
    // The pace shows only when it warns; otherwise it stays in the tooltip.
    const p = l.pace && l.pace.tone === 'orange' ? `<p class="pace small tone-text-orange">${esc(l.pace.text)}</p>` : ''
    const title = l.pace ? `${l.source} ${l.paceTitle || ''}` : l.source
    return `<div class="limit" title="${esc(title)}">${sign(l.engine)}<span class="name">${esc(l.name)}</span>${track}<span class="num">${esc(l.text)}</span>${icon(l.icon, l.word)}</div>${p}`
  }

  const CTX_SHADES = ['var(--claude)', 'color-mix(in srgb, var(--claude) 55%, black)', 'color-mix(in srgb, var(--claude) 55%, var(--text))', 'var(--green)', 'var(--codex)', 'var(--grey)']
  function context(c) {
    if (!c || !c.total) return ''
    const used = c.categories.filter(x => x.kind === 'used')
    const segs = c.categories.map((x, i) => {
      const bg = x.kind === 'free' ? 'var(--track)' : x.kind === 'buffer' ? 'repeating-linear-gradient(45deg, var(--grey) 0 2px, transparent 2px 5px)' : CTX_SHADES[i % CTX_SHADES.length]
      return `<span class="seg" style="width:${((x.tokens / c.total) * 100).toFixed(2)}%;background:${bg}" title="${esc(x.name)} · ${shortTokens(x.tokens)}"></span>`
    }).join('')
    const legend = used.map(x => `<span class="item"><span class="swatch" style="background:${CTX_SHADES[c.categories.indexOf(x) % CTX_SHADES.length]}"></span>${esc(x.name)} ${shortTokens(x.tokens)}</span>`).join('')
    const busy = used.reduce((s, x) => s + x.tokens, 0)
    return section('context', `${esc(S.context)} · ${esc(c.project)}`, esc(S.used(pc((busy / c.total) * 100))), `<div class="ctx" role="img" aria-label="${esc(S.contextAria)}">${segs}</div><p class="legend small">${legend}</p>`, false)
  }

  // One histogram per engine, each on its own scale: Codex must not flatten Claude. Each bar stacks its models.
  function histogram(v, engine) {
    const total = v.hours.reduce((s, h) => s + h[engine], 0)
    if (total === 0 && !v.hours.some(h => h.models[engine].some(x => x.read))) return ''
    const full = h => h[engine] + h.models[engine].reduce((s, x) => s + x.read, 0)
    const max = Math.max(1, ...v.hours.map(full))
    const names = [...new Set(v.hours.flatMap(h => h.models[engine].map(x => x.name)))]
    const bars = v.hours.map(h => {
      // Per model: the solid part is fresh, the hatched part read from the cache.
      const seg = h.future ? '' : h.models[engine].slice().reverse().map(x => {
        const c = shade(engine, x.name)
        const read = x.read ? `<span class="b" style="height:${(x.read / max) * 100}%;background:repeating-linear-gradient(45deg, ${c} 0 2px, transparent 2px 4px)"></span>` : ''
        return read + `<span class="b" style="height:${(x.n / max) * 100}%;background:${c}"></span>`
      }).join('')
      const title = `${h.label}h · ` + (h.models[engine].map(x => `${x.name}: ${shortTokens(x.n)} ${S.fresh}${x.read ? `, ${shortTokens(x.read)} ${S.readFromCache}` : ''}`).join(' · ') || S.nothing)
      return `<div class="h${h.future ? ' future' : ''}${h.current ? ' current' : ''}" title="${esc(title)}"><span class="col">${seg || '<span class="b empty"></span>'}</span><span class="lab">${esc(h.label)}</span></div>`
    }).join('')
    const legend = names.map(n => `<span class="item"><span class="swatch" style="background:${shade(engine, n)}"></span>${esc(n)}</span>`).join('')
    const hasCache = v.hours.some(h => h.models[engine].some(x => x.read > 0))
    const key = hasCache ? `<p class="legend small muted"><span class="item"><span class="swatch" style="background:var(--grey)"></span>${esc(S.legendFresh)}</span><span class="item"><span class="swatch" style="background:repeating-linear-gradient(45deg, var(--grey) 0 2px, transparent 2px 4px)"></span>${esc(S.legendCache)}</span></p>` : ''
    return `<p class="histo-title"><span class="with-sign">${sign(engine)}${engine === 'codex' ? 'Codex' : 'Claude Code'}</span> <span class="num muted">${shortTokens(total)} · ${esc(S.maxPerHour(shortTokens(max)))}</span></p><p class="legend small">${legend}</p>${key}<div class="hours" role="img" aria-label="${esc(S.tokensPerHour)}, ${engine}">${bars}</div>`
  }
  // Numbers in the user's language: `1.9M`, `42%` in English; `1,9 M`, `42 %` in French.
  function shortTokens(n) {
    const sp = S.lang === 'fr' ? ' ' : ''
    const dec = x => (S.lang === 'fr' ? x.replace('.', ',') : x)
    return n >= 1e6 ? dec((n / 1e6).toFixed(1)) + sp + 'M' : n >= 1e3 ? Math.round(n / 1e3) + sp + 'k' : String(n)
  }
  const pc = p => Math.round(p) + (S.lang === 'fr' ? ' %' : '%')
  // Today's cache ring, then the detail in tokens; no invented amount.
  function ring(c) {
    if (!c) return ''
    const r = 26, len = 2 * Math.PI * r, p = clamp(c.percent)
    const row = (color, name, n) => `<li><span><span class="swatch" style="background:${color}"></span> ${esc(name)}</span><span class="num">${shortTokens(n)}</span></li>`
    return `<div class="ring" title="${esc(S.cacheTip)}">
      <svg viewBox="0 0 70 70" role="img" aria-label="${esc(S.cacheRing(pc(p)))}"><circle cx="35" cy="35" r="${r}" fill="none" stroke="var(--track)" stroke-width="8"/>
      <circle cx="35" cy="35" r="${r}" fill="none" stroke="var(--claude)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(len * p / 100).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 35 35)"/>
      <text x="35" y="39" text-anchor="middle" class="ring-pc">${pc(p)}</text></svg>
      <div><p class="small"><b>${esc(S.cacheToday)}</b></p><ul class="usage">${row('var(--claude)', S.cacheRead, c.read)}${row('color-mix(in srgb, var(--claude) 55%, var(--red))', S.cacheWritten, c.created)}${row('var(--grey)', S.cacheFresh, c.fresh)}</ul></div></div>`
  }

  // One fixed, clearly distinct shade per model family, within its engine's colour: orange for Claude, purple
  // for Codex. An unknown model gets one from its name.
  function shade(engine, model) {
    const base = `var(--${engine === 'codex' ? 'codex' : 'claude'})`
    const families = [[/opus|astra/i, 0], [/fable|codex/i, 1], [/sonnet/i, 2], [/haiku|mini/i, 3]]
    let rank = (families.find(([re]) => re.test(String(model || ''))) || [])[1]
    if (rank === undefined) {
      let h = 0
      for (const c of String(model || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
      rank = h % 4
    }
    const neighbour = engine === 'codex' ? 'var(--vscode-charts-blue, #4daafc)' : 'var(--red)'
    return [base, `color-mix(in srgb, ${base} 55%, ${neighbour})`, `color-mix(in srgb, ${base} 55%, var(--text))`, `color-mix(in srgb, ${base} 30%, var(--text))`][rank]
  }

  function chip(engine, model) {
    return model ? `<span class="model" style="color:${shade(engine, model)};border-color:${shade(engine, model)}">${esc(model)}</span>` : ''
  }

  function sessionRow(l) {
    const agent = (a, depth) => `<li class="agent" style="padding-left:${12 + 14 * depth}px">${icon(a.icon, a.running ? S.agentRunning : S.agent)}<span class="name">${esc(a.label)}</span>${chip(a.engine, a.model)}<span class="desc">${esc(a.model && a.description.startsWith(a.model + ' · ') ? a.description.slice(a.model.length + 3) : a.description)}</span></li>` + (a.children || []).map(c => agent(c, depth + 1)).join('')
    const agents = l.agents.map(a => agent(a, 1)).join('')
    // The right-click menu is VS Code's own (webview/context): it reads this context to pin or hide.
    const menu = esc(JSON.stringify({ webviewSection: 'session', id: l.id, engine: l.engine, pinned: l.pinned, hidden: l.hidden, preventDefaultContextMenuItems: true }))
    const pin = l.pinned ? `<svg class="ico pin-mark" viewBox="0 0 16 16" role="img" aria-label="${esc(S.pinned)}"><title>${esc(S.pinned)}</title>${ICONS.pin}</svg>` : ''
    // Two lines: who and which model, then the figures (never cut) and what it does (cut first).
    return `<li class="session ${l.engine}${l.hidden ? ' hidden-row' : ''}" tabindex="0" role="button" data-engine="${l.engine}" data-id="${esc(l.id)}" data-vscode-context="${menu}" title="${esc(l.tooltip.join(' · ').replace(/\*\*/g, ''))}"><span class="l1">${icon(l.icon, S.groups ? S.groups[l.group] : '')}${sign(l.engine)}<span class="name">${esc(l.project)}</span>${pin}${chip(l.engine, l.model)}</span><span class="l2">${l.figures ? `<span class="num">${esc(l.figures)}</span>` : ''}<span class="desc">${esc(l.doing)}</span></span></li>${agents ? `<ul class="agents">${agents}</ul>` : ''}`
  }

  function sessions(s) {
    if (!s) return ''
    const groups = s.groups.filter(g => g.rows.length)
    if (!groups.length) return section('sessions', S.sessions, S.none, `<p class="muted">${esc(S.noSession)}</p>`, true)
    const n = groups.reduce((x, g) => x + g.rows.length, 0)
    const summary = `${n}${s.waiting ? ` · ${S.waitingCount(s.waiting)}` : ''}${s.hidden ? ` · ${S.hiddenCount(s.hidden)}` : ''}`
    return section('sessions', S.sessions, esc(summary), groups.map(g => `<p class="group">${esc(g.title)} · ${g.rows.length}</p><ul class="sessions">${g.rows.map(sessionRow).join('')}</ul>`).join(''), true)
  }

  function channel(c) {
    if (!c) return ''
    const rows = c.latest.map(m => `<li class="message" tabindex="0" role="button" data-id="${esc(m.side + '/' + m.name)}" title="${esc(S.openMessage)}"><span class="side ${m.side}">${sign(m.side)}${m.side === 'codex' ? 'Codex' : 'Claude'}</span><span class="kind">${esc(m.kind)}</span><span class="desc">${esc(m.subject)}</span><span class="num muted">${esc(m.time)}</span></li>`).join('')
    return section('channel', S.channel, esc(c.text), `<ul class="sessions">${rows}</ul>`, false)
  }

  // A collapsible section whose open/closed state is remembered between redraws.
  function section(key, title, summary, content, openByDefault) {
    const opened = state.opened || {}
    const open = key in opened ? opened[key] : openByDefault
    return `<details class="block" data-key="${key}"${open ? ' open' : ''}><summary><span class="section">${title}</span><span class="small muted summary">${summary}</span></summary>${content}</details>`
  }

  function render(v, s, c) {
    const t0 = performance.now()
    const p = []
    // The 5-hour chart earns its place only when it tells something: a forecast, or notable use.
    const f = v.fiveHour
    if (f && (f.forecast || f.percent >= 20)) {
      p.push(`<div class="title">${sign('claude')}<b>${esc(S.fiveHourWindow)}</b><span class="num title-end">${esc(f.text)}</span>${icon(f.icon)}</div>`)
      p.push(chart(f))
    } else if (f) {
      p.push(limitRow({ engine: 'claude', name: S.fiveHours, percent: f.percent, tone: f.tone, text: `${f.text} · ${f.resetText}`, word: '', source: `${f.source} ${f.sentence}`, icon: f.icon }))
    } else {
      p.push(`<p class="limit muted">${sign('claude')}<span>${esc(v.fiveHourEmpty)}</span></p>`)
    }
    for (const l of v.limitRows) p.push(limitRow({ ...l, paceTitle: l.pace ? S.paceTitle(l.pace.text) : '' }))
    if (v.codex && v.codex.text) p.push(`<p class="limit muted">${sign('codex')}<span>${esc(v.codex.text)}</span></p>`)
    p.push(context(v.context))
    p.push(sessions(s))
    p.push(channel(c))
    const opened = state.opened && 'today' in state.opened ? state.opened.today : false
    p.push(`<details class="today block" data-key="today"${opened ? ' open' : ''}><summary title="${esc(v.today.tooltip)}"><span class="section">${esc(S.today)}</span><span class="num summary">${esc(v.today.text)}</span></summary>${histogram(v, 'claude')}${histogram(v, 'codex')}${
      v.usage.length ? `<ul class="usage">${v.usage.map(u => `<li><span><span class="swatch" style="background:${shade(/^GPT|^o\d/.test(u.name) ? 'codex' : 'claude', u.name)}"></span> ${esc(u.name)}</span><span class="num muted">${esc(u.text)}</span></li>`).join('')}</ul>` : ''
    }${ring(v.cache)}<p class="muted small">${esc(v.agentsSummary)}</p></details>`)
    const foot = v.missing ? v.freshness : v.readings
    if (foot) p.push(`<p class="foot ${v.missing ? 'tone-text-orange' : 'muted'}">${esc(foot)}</p>`)
    const html = p.join('')
    const t1 = performance.now()
    app.innerHTML = html
    const t2 = performance.now()
    for (const li of app.querySelectorAll('li.session')) {
      const go = () => vscode.postMessage({ type: 'open', engine: li.dataset.engine, id: li.dataset.id })
      li.addEventListener('click', go)
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter') go() })
    }
    for (const li of app.querySelectorAll('li.message')) {
      const go = () => vscode.postMessage({ type: 'message', id: li.dataset.id })
      li.addEventListener('click', go)
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter') go() })
    }
    for (const d of app.querySelectorAll('details[data-key]')) {
      d.addEventListener('toggle', () => {
        state = { ...state, opened: { ...(state.opened || {}), [d.dataset.key]: d.open } }
        if (vscode.setState) vscode.setState(state)
      })
    }
    // Redraw time, measured on every render: target under 50 ms.
    const t3 = performance.now()
    document.body.dataset.ms = (t3 - t0).toFixed(1)
    vscode.postMessage({ type: 'measure', ms: t3 - t0, detail: `build ${(t1 - t0).toFixed(1)} · insert ${(t2 - t1).toFixed(1)} · wire ${(t3 - t2).toFixed(1)} ms · ${html.length} chars · ${document.hidden ? 'hidden' : 'visible'}` })
  }

  // Functions do not survive postMessage: the few parameterised strings are rebuilt here from templates.
  function strings(raw) {
    const fill = (tpl, x) => String(tpl).replace('{0}', x)
    return { ...raw, used: x => fill(raw.used, x), waitingCount: x => fill(raw.waitingCount, x), hiddenCount: x => fill(raw.hiddenCount, x), maxPerHour: x => fill(raw.maxPerHour, x), cacheRing: x => fill(raw.cacheRing, x), paceTitle: x => fill(raw.paceTitle, x) }
  }

  window.addEventListener('message', e => {
    if (!e.data || e.data.type !== 'view') return
    // Nothing changed since the last render: no redraw.
    const key = JSON.stringify([e.data.view, e.data.sessions, e.data.channel, e.data.strings])
    if (key === last) return
    last = key
    S = strings(e.data.strings || {})
    render(e.data.view, e.data.sessions, e.data.channel)
  })
  vscode.postMessage({ type: 'ready' })
})()
