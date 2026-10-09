// Every user-visible string and number format, in English (default) and French.
// No VS Code import: the extension calls setLanguage(vscode.env.language) once, tests call it directly.

export type Lang = 'en' | 'fr'

const en = {
  // Limits
  fiveHours: '5 hours',
  fiveHourWindow: '5-hour window',
  sevenDays: '7 days',
  windowMinutes: (n: number) => `${n} min`,
  windowHours: (n: number) => `${n} h`,
  windowDays: (n: number) => (n === 1 ? '24 h' : `${n} days`),
  reached: 'reached',
  warning: 'warning',
  resets: (when: string) => `resets ${when}`,
  now: (p: string) => `now · ${p}`,
  forecastMark: (time: string) => `≈ limit around ${time}`,
  notEnoughReadings: 'Not enough readings yet for a forecast.',
  forecastPhrase: (time: string, left: string) => `At this pace: limit around ${time}, ${left} before the reset.`,
  holdsPhrase: (time: string) => `At this pace you will last until the ${time} reset.`,
  sourceAnthropic: (plan: boolean, time?: string) =>
    time === undefined ? 'Official: Anthropic.' : `Official: Anthropic${plan ? ', plan' : ''}, read at ${time}.`,
  sourceForecast: 'The ≈ forecast is an estimate: slope of the last 30 minutes.',
  sourceOpenAI: (time: string) => `Official: OpenAI, read by Codex at ${time}.`,
  noWindowOpen: 'No 5-hour window open: it starts with your next request to Claude.',
  limitUnknown: 'Limit unknown for now: it appears after the first reply from Claude, on a Pro or Max plan.',
  planWaiting: 'Plan limits: waiting for the first reading.',
  planUnavailable: (err: string, ago: string) => `Plan limits unavailable (${err}), read ${ago} ago.`,
  planNoModelLimit: (ago: string) => `No model-specific limit on your plan · read ${ago} ago`,
  planRead: (ago: string) => `Read ${ago} ago`,
  breakdown: (rows: string) => `Over 7 days: ${rows}`,
  codexNotRead: 'Codex: limit not read yet.',
  codexStale: (ago: string) => `Codex: last reading ${ago} ago.`,
  codexUnreachable: 'Codex unreachable',
  pace: {
    early: 'start of the week: pace not readable yet',
    ahead: (pts: number, when: string) => `${pts} pts ahead · ≈ limit ${when}`,
    aheadHolds: (pts: number) => `${pts} pts ahead, will last until the reset`,
    onPace: (elapsed: number) => `on pace (${elapsed}% of the week elapsed)`,
  },
  paceTitle: (t: string) => `Pace: ${t}.`,
  // Today
  todayBoth: (claude: string, codex: string) => `${claude} Claude · ${codex} Codex`,
  todayTokens: (n: string) => `${n} tokens`,
  todayTooltip: (cost: string) =>
    `Measured by the engines on this machine, Claude Code and Codex sessions. Claude cost: ${cost} API equivalent, not billed on your subscription. Codex: no public price.`,
  agentsToday: (done: number, failed: number) => `Finished today: ${done} · failed: ${failed}`,
  readings: (list: string) => `Read: ${list}`,
  noData: 'No data yet: install the TwinGauge plugin in Claude Code, then open a session.',
  dataMissing: (ago: string) => `No data for ${ago}`,
  upToDate: (s: number) => `Updated ${s} s ago`,
  cacheShare: (pct: string, read: string, input: string) => `${pct} read from cache · ${read} of ${input}`,
  apiEquivalent: (cost: string) => `${cost} API eq.`,
  // Sessions
  groups: { waiting: 'Waiting for you', running: 'Running', unseen: 'Done, unseen', idle: 'Idle' },
  context: (p: string) => `context ${p}`,
  tokensCount: (n: string) => `${n} tokens`,
  waitingFor: (what: string) => `waiting for you · ${what}`,
  question: 'question',
  permission: (tool?: string) => (tool === undefined ? 'permission' : `permission ${tool}`),
  working: 'working',
  done: (label?: string) => (label === undefined ? 'done' : `done · ${label}`),
  idleFor: (d: string, label?: string) => `idle ${d}${label === undefined ? '' : ` · ${label}`}`,
  listOnly: (idle: boolean, d: string) => `${idle ? 'idle' : 'active'} ${d}${idle ? '' : ' ago'} · seen in the Codex list`,
  subAgent: 'sub-agent',
  codexSubAgent: 'Codex sub-agent',
  agentWaiting: 'waiting',
  tip: {
    listOnly: (ago: string) => `seen in the Codex list, last activity ${ago} ago: we know when it moves, not what it does`,
    noHook: 'No hook event for it yet: action, waits, model and tokens appear once it resumes, if the TwinGauge hooks are approved in Codex (run codex, then /hooks).',
    waitingSince: (ago: string, what: string) => `waiting for you for ${ago}: ${what}`,
    runningSince: (ago: string, label: string) => `running for ${ago}: ${label}`,
    unseenSince: (ago: string) => `done, not seen yet, for ${ago}`,
    idleSince: (ago: string) => `idle for ${ago}`,
    lastAction: (label: string) => `last action: ${label}`,
    context: (p: string, detail: string) => `context: ${p}${detail} · measured by the engine`,
    contextDetail: (used: string, window: string) => ` · ${used} of ${window}`,
    codexTokens: (n: string) => `session tokens: ${n} · Codex has no public price`,
    cost: (c: string) => `cost: ${c} API equivalent, not billed on your subscription`,
    pinned: 'pinned',
    openOnly: 'Click or Enter: open the conversation',
    open: 'Click or Enter: open the conversation · right-click: pin, hide',
  },
  waitingQuestion: (ago: string) => `Question open for ${ago}`,
  waitingPermission: (tool: string | undefined, ago: string) => `Permission requested${tool === undefined ? '' : ` (${tool})`} for ${ago}`,
  // Status bar and notifications
  bar: {
    product: 'TwinGauge',
    noData: 'TwinGauge: no data',
    five: (p: string) => `5h ${p}`,
    seven: (p: string) => `7d ${p}`,
    waiting: (n: number) => `${n} waiting`,
  },
  barTip: {
    five: (t: string) => `Claude 5h · ${t}`,
    seven: (t: string) => `Claude 7d · ${t}`,
    codex: (label: string, t: string) => `Codex ${label} · ${t}`,
    counts: (w: number, r: number, u: number) => `${w} waiting · ${r} running${u > 0 ? ` · ${u} unseen` : ''}`,
    muted: (until: string) => `Muted until ${until}: no notifications`,
  },
  alert: {
    limit: (name: string, p: string, reset: string) => `${name} limit at ${p}${reset}.`,
    fiveHours: '5-hour',
    sevenDays: '7-day',
    model: (m: string) => `${m} 7-day`,
    codex: (label: string) => `Codex ${label}`,
    waiting: (project: string, what: string) => `${project} is waiting for you: ${what}.`,
    open: 'Open',
  },
  // Agent channel (optional)
  channelEmpty: 'No message yet.',
  channelCounts: (claude: number, codex: number, open: number) =>
    [claude > 0 ? `${claude} new for Claude` : '', codex > 0 ? `${codex} new for Codex` : '', open > 0 ? `${open} unanswered` : ''].filter(x => x !== '').join(' · ') || 'up to date',
  channelCreated: (where: string) => `Agent channel created in ${where}. Claude Code and Codex are told about each other's messages from their next prompt.`,
  channelExists: (where: string) => `${where} already has an agent channel.`,
  channelNoFolder: 'Open a folder first: the channel lives in the project.',
  // Webview
  view: {
    context: 'Context',
    used: '{0} used',
    sessions: 'Sessions',
    none: 'none',
    noSession: 'No session in the last 15 minutes. Open Claude Code or Codex.',
    waitingCount: '{0} waiting',
    hiddenCount: '{0} hidden',
    channel: 'Agent channel',
    openMessage: 'Open the message',
    today: 'Today',
    tokensPerHour: 'Tokens per hour',
    maxPerHour: 'max {0}/h',
    fresh: 'fresh',
    readFromCache: 'read from cache',
    legendFresh: 'solid: fresh, full price',
    legendCache: 'hatched: read from cache',
    nothing: 'nothing',
    cacheToday: 'Cache today',
    cacheRead: 'Read from cache',
    cacheWritten: 'Written to cache',
    cacheFresh: 'Fresh, full price',
    cacheRing: '{0} read from cache',
    cacheTip: 'Input tokens today, Claude sessions. Official: model replies. A cache read costs a tenth of a fresh input token.',
    contextAria: 'Context by category',
    pinned: 'pinned',
    agentRunning: 'agent running',
    agent: 'agent',
    meaning: { warning: 'warning', flame: 'close to the limit', 'circle-slash': 'limit reached', watch: 'forecast' },
    forecastTip: 'Estimate: slope of the last 30 minutes',
  },
}

export type Messages = typeof en

const fr: Messages = {
  fiveHours: '5 heures',
  fiveHourWindow: 'Fenêtre de 5 h',
  sevenDays: '7 jours',
  windowMinutes: n => `${n} min`,
  windowHours: n => `${n} h`,
  windowDays: n => (n === 1 ? '24 h' : `${n} jours`),
  reached: 'atteinte',
  warning: 'attention',
  resets: when => `remise ${when}`,
  now: p => `maintenant · ${p}`,
  forecastMark: time => `≈ limite vers ${time}`,
  notEnoughReadings: 'Pas encore assez de relevés pour une prévision.',
  forecastPhrase: (time, left) => `Au rythme actuel : limite vers ${time}, ${left} avant la remise.`,
  holdsPhrase: time => `Au rythme actuel, tu tiendras jusqu’à la remise de ${time}.`,
  sourceAnthropic: (plan, time) =>
    time === undefined ? 'Officiel : Anthropic.' : `Officiel : Anthropic${plan ? ', forfait' : ''}, relevé à ${time}.`,
  sourceForecast: 'La prévision ≈ est une estimation : pente des 30 dernières minutes.',
  sourceOpenAI: time => `Officiel : OpenAI, lu par Codex à ${time}.`,
  noWindowOpen: 'Aucune fenêtre de 5 h ouverte : elle s’ouvre à ta prochaine requête à Claude.',
  limitUnknown: 'Limite inconnue pour l’instant : elle apparaît après la première réponse de Claude, avec un abonnement Pro ou Max.',
  planWaiting: 'Limites du forfait : en attente de la première lecture.',
  planUnavailable: (err, ago) => `Limites du forfait indisponibles (${err}), lues il y a ${ago}.`,
  planNoModelLimit: ago => `Aucune limite propre à un modèle sur ton forfait · lu il y a ${ago}`,
  planRead: ago => `Lu il y a ${ago}`,
  breakdown: rows => `Sur 7 jours : ${rows}`,
  codexNotRead: 'Codex : limite pas encore lue.',
  codexStale: ago => `Codex : dernier relevé il y a ${ago}.`,
  codexUnreachable: 'Codex injoignable',
  pace: {
    early: 'début de semaine : rythme pas encore lisible',
    ahead: (pts, when) => `en avance de ${pts} pts · ≈ limite ${when}`,
    aheadHolds: pts => `en avance de ${pts} pts, tiendra jusqu’à la remise`,
    onPace: elapsed => `dans le rythme (${elapsed} % de la semaine écoulée)`,
  },
  paceTitle: t => `Rythme : ${t}.`,
  todayBoth: (claude, codex) => `${claude} Claude · ${codex} Codex`,
  todayTokens: n => `${n} jetons`,
  todayTooltip: cost =>
    `Mesuré par les moteurs de cette machine, sessions Claude Code et Codex. Coût Claude : ${cost} éq. API, non facturé sur ton abonnement. Codex : pas de prix public.`,
  agentsToday: (done, failed) => `Terminés aujourd’hui : ${done} · en échec : ${failed}`,
  readings: list => `Relevés : ${list}`,
  noData: 'Aucune donnée : installe le plugin TwinGauge dans Claude Code, puis ouvre une session.',
  dataMissing: ago => `Données absentes depuis ${ago}`,
  upToDate: s => `À jour il y a ${s} s`,
  cacheShare: (pct, read, input) => `${pct} relus du cache · ${read} sur ${input}`,
  apiEquivalent: cost => `${cost} éq. API`,
  groups: { waiting: 'T’attend', running: 'En marche', unseen: 'Fini, pas vu', idle: 'Au repos' },
  context: p => `contexte ${p}`,
  tokensCount: n => `${n} jetons`,
  waitingFor: what => `t’attend · ${what}`,
  question: 'question',
  permission: tool => (tool === undefined ? 'permission' : `permission ${tool}`),
  working: 'travaille',
  done: label => (label === undefined ? 'fini' : `fini · ${label}`),
  idleFor: (d, label) => `repos ${d}${label === undefined ? '' : ` · ${label}`}`,
  listOnly: (idle, d) => `${idle ? 'repos' : 'active il y a'} ${d} · vue par la liste de Codex`,
  subAgent: 'sous-agent',
  codexSubAgent: 'sous-agent Codex',
  agentWaiting: 'en attente',
  tip: {
    listOnly: ago => `vue par la liste de Codex, dernière activité il y a ${ago} : on sait quand elle bouge, pas ce qu’elle fait`,
    noHook: 'Aucun événement de hook pour elle : l’action, l’attente, le modèle et les jetons arrivent dès qu’elle reprend, si les hooks TwinGauge sont approuvés dans Codex (codex, puis /hooks).',
    waitingSince: (ago, what) => `t’attend depuis ${ago} : ${what}`,
    runningSince: (ago, label) => `en cours depuis ${ago} : ${label}`,
    unseenSince: ago => `fini, pas encore vu, depuis ${ago}`,
    idleSince: ago => `au repos depuis ${ago}`,
    lastAction: label => `dernière action : ${label}`,
    context: (p, detail) => `contexte : ${p}${detail} · mesuré par le moteur`,
    contextDetail: (used, window) => ` · ${used} sur ${window}`,
    codexTokens: n => `jetons de la session : ${n} · Codex n’a pas de prix public`,
    cost: c => `coût : ${c} éq. API, non facturé sur ton abonnement`,
    pinned: 'épinglée',
    openOnly: 'Clic ou Entrée : ouvrir la conversation',
    open: 'Clic ou Entrée : ouvrir la conversation · clic droit : épingler, masquer',
  },
  waitingQuestion: ago => `Question ouverte depuis ${ago}`,
  waitingPermission: (tool, ago) => `Permission demandée${tool === undefined ? '' : ` (${tool})`} depuis ${ago}`,
  bar: {
    product: 'TwinGauge',
    noData: 'TwinGauge : données absentes',
    five: p => `5 h ${p}`,
    seven: p => `7 j ${p}`,
    waiting: n => `${n} t’attend`,
  },
  barTip: {
    five: t => `Claude 5 h · ${t}`,
    seven: t => `Claude 7 j · ${t}`,
    codex: (label, t) => `Codex ${label} · ${t}`,
    counts: (w, r, u) => `${w} t’attend · ${r} en marche${u > 0 ? ` · ${u} à lire` : ''}`,
    muted: until => `Sourdine jusqu’à ${until} : aucune notification`,
  },
  alert: {
    limit: (name, p, reset) => `Limite ${name} à ${p}${reset}.`,
    fiveHours: 'des 5 h',
    sevenDays: 'des 7 jours',
    model: m => `de ${m} sur 7 jours`,
    codex: label => `de Codex sur ${label}`,
    waiting: (project, what) => `${project} t’attend : ${what}.`,
    open: 'Ouvrir',
  },
  channelEmpty: 'Aucun message pour l’instant.',
  channelCounts: (claude, codex, open) =>
    [claude > 0 ? `${claude} pour Claude` : '', codex > 0 ? `${codex} pour Codex` : '', open > 0 ? `${open} sans réponse` : ''].filter(x => x !== '').join(' · ') || 'à jour',
  channelCreated: where => `Canal des agents créé dans ${where}. Claude Code et Codex sont prévenus des messages de l’autre dès leur prochain message.`,
  channelExists: where => `${where} a déjà un canal des agents.`,
  channelNoFolder: 'Ouvre d’abord un dossier : le canal vit dans le projet.',
  view: {
    context: 'Contexte',
    used: '{0} occupé',
    sessions: 'Sessions',
    none: 'aucune',
    noSession: 'Aucune session depuis 15 min. Ouvre Claude Code ou Codex.',
    waitingCount: '{0} t’attend',
    hiddenCount: '{0} masquée(s)',
    channel: 'Canal des agents',
    openMessage: 'Ouvrir le message',
    today: 'Aujourd’hui',
    tokensPerHour: 'Jetons par heure',
    maxPerHour: 'max {0}/h',
    fresh: 'neufs',
    readFromCache: 'relus du cache',
    legendFresh: 'plein : neuf, plein tarif',
    legendCache: 'hachuré : relu du cache',
    nothing: 'rien',
    cacheToday: 'Cache du jour',
    cacheRead: 'Relus du cache',
    cacheWritten: 'Écrits au cache',
    cacheFresh: 'Neufs, plein tarif',
    cacheRing: '{0} relus du cache',
    cacheTip: 'Jetons d’entrée du jour, sessions Claude. Officiel : réponses du modèle. Une lecture en cache coûte un dixième d’une entrée neuve.',
    contextAria: 'Contexte par catégorie',
    pinned: 'épinglée',
    agentRunning: 'agent en marche',
    agent: 'agent',
    meaning: { warning: 'attention', flame: 'proche de la limite', 'circle-slash': 'limite atteinte', watch: 'prévision' },
    forecastTip: 'Estimation : pente des 30 dernières minutes',
  },
}

/** The plain strings the webview needs (functions do not survive postMessage); `{0}` marks a value. */
export function webviewStrings(): Record<string, unknown> {
  return {
    ...t.view,
    groups: t.groups,
    fiveHours: t.fiveHours,
    fiveHourWindow: t.fiveHourWindow,
    paceTitle: t.paceTitle('{0}'),
    lang,
  }
}

let lang: Lang = 'en'
/** The current catalog; read through `t` so a language change applies everywhere. */
export let t: Messages = en

/** `fr`, `fr-ca`… pick French; anything else is English. */
export function setLanguage(code: string | undefined): Lang {
  lang = (code ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en'
  t = lang === 'fr' ? fr : en
  return lang
}
export const language = (): Lang => lang

// ——— Number and date formats ———

const two = (n: number): string => String(n).padStart(2, '0')
const decimal = (x: number, digits: number): string => (lang === 'fr' ? x.toFixed(digits).replace('.', ',') : x.toFixed(digits))

/** `37%` in English, `37 %` in French. */
export function percent(p: number): string {
  return lang === 'fr' ? `${Math.round(p)} %` : `${Math.round(p)}%`
}
/** `290k`, `1.9M` / `290 k`, `1,9 M`. */
export function tokens(n: number): string {
  const sp = lang === 'fr' ? ' ' : ''
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}${sp}k`
  return `${decimal(n / 1_000_000, 1)}${sp}M`
}
/** Above $100 the cents teach nothing and widen the line. */
export function dollars(x: number): string {
  const v = x >= 100 ? String(Math.round(x)) : decimal(x, 2)
  return lang === 'fr' ? `${v} $` : `$${v}`
}
export function duration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${two(min % 60)}`
}
/** An action's duration: nothing under 30 s, then 10 s steps, then minutes. */
export function actionDuration(ms: number): string {
  if (ms < 30_000) return ''
  if (ms < 60_000) return `${Math.floor(ms / 10_000) * 10} s`
  return duration(ms)
}
export function day(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
/** 24-hour clock in both languages: compact and unambiguous in a narrow panel. */
export function clock(ms: number): string {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}
const WEEKDAYS: Record<Lang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
}
/** Resets are rounded to the minute: /usage says 23:59:59.9 when the headers say 0:00. */
export const toMinute = (ms: number): number => Math.round(ms / 60_000) * 60_000
export function dayAndTime(ms: number, now: number): string {
  const d = new Date(toMinute(ms))
  const h = `${d.getHours()}:${two(d.getMinutes())}`
  return day(d.getTime()) === day(now) ? h : `${WEEKDAYS[lang][d.getDay()]} ${h}`
}
/** A reset date: the time within 24 h, otherwise weekday and date (`Thu 10/15`, `jeu. 15/10`), never a bare weekday. */
export function shortDate(ms: number, now: number): string {
  const d = new Date(toMinute(ms))
  if (d.getTime() - now < 24 * 3600_000) return dayAndTime(ms, now)
  const dm = lang === 'fr' ? `${two(d.getDate())}/${two(d.getMonth() + 1)}` : `${two(d.getMonth() + 1)}/${two(d.getDate())}`
  return `${WEEKDAYS[lang][d.getDay()]} ${dm}`
}
