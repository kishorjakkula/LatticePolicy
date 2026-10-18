import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  approveGate,
  completeStage,
  knowledgeReport,
  loadAgents,
  nextStep,
  packageProblems,
  planFor,
  promptFor,
  pullRequestProblems,
  readStatus,
  returnToStage,
  openSevereFindings,
  parseFrontMatter,
  resolveNeedsHuman,
  slugify,
  startPackage,
  waiveGate,
  suggestTrack,
} from './lib.mjs'
import { drift, renderAdapters, writeAdapters } from './sync-agents.mjs'

const realRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** A throwaway repository with the real contracts, templates and AGENTS.md. */
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.cpSync(path.join(realRoot, 'agents'), path.join(root, 'agents'), { recursive: true })
  fs.cpSync(path.join(realRoot, 'docs/delivery'), path.join(root, 'docs/delivery'), { recursive: true })
  fs.copyFileSync(path.join(realRoot, 'AGENTS.md'), path.join(root, 'AGENTS.md'))
  return root
}

/** Writes an agent's output without placeholders. */
function fillOutput(dir, file) {
  fs.writeFileSync(path.join(dir, file), `# ${file}\n\nDone.\n`)
}

/** Runs the package to its next gate or the end, filling each output. */
function runUntilGate(dir) {
  for (;;) {
    const step = nextStep(readStatus(dir))
    if (step.kind !== 'stage') return step
    if (step.stage.writes.endsWith('.md')) fillOutput(dir, step.stage.writes)
    completeStage(dir, step.stage.id)
  }
}

test('every contract has a valid header and the stages are in order', () => {
  const agents = loadAgents(realRoot)
  assert.deepEqual(
    agents.map((agent) => agent.id),
    ['orchestrator', 'business-analyst', 'software-architect', 'ui-designer', 'test-designer', 'developer', 'unit-test', 'code-reviewer', 'security-compliance', 'automation-test', 'deployment', 'e2e-test', 'business-validation', 'knowledge-curator'],
  )
  for (const agent of agents) assert.ok(agent.summary && agent.body.includes('## '), `${agent.id} needs a summary and sections`)
})

test('tracks run the right stages with the right gates', () => {
  const agents = loadAgents(realRoot)
  const quick = planFor(agents, 'quick')
  assert.deepEqual(quick.map((stage) => stage.id), ['orchestrator', 'developer', 'unit-test', 'code-reviewer', 'deployment'])
  assert.deepEqual(quick.filter((stage) => stage.gateAfter).map((stage) => `${stage.id}:${stage.gateAfter}`), ['code-reviewer:C'])
  const standard = planFor(agents, 'standard')
  assert.equal(standard.length, 14)
  assert.deepEqual(standard.filter((stage) => stage.gateAfter).map((stage) => `${stage.id}:${stage.gateAfter}`), ['business-analyst:A', 'automation-test:C', 'business-validation:D'])
  const major = planFor(agents, 'major')
  assert.deepEqual(major.filter((stage) => stage.gateAfter).map((stage) => stage.gateAfter), ['A', 'B', 'C', 'D'])
})

test('work package folders end on a whole word', () => {
  assert.equal(slugify('Tool-neutral delivery agent flow for LatticePolicy coding requests'), 'tool-neutral-delivery-agent-flow-for')
  assert.equal(slugify('!!!'), 'request')
})

test('suggests major for sensitive areas and quick for copy changes', () => {
  assert.equal(suggestTrack('Add RLS to the new claims table').track, 'major')
  assert.equal(suggestTrack('Change the rating factor for roof age').track, 'major')
  assert.equal(suggestTrack('Fix typo on the dashboard').track, 'quick')
  assert.equal(suggestTrack('Show the agent name on the quote list').track, 'standard')
})

test('a standard package runs stage by stage, stops at gates, and finishes', (t) => {
  const root = sandbox(t)
  const { id, dir, status } = startPackage(root, 'Show the agent name on the quote list', { clock: () => new Date('2026-10-18T12:00:00Z') })
  assert.equal(id, 'WP-0001')
  assert.equal(status.track, 'standard')
  assert.ok(fs.existsSync(path.join(dir, '01-requirements.md')))
  assert.ok(fs.readFileSync(path.join(dir, 'status.md'), 'utf8').includes('Business Analyst'))

  const prompt = promptFor(root, dir)
  assert.match(prompt, /You are the Business Analyst agent/)
  assert.match(prompt, /agents\/business-analyst\.md/)
  // The template still has placeholders, so the stage cannot complete yet.
  assert.throws(() => completeStage(dir, 'business-analyst'), /TODO\(agent\)/)
  assert.throws(() => completeStage(dir, 'developer'), /next stage is business-analyst/)

  assert.deepEqual(runUntilGate(dir), { kind: 'gate', gate: 'A', after: 'business-analyst' })
  assert.match(promptFor(root, dir), /waiting for human approval at Gate A/)
  assert.throws(() => approveGate(dir, 'A', ''), /who approved/)
  assert.throws(() => approveGate(dir, 'C', 'Owner'), /not next/)
  approveGate(dir, 'A', 'Product owner', 'Approved as written')

  assert.equal(runUntilGate(dir).gate, 'C')
  approveGate(dir, 'C', 'Code owner')
  assert.equal(runUntilGate(dir).gate, 'D')
  approveGate(dir, 'D', 'Business owner')
  assert.equal(runUntilGate(dir).kind, 'done')
  const done = readStatus(dir)
  assert.equal(done.state, 'released')
  assert.deepEqual(packageProblems(root, dir), [])
  assert.ok(done.history.some((entry) => entry.event.includes('Gate A approved by Product owner: "Approved as written"')))
})

test('requirements approval is asked for unless the requester waives it in words', (t) => {
  const root = sandbox(t)
  // Default: the flow stops and asks at Gate A.
  const asked = startPackage(root, 'Show the agent name on the quote list')
  assert.equal(runUntilGate(asked.dir).gate, 'A')
  assert.match(promptFor(root, asked.dir), /Ask the approver/)
  assert.match(promptFor(root, asked.dir), /Only if the requester said this approval is not needed/)

  // Waived at start with the requester's words: no stop at A.
  assert.throws(() => startPackage(root, 'Another change', { waive: ['A'] }), /Quote the requester/)
  assert.throws(() => startPackage(root, 'Another change', { waive: ['C'], waiver: 'skip' }), /cannot be waived/)
  const waived = startPackage(root, 'Show the agent email on the quote list', {
    waive: ['A'],
    waivedBy: 'Product owner',
    waiver: 'No need to ask me to approve the requirements',
  })
  assert.equal(runUntilGate(waived.dir).gate, 'C')
  const status = readStatus(waived.dir)
  assert.deepEqual(
    { by: status.gates[0].waivedBy, note: status.gates[0].note },
    { by: 'Product owner', note: 'No need to ask me to approve the requirements' },
  )
  assert.match(fs.readFileSync(path.join(waived.dir, 'status.md'), 'utf8'), /\| A \| waived \| Product owner/)
  assert.deepEqual(packageProblems(root, waived.dir), [])
  assert.deepEqual(pullRequestProblems(root, `Work package: ${waived.id}`), [])

  // Merge and business sign-off can never be waived; a waiver needs the words.
  assert.throws(() => waiveGate(asked.dir, 'C', 'Owner', 'skip'), /cannot be waived/)
  assert.throws(() => waiveGate(asked.dir, 'D', 'Owner', 'skip'), /cannot be waived/)
  assert.throws(() => waiveGate(asked.dir, 'A', 'Owner', ''), /Quote the requester/)
  waiveGate(asked.dir, 'A', 'Owner', 'Requirements approval not required')
  assert.throws(() => waiveGate(asked.dir, 'A', 'Owner', 'again'), /already waived/)
  assert.equal(runUntilGate(asked.dir).gate, 'C')
})

test('returns re-run later stages and stop for a person after two', (t) => {
  const root = sandbox(t)
  const { dir } = startPackage(root, 'Fix typo on the dashboard')
  runUntilGate(dir)
  returnToStage(dir, 'developer', 'Wrong label')
  let status = readStatus(dir)
  assert.equal(status.stages.find((stage) => stage.id === 'code-reviewer').status, 'pending')
  assert.equal(nextStep(status).stage.id, 'developer')
  returnToStage(dir, 'developer', 'Still wrong')
  returnToStage(dir, 'developer', 'Third time')
  status = readStatus(dir)
  assert.equal(status.state, 'needs-human')
  assert.match(promptFor(root, dir), /needs a person to decide/)
})

test('CI checks catch stages done past an unapproved gate and leftover placeholders', (t) => {
  const root = sandbox(t)
  const { dir } = startPackage(root, 'Show the agent name on the quote list')
  runUntilGate(dir)
  const status = readStatus(dir)
  status.stages.find((stage) => stage.id === 'software-architect').status = 'done'
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status))
  const problems = packageProblems(root, dir)
  assert.ok(problems.some((problem) => /Software Architect is done but Gate A is not approved/.test(problem)))
  assert.ok(problems.some((problem) => /02-design\.md has \d+ TODO\(agent\)/.test(problem)))
})

test('pull requests must name a work package with gates approved, or declare a quick change', (t) => {
  const root = sandbox(t)
  assert.equal(pullRequestProblems(root, 'Fixes a bug').length, 1)
  assert.deepEqual(pullRequestProblems(root, 'Delivery track: quick — fix label typo'), [])
  assert.equal(pullRequestProblems(root, 'Delivery track: quick').length, 1)
  assert.deepEqual(pullRequestProblems(root, '', 'dependabot[bot]'), [])
  const { id, dir } = startPackage(root, 'Show the agent name on the quote list')
  assert.match(pullRequestProblems(root, `Work package: ${id}`).join(), /Gate A must be approved/)
  runUntilGate(dir)
  approveGate(dir, 'A', 'Product owner')
  assert.deepEqual(pullRequestProblems(root, `Work package: ${id}`), [])
  assert.match(pullRequestProblems(root, 'Work package: WP-9999').join(), /not found/)
})

test('the knowledge report lists files past review and files without metadata', (t) => {
  const root = sandbox(t)
  const base = path.join(root, 'docs/knowledge')
  fs.mkdirSync(path.join(base, 'adr'), { recursive: true })
  fs.writeFileSync(path.join(base, 'old.md'), '---\ntitle: Old\nlast_reviewed: 2026-01-01\nreview_every_days: 30\n---\nx')
  fs.writeFileSync(path.join(base, 'fresh.md'), '---\ntitle: Fresh\nlast_reviewed: 2026-10-01\nreview_every_days: 90\n---\nx')
  fs.writeFileSync(path.join(base, 'bare.md'), '# No metadata')
  fs.writeFileSync(path.join(base, 'adr/0001-x.md'), '# ADR, immutable')
  const report = knowledgeReport(root, new Date('2026-10-18T00:00:00Z'))
  assert.deepEqual(report.due.map((entry) => entry.file), ['docs/knowledge/old.md'])
  assert.deepEqual(report.current.map((entry) => entry.file), ['docs/knowledge/fresh.md'])
  assert.deepEqual(report.missing, ['docs/knowledge/bare.md'])
})

test('the real knowledge base has review metadata on every file', () => {
  assert.deepEqual(knowledgeReport(realRoot).missing, [])
})

test('tool adapters are generated from the contracts and drift is detected', (t) => {
  const root = sandbox(t)
  const files = renderAdapters(root)
  for (const agent of loadAgents(root)) {
    assert.match(files[`.claude/agents/${agent.id}.md`], new RegExp(`^---\\nname: ${agent.id}\\n`))
    assert.ok(files[`.github/prompts/${agent.id}.prompt.md`].includes(agent.body))
  }
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/delivery-flow.mdc'])
    assert.match(files[file], /docs\/delivery\/WORKFLOW\.md/)
  writeAdapters(root)
  assert.deepEqual(drift(root), [])
  // Regenerating is stable: the AGENTS.md block is replaced, not duplicated.
  writeAdapters(root)
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').split('delivery-flow:start').length, 2)
  const contract = path.join(root, 'agents/developer.md')
  fs.writeFileSync(contract, fs.readFileSync(contract, 'utf8').replace('## Mission', '## Mission\n\nChanged.'))
  assert.deepEqual(drift(root).sort(), ['.claude/agents/developer.md', '.github/prompts/developer.prompt.md'])
})

test('the committed adapters match the contracts', () => {
  assert.deepEqual(drift(realRoot), [])
})

// Regression tests for the WP-0001 code review findings.

test('an unedited pull request template does not pass the PR check', (t) => {
  const root = sandbox(t)
  const template = fs.readFileSync(path.join(realRoot, '.github/pull_request_template.md'), 'utf8')
  assert.equal(pullRequestProblems(root, template).length, 1)
  assert.equal(pullRequestProblems(root, 'Delivery track: quick — <one-line reason>').length, 1)
  assert.deepEqual(pullRequestProblems(root, `${template}\nDelivery track: quick — fix label typo`), [])
  startPackage(root, 'Show the agent name on the quote list')
  assert.match(pullRequestProblems(root, 'Work package: WP-00012').join(), /must contain/)
})

test('a stopped package cannot be restarted by returning to another stage; a person resolves it', (t) => {
  const root = sandbox(t)
  const { dir } = startPackage(root, 'Fix typo on the dashboard')
  runUntilGate(dir)
  for (const reason of ['one', 'two', 'three']) returnToStage(dir, 'developer', reason)
  assert.equal(readStatus(dir).state, 'needs-human')
  assert.throws(() => returnToStage(dir, 'unit-test', 'sneak past'), /stopped for a person/)
  assert.throws(() => completeStage(dir, 'developer'), /Nothing to complete/)
  assert.throws(() => resolveNeedsHuman(dir, '', 'go'), /who decided/)
  resolveNeedsHuman(dir, 'Product owner', 'Use the shorter label')
  const status = readStatus(dir)
  assert.equal(status.state, 'in-progress')
  assert.equal(nextStep(status).stage.id, 'developer')
  assert.ok(status.history.some((entry) => entry.event.includes('Product owner resolved the stop: "Use the shorter label"')))
})

test('returning to a stage reopens approvals of the redone work but keeps requester waivers', (t) => {
  const root = sandbox(t)
  const { dir } = startPackage(root, 'Show the agent name on the quote list')
  runUntilGate(dir)
  approveGate(dir, 'A', 'Product owner')
  runUntilGate(dir)
  returnToStage(dir, 'business-analyst', 'Missed the renewal case')
  let status = readStatus(dir)
  assert.equal(status.gates[0].approvedBy, null)
  assert.ok(status.history.at(-1).event.includes('Gate A reopened'))
  assert.equal(runUntilGate(dir).gate, 'A')
  // A return to a later stage leaves Gate A alone.
  approveGate(dir, 'A', 'Product owner')
  runUntilGate(dir)
  returnToStage(dir, 'developer', 'Bug')
  assert.equal(readStatus(dir).gates[0].approvedBy, 'Product owner')

  const waived = startPackage(root, 'Show the agent email on the quote list', { waive: ['A'], waivedBy: 'Owner', waiver: 'No approval needed' })
  runUntilGate(waived.dir)
  returnToStage(waived.dir, 'business-analyst', 'Rework')
  status = readStatus(waived.dir)
  assert.equal(status.gates[0].waivedBy, 'Owner')
  assert.equal(runUntilGate(waived.dir).gate, 'C')
})

test('the orchestrator cannot be returned to, and invalid waivers leave no folder behind', (t) => {
  const root = sandbox(t)
  const { dir } = startPackage(root, 'Fix typo on the dashboard')
  assert.throws(() => returnToStage(dir, 'orchestrator', 'x'), /no output to redo/)
  assert.throws(() => startPackage(root, 'Show the agent name', { waive: ['B'], waiver: 'skip design' }), /not part of the standard track/)
  assert.equal(fs.readdirSync(path.join(root, 'docs/work')).length, 1)
})

test('code review and security stages cannot complete with open severe findings', (t) => {
  const root = sandbox(t)
  const { dir } = startPackage(root, 'Fix typo on the dashboard')
  for (const id of ['developer', 'unit-test']) {
    fillOutput(dir, readStatus(dir).stages.find((stage) => stage.id === id).writes)
    completeStage(dir, id)
  }
  const review = path.join(dir, '07-code-review.md')
  fs.writeFileSync(review, '| Severity | File:line | Finding | Failure scenario | Outcome |\n| --- | --- | --- | --- | --- |\n| Major | a.mjs:1 | Bug | Breaks | open |\n| Minor | b.mjs:2 | Nit | None | open |\n')
  assert.equal(openSevereFindings(review).length, 1)
  assert.throws(() => completeStage(dir, 'code-reviewer'), /open blocker\/major/)
  fs.writeFileSync(review, fs.readFileSync(review, 'utf8').replace('| Breaks | open |', '| Breaks | fixed in abc123 |'))
  completeStage(dir, 'code-reviewer')
})

test('front matter accepts quoted values and generated descriptions are valid YAML strings', (t) => {
  assert.deepEqual(parseFrontMatter('---\nlast_reviewed: "2026-10-01"\ntitle: \'A: b\'\n---\nx').data, { last_reviewed: '2026-10-01', title: 'A: b' })
  const root = sandbox(t)
  const contract = path.join(root, 'agents/developer.md')
  fs.writeFileSync(contract, fs.readFileSync(contract, 'utf8').replace(/^summary: .*$/m, () => 'summary: Builds it: carefully # and costs $& nothing'))
  const files = renderAdapters(root)
  assert.match(files['.claude/agents/developer.md'], /^description: "Builds it: carefully # and costs \$& nothing"$/m)
  assert.ok(files['AGENTS.md'].includes('delivery-flow:start'))
})

test('drift reports generated files whose contract was removed', (t) => {
  const root = sandbox(t)
  writeAdapters(root)
  fs.rmSync(path.join(root, 'agents/knowledge-curator.md'))
  const stale = drift(root)
  assert.ok(stale.includes('.claude/agents/knowledge-curator.md'))
  assert.ok(stale.includes('.github/prompts/knowledge-curator.prompt.md'))
})

test('track suggestions match whole words only', () => {
  assert.equal(suggestTrack('Show the author name on notes').track, 'standard')
  assert.equal(suggestTrack('Update the modeling guide wording').track, 'quick')
  assert.equal(suggestTrack('Add an authorization check').track, 'major')
})

test('agents:sync --check works from a path with spaces', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery spaced '))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = path.join(base, 'repo copy')
  fs.mkdirSync(root)
  for (const dir of ['agents', 'docs/delivery', 'scripts/delivery']) fs.cpSync(path.join(realRoot, dir), path.join(root, dir), { recursive: true })
  fs.copyFileSync(path.join(realRoot, 'AGENTS.md'), path.join(root, 'AGENTS.md'))
  const run = (args) => spawnSync(process.execPath, [path.join(root, 'scripts/delivery/sync-agents.mjs'), ...args], { cwd: root, encoding: 'utf8' })
  const check = run(['--check'])
  assert.equal(check.status, 1, check.stdout + check.stderr)
  assert.match(check.stderr, /out of date/)
  assert.equal(run([]).status, 0)
  assert.equal(run(['--check']).status, 0)
})
