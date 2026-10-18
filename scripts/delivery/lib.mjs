// Shared logic for the LatticePolicy delivery flow (docs/delivery/WORKFLOW.md).
// No dependencies, so it runs anywhere Node runs and in any AI tool's sandbox.
import fs from 'node:fs'
import path from 'node:path'

export const TRACKS = ['quick', 'standard', 'major']
export const GATES = ['A', 'B', 'C', 'D']
export const MAX_RETURNS = 2
/** Gates the requester may waive in their request; merge (C) and sign-off (D) never are. */
export const WAIVABLE_GATES = ['A', 'B']
/** A gate no longer blocks once a person approved it or the requester waived it. */
export const gateCleared = (gate) => Boolean(gate && (gate.approvedBy || gate.waivedBy))
/** Gates each track requires, in order. */
export const TRACK_GATES = { quick: ['C'], standard: ['A', 'C', 'D'], major: ['A', 'B', 'C', 'D'] }
const PLACEHOLDER = 'TODO(agent)'

export function repoRoot(start = process.cwd()) {
  let dir = path.resolve(start)
  while (!fs.existsSync(path.join(dir, 'agents', 'README.md'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('Run inside the LatticePolicy repository (agents/README.md not found)')
    dir = parent
  }
  return dir
}

/** Parses the small front-matter subset used here: `key: value` and `key: [a, b]`. */
export function parseFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { data: null, body: text }
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    const raw = pair[2].trim()
    if (raw.startsWith('[') && raw.endsWith(']')) {
      data[pair[1]] = raw.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)
    } else if (/^\d+$/.test(raw)) data[pair[1]] = Number(raw)
    else data[pair[1]] = raw.replace(/^(['"])(.*)\1$/, '$2')
  }
  return { data, body: text.slice(match[0].length) }
}

/** Agent contracts from agents/*.md, ordered by stage. */
export function loadAgents(root) {
  const dir = path.join(root, 'agents')
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .map((file) => {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      const { data, body } = parseFrontMatter(text)
      if (!data?.id || data.stage === undefined || !Array.isArray(data.tracks) || !data.writes)
        throw new Error(`agents/${file} is missing id, stage, tracks or writes in its header`)
      if (`${data.id}.md` !== file) throw new Error(`agents/${file}: id must match the file name`)
      return { ...data, file: `agents/${file}`, body: body.trim() }
    })
    .sort((a, b) => a.stage - b.stage)
}

/** The stages a track runs, in order, with the gate (if any) that follows each. */
export function planFor(agents, track) {
  if (!TRACKS.includes(track)) throw new Error(`Unknown track ${track}; use ${TRACKS.join(', ')}`)
  const gates = TRACK_GATES[track]
  const plan = agents
    .filter((agent) => agent.tracks.includes(track))
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      writes: agent.writes,
      gateAfter: gates.includes(agent.gate_after) ? agent.gate_after : null,
    }))
  // On short tracks the merge gate follows whatever stage precedes deployment.
  if (gates.includes('C') && !plan.some((stage) => stage.gateAfter === 'C')) {
    const deploy = plan.findIndex((stage) => stage.id === 'deployment')
    if (deploy > 0) plan[deploy - 1].gateAfter = 'C'
  }
  return plan
}

/** A folder-friendly slug of whole words, at most 48 characters. */
export function slugify(text) {
  const words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  let slug = ''
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word
    if (next.length > 48) break
    slug = next
  }
  return slug || (words[0] || 'request').slice(0, 48)
}

export function workDir(root) {
  return path.join(root, 'docs', 'work')
}

export function listPackages(root) {
  const dir = workDir(root)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => /^WP-\d{4}/.test(name) && fs.existsSync(path.join(dir, name, 'status.json')))
    .sort()
}

export function findPackage(root, id) {
  const wanted = String(id || '').toUpperCase()
  const name = listPackages(root).find((entry) => entry === wanted || entry.startsWith(`${wanted}-`))
  if (!name) throw new Error(`Work package ${id} not found under docs/work/`)
  return path.join(workDir(root), name)
}

export function nextId(root) {
  const numbers = listPackages(root).map((name) => Number(name.slice(3, 7)))
  return `WP-${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(4, '0')}`
}

/** Suggests a track from the request text; the orchestrator confirms or overrides. */
export function suggestTrack(request) {
  const text = String(request).toLowerCase()
  const major = /\b(tenant\w*|rls|auth|authentication|authorization|login|sso|mfa|permissions?|rating|rate tables?|filed|filings?|forms?|migrations?|schema|customer data|pii|privacy|ai|llm|models?|security|new product|product lines?|billing|reinsurance)\b/
  const quick = /\b(typo|copy|wording|label|rename text|readme|docs? only|comment|test only|lint)\b/
  if (major.test(text)) return { track: 'major', reason: 'touches an area that is always major (security, tenancy, rating, forms, data, AI or migrations)' }
  if (quick.test(text)) return { track: 'quick', reason: 'small copy, docs or test-only change' }
  return { track: 'standard', reason: 'behavior change within one area' }
}

function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (values[key] === undefined ? '' : String(values[key])))
}

export function readStatus(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'))
}

export function writeStatus(dir, status) {
  fs.writeFileSync(path.join(dir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`)
  fs.writeFileSync(path.join(dir, 'status.md'), renderStatus(status))
}

export function renderStatus(status) {
  const lines = [
    `<!-- Generated from status.json by scripts/delivery/flow.mjs. Do not edit by hand. -->`,
    `# ${status.id}: ${status.title}`,
    '',
    `- Track: **${status.track}** — ${status.trackReason}`,
    `- State: **${status.state}**`,
    `- Next: ${describeNext(status)}`,
    '',
    '| Stage | Output | Status | Returns |',
    '| --- | --- | --- | --- |',
    ...status.stages.map((stage) => `| ${stage.name} | \`${stage.writes}\` | ${stage.status} | ${stage.returns} |`),
    '',
    '## Gates',
    '',
    '| Gate | Status | Approved by | Note |',
    '| --- | --- | --- | --- |',
    ...status.gates.map((gate) =>
      gate.waivedBy
        ? `| ${gate.gate} | waived | ${gate.waivedBy} (${gate.waivedAt}) | ${gate.note || ''} |`
        : `| ${gate.gate} | ${gate.approvedBy ? 'approved' : 'pending'} | ${gate.approvedBy ? `${gate.approvedBy} (${gate.approvedAt})` : ''} | ${gate.note || ''} |`,
    ),
    '',
    '## History',
    '',
    ...status.history.map((entry) => `- ${entry.at} — ${entry.event}`),
    '',
  ]
  return lines.join('\n')
}

function now(clock) {
  return (clock ? clock() : new Date()).toISOString()
}

export function startPackage(root, request, options = {}) {
  if (!String(request || '').trim()) throw new Error('Describe the request: npm run flow -- start "<request>"')
  const agents = loadAgents(root)
  const suggestion = suggestTrack(request)
  const track = options.track || suggestion.track
  const trackReason = options.track ? options.reason || 'chosen by the requester' : suggestion.reason
  const plan = planFor(agents, track)
  for (const gate of options.waive || []) {
    const name = String(gate).toUpperCase()
    if (!WAIVABLE_GATES.includes(name)) throw new Error(`Gate ${gate} cannot be waived; only ${WAIVABLE_GATES.join(' and ')} can`)
    if (!TRACK_GATES[track].includes(name)) throw new Error(`Gate ${name} is not part of the ${track} track`)
    if (!String(options.waiver || '').trim()) throw new Error('Quote the requester: --note "<their words saying approval is not needed>"')
  }
  const id = options.id || nextId(root)
  const title = String(request).trim().split(/\r?\n/)[0].slice(0, 120)
  const dir = path.join(workDir(root), `${id}-${slugify(title)}`)
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`)
  fs.mkdirSync(dir, { recursive: true })
  const at = now(options.clock)
  const values = { id, request: String(request).trim(), date: at.slice(0, 10), track, trackReason }
  const templates = path.join(root, 'docs', 'delivery', 'templates')
  fs.writeFileSync(path.join(dir, 'request.md'), fill(fs.readFileSync(path.join(templates, 'request.md'), 'utf8'), values))
  for (const stage of plan) {
    const template = path.join(templates, stage.writes)
    if (fs.existsSync(template)) fs.writeFileSync(path.join(dir, stage.writes), fill(fs.readFileSync(template, 'utf8'), values))
  }
  if (track !== 'quick') fs.writeFileSync(path.join(dir, 'traceability.md'), fill(fs.readFileSync(path.join(templates, 'traceability.md'), 'utf8'), values))
  const status = {
    schemaVersion: 1,
    id,
    title,
    track,
    trackReason,
    state: 'in-progress',
    createdAt: at,
    stages: plan.map((stage) => ({ ...stage, status: stage.id === 'orchestrator' ? 'done' : 'pending', returns: 0 })),
    gates: TRACK_GATES[track].map((gate) => ({ gate, approvedBy: null, approvedAt: null, waivedBy: null, waivedAt: null, note: null })),
    history: [{ at, event: `started on the ${track} track (${trackReason})` }],
  }
  writeStatus(dir, status)
  for (const gate of options.waive || []) waiveGate(dir, gate, options.waivedBy || 'requester', options.waiver, options)
  return { id, dir, status: readStatus(dir) }
}

/** The stage or gate that must happen next. */
export function nextStep(status) {
  if (status.state === 'needs-human') return { kind: 'human', reason: status.needsHumanReason }
  for (const stage of status.stages) {
    if (stage.status !== 'done') return { kind: 'stage', stage }
    if (stage.gateAfter) {
      const gate = status.gates.find((entry) => entry.gate === stage.gateAfter)
      if (gate && !gateCleared(gate)) return { kind: 'gate', gate: gate.gate, after: stage.id }
    }
  }
  return { kind: 'done' }
}

function describeNext(status) {
  const step = nextStep(status)
  if (step.kind === 'stage') return `${step.stage.name} (\`${step.stage.writes}\`)`
  if (step.kind === 'gate') return `human approval at Gate ${step.gate}`
  if (step.kind === 'human') return `a person must decide: ${step.reason}`
  return 'nothing — complete'
}

/** Placeholders an agent left in its output. */
export function placeholderCount(file) {
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf8').split(PLACEHOLDER).length - 1
}

/**
 * Rows of a findings table (code review, security) that are severe and still
 * open. A row is severe when its first cell is blocker, major, high or
 * critical, and open when its last cell says open.
 */
export function openSevereFindings(file) {
  if (!fs.existsSync(file)) return []
  // Formatting (bold, code) does not hide a severity; only an outcome that says
  // the finding is fixed, accepted or not applicable closes it.
  const plain = (cell) => cell.replace(/[*_`]/g, '').trim().toLowerCase()
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map(plain))
    .filter(
      (cells) =>
        cells.length >= 2 &&
        /^(blocker|major|high|critical)\b/.test(cells[0]) &&
        !/^(fixed|accepted|not applicable|n\/a|resolved|verified)\b/.test(cells[cells.length - 1]),
    )
}

/** Stages whose findings table gates completion. */
const FINDINGS_STAGES = ['code-reviewer', 'security-compliance']

export function completeStage(dir, agentId, options = {}) {
  const status = readStatus(dir)
  const step = nextStep(status)
  if (step.kind !== 'stage') throw new Error(`Nothing to complete: next is ${describeNext(status)}`)
  if (step.stage.id !== agentId) throw new Error(`The next stage is ${step.stage.id}, not ${agentId}`)
  const output = path.join(dir, step.stage.writes)
  const outputRequired = step.stage.writes.endsWith('.md')
  const left = placeholderCount(output)
  if (outputRequired && left === null) throw new Error(`${step.stage.writes} does not exist`)
  if (outputRequired && left > 0) throw new Error(`${step.stage.writes} still has ${left} ${PLACEHOLDER} placeholder(s)`)
  const open = FINDINGS_STAGES.includes(step.stage.id) ? openSevereFindings(output) : []
  if (open.length) throw new Error(`${step.stage.writes} still has ${open.length} open blocker/major/high/critical finding(s); fix them or return the package`)
  step.stage.status = 'done'
  status.history.push({ at: now(options.clock), event: `${step.stage.name} completed` })
  if (nextStep(status).kind === 'done') {
    status.state = 'released'
    status.history.push({ at: now(options.clock), event: 'work package complete' })
  }
  writeStatus(dir, status)
  return status
}

export function approveGate(dir, gateName, approver, note, options = {}) {
  const status = readStatus(dir)
  const gate = status.gates.find((entry) => entry.gate === String(gateName).toUpperCase())
  if (!gate) throw new Error(`Gate ${gateName} is not part of the ${status.track} track`)
  if (!String(approver || '').trim()) throw new Error('Record who approved: --by "<name>"')
  const step = nextStep(status)
  if (step.kind !== 'gate' || step.gate !== gate.gate) throw new Error(`Gate ${gate.gate} is not next: next is ${describeNext(status)}`)
  gate.approvedBy = String(approver).trim()
  gate.approvedAt = now(options.clock).slice(0, 10)
  gate.note = note ? String(note).trim() : null
  status.history.push({ at: now(options.clock), event: `Gate ${gate.gate} approved by ${gate.approvedBy}${gate.note ? `: "${gate.note}"` : ''}` })
  if (nextStep(status).kind === 'done') status.state = 'released'
  writeStatus(dir, status)
  return status
}

/**
 * Records that the requester said a gate is not needed (for example "no need to
 * ask for requirements approval"). Only A and B; the requester's own words are
 * required. May be recorded before the gate is reached.
 */
export function waiveGate(dir, gateName, requester, words, options = {}) {
  const status = readStatus(dir)
  const name = String(gateName).toUpperCase()
  if (!WAIVABLE_GATES.includes(name)) throw new Error(`Gate ${name} cannot be waived; only ${WAIVABLE_GATES.join(' and ')} can`)
  const gate = status.gates.find((entry) => entry.gate === name)
  if (!gate) throw new Error(`Gate ${name} is not part of the ${status.track} track`)
  if (gateCleared(gate)) throw new Error(`Gate ${name} is already ${gate.approvedBy ? 'approved' : 'waived'}`)
  if (!String(requester || '').trim()) throw new Error('Record who waived it: --by "<requester>"')
  if (!String(words || '').trim()) throw new Error('Quote the requester: --note "<their words saying approval is not needed>"')
  gate.waivedBy = String(requester).trim()
  gate.waivedAt = now(options.clock).slice(0, 10)
  gate.note = String(words).trim()
  status.history.push({ at: now(options.clock), event: `Gate ${name} waived by ${gate.waivedBy}: "${gate.note}"` })
  writeStatus(dir, status)
  return status
}

export function returnToStage(dir, agentId, reason, options = {}) {
  const status = readStatus(dir)
  if (status.state === 'needs-human')
    throw new Error(`${status.id} is stopped for a person (${status.needsHumanReason}); they continue it with: npm run flow -- resolve ${status.id} --by "<name>" --note "<decision>"`)
  const index = status.stages.findIndex((stage) => stage.id === agentId)
  if (index < 0) throw new Error(`${agentId} is not a stage of this work package`)
  if (agentId === 'orchestrator') throw new Error('The orchestrator has no output to redo; return to the stage whose work is wrong')
  if (!String(reason || '').trim()) throw new Error('Say why: --reason "<what is wrong>"')
  const target = status.stages[index]
  target.returns += 1
  // Everything from the returned stage onward runs again, and approvals of that
  // work no longer stand: the approver must see the rewritten output. Waivers
  // the requester gave in their own words still apply.
  const rerun = status.stages.slice(index)
  for (const stage of rerun) stage.status = 'pending'
  const reopened = []
  for (const stage of rerun) {
    const gate = stage.gateAfter && status.gates.find((entry) => entry.gate === stage.gateAfter)
    if (gate?.approvedBy) {
      reopened.push(gate.gate)
      gate.approvedBy = null
      gate.approvedAt = null
      gate.note = null
    }
  }
  status.history.push({
    at: now(options.clock),
    event: `returned to ${target.name}: ${String(reason).trim()}${reopened.length ? ` (Gate ${reopened.join(', ')} reopened)` : ''}`,
  })
  if (target.returns > MAX_RETURNS) {
    status.state = 'needs-human'
    status.needsHumanReason = `${target.name} has been returned ${target.returns} times (latest: ${String(reason).trim()})`
  } else status.state = 'in-progress'
  writeStatus(dir, status)
  return status
}

/** A person's decision that lets a stopped (needs-human) package continue. */
export function resolveNeedsHuman(dir, person, decision, options = {}) {
  const status = readStatus(dir)
  if (status.state !== 'needs-human') throw new Error(`${status.id} is not waiting for a person`)
  if (!String(person || '').trim()) throw new Error('Record who decided: --by "<name>"')
  if (!String(decision || '').trim()) throw new Error('Record the decision: --note "<what they decided>"')
  for (const stage of status.stages) stage.returns = 0
  status.state = 'in-progress'
  status.history.push({ at: now(options.clock), event: `${String(person).trim()} resolved the stop: "${String(decision).trim()}"` })
  delete status.needsHumanReason
  writeStatus(dir, status)
  return status
}

/** The prompt any AI tool (or a person) can follow to run the next stage. */
export function promptFor(root, dir) {
  const status = readStatus(dir)
  const step = nextStep(status)
  const rel = path.relative(root, dir)
  if (step.kind === 'gate')
    return `${status.id} is waiting for human approval at Gate ${step.gate} (see docs/delivery/WORKFLOW.md#gates).\nAsk the approver: summarize ${rel}/ for them and wait for their answer. Record it with:\n  npm run flow -- approve ${status.id} ${step.gate} --by "<name>" --note "<what they said>"${WAIVABLE_GATES.includes(step.gate) ? `\nOnly if the requester said this approval is not needed:\n  npm run flow -- waive ${status.id} ${step.gate} --by "<requester>" --note "<their words>"` : ''}`
  if (step.kind === 'human')
    return `${status.id} needs a person to decide: ${step.reason}\nAsk them, then record their decision with:\n  npm run flow -- resolve ${status.id} --by "<name>" --note "<what they decided>"`
  if (step.kind === 'done') return `${status.id} is complete.`
  const agent = loadAgents(root).find((entry) => entry.id === step.stage.id)
  const earlier = status.stages
    .slice(0, status.stages.indexOf(step.stage))
    .filter((stage) => stage.writes.endsWith('.md') && stage.status === 'done')
    .map((stage) => `${rel}/${stage.writes}`)
  return [
    `You are the ${agent.name} agent for LatticePolicy (${status.track} track).`,
    `Follow your contract in ${agent.file} exactly, and the safety rules in AGENTS.md.`,
    `Work package: ${rel}/ — request in ${rel}/request.md.`,
    earlier.length ? `Read the earlier handoffs: ${earlier.join(', ')}.` : 'There are no earlier handoffs.',
    `Write your output to ${rel}/${step.stage.writes} and replace every TODO(agent) placeholder.`,
    `When finished run: npm run flow -- complete ${status.id} ${agent.id}`,
    `If earlier work is wrong, run: npm run flow -- return ${status.id} <agent-id> --reason "<why>"`,
  ].join('\n')
}

/** Problems with one work package (used by CI). */
export function packageProblems(root, dir) {
  const problems = []
  let status
  try {
    status = readStatus(dir)
  } catch (error) {
    return [`${path.basename(dir)}: status.json is unreadable (${error.message})`]
  }
  const name = path.basename(dir)
  if (status.schemaVersion !== 1) problems.push(`${name}: unsupported schemaVersion`)
  if (!TRACKS.includes(status.track)) problems.push(`${name}: unknown track ${status.track}`)
  const expected = TRACK_GATES[status.track] || []
  const gates = (status.gates || []).map((gate) => gate.gate)
  if (expected.join() !== gates.join()) problems.push(`${name}: gates ${gates.join(',')} do not match the ${status.track} track (${expected.join(',')})`)
  // A stage after a gate cannot be done while that gate is pending.
  let blockedBy = null
  for (const stage of status.stages || []) {
    if (blockedBy && stage.status === 'done') problems.push(`${name}: ${stage.name} is done but Gate ${blockedBy} is not approved`)
    if (stage.status === 'done' && stage.writes.endsWith('.md')) {
      const left = placeholderCount(path.join(dir, stage.writes))
      if (left === null) problems.push(`${name}: ${stage.writes} is missing`)
      else if (left > 0) problems.push(`${name}: ${stage.writes} has ${left} TODO(agent) placeholder(s)`)
    }
    if (stage.status === 'done' && stage.gateAfter) {
      const gate = (status.gates || []).find((entry) => entry.gate === stage.gateAfter)
      if (gate && !gateCleared(gate)) blockedBy = blockedBy || gate.gate
    }
  }
  for (const gate of status.gates || []) {
    if (gate.approvedBy && !gate.approvedAt) problems.push(`${name}: Gate ${gate.gate} has no approval date`)
    if (gate.waivedBy && (!WAIVABLE_GATES.includes(gate.gate) || !gate.note)) problems.push(`${name}: Gate ${gate.gate} cannot be waived without the requester's words, and only A or B can be`)
  }
  return problems
}

/**
 * Removes HTML comments, scanning rather than pattern-matching so nested or
 * overlapping markers cannot leave a comment opener behind. An unterminated
 * comment hides the rest of the text, as it would when rendered.
 */
export function stripHtmlComments(text) {
  const once = (input) => {
    let out = ''
    let index = 0
    for (;;) {
      const open = input.indexOf('<!--', index)
      if (open < 0) return out + input.slice(index)
      out += input.slice(index, open)
      const close = input.indexOf('-->', open + 4)
      if (close < 0) return out
      index = close + 3
    }
  }
  // Removing a comment can join its neighbours into a new opener ("<!-" + "-"),
  // so repeat until nothing changes. Each pass removes at least one opener.
  let current = text
  for (;;) {
    const next = once(current)
    if (next === current) return current
    current = next
  }
}

/**
 * Checks a pull request description: it must name a work package whose gates
 * before merge (A, and B on the major track) are approved, or declare a quick
 * change with a reason.
 */
export function pullRequestProblems(root, body, author = '') {
  if (/\[bot\]$/.test(author) || author === 'dependabot') return []
  // Template guidance lives in HTML comments; only what the author wrote counts.
  const text = stripHtmlComments(String(body || ''))
  const quickReason = /Delivery track:[ \t]*quick[ \t]*[—–-][ \t]*([^\r\n]*)/i.exec(text)
  const reason = quickReason ? quickReason[1].trim() : ''
  const quick = reason.length > 0 && !/^</.test(reason) && !/^one-line reason$/i.test(reason)
  const reference = /Work package:\s*(WP-\d{4})\b/i.exec(text)
  if (!reference && quick) return []
  if (!reference)
    return ['The pull request description must contain "Work package: WP-NNNN" or "Delivery track: quick — <reason>" (docs/delivery/WORKFLOW.md#pull-requests).']
  let dir
  try {
    dir = findPackage(root, reference[1])
  } catch (error) {
    return [error.message]
  }
  const status = readStatus(dir)
  const beforeMerge = status.gates.filter((gate) => gate.gate === 'A' || gate.gate === 'B')
  return [
    ...packageProblems(root, dir),
    ...beforeMerge.filter((gate) => !gateCleared(gate)).map((gate) => `${status.id}: Gate ${gate.gate} must be approved (or waived by the requester) before merge`),
  ]
}

/** Knowledge files past their review date, and files without review metadata. */
export function knowledgeReport(root, today = new Date()) {
  const base = path.join(root, 'docs', 'knowledge')
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) files.push(full)
    }
  }
  if (fs.existsSync(base)) walk(base)
  const due = []
  const missing = []
  const current = []
  for (const file of files.sort()) {
    const rel = path.relative(root, file)
    // Accepted ADRs are immutable records, not reviewed knowledge.
    if (/\/adr\/(?!README\.md)/.test(rel.replace(/\\/g, '/'))) continue
    const { data } = parseFrontMatter(fs.readFileSync(file, 'utf8'))
    const reviewed = data?.last_reviewed ? Date.parse(`${data.last_reviewed}T00:00:00Z`) : NaN
    const every = Number(data?.review_every_days)
    if (!Number.isFinite(reviewed) || !Number.isFinite(every)) {
      missing.push(rel)
      continue
    }
    const dueOn = new Date(reviewed + every * 86400000)
    const entry = { file: rel, title: data.title || rel, lastReviewed: data.last_reviewed, dueOn: dueOn.toISOString().slice(0, 10) }
    ;(dueOn <= today ? due : current).push(entry)
  }
  return { due, missing, current }
}
