import { parseArgs } from 'node:util'
import { closeDb, initDb } from '../src/db.js'
import { assertBusinessownersDemoOptIn, seedBusinessownersDemo } from '../src/services/businessowners-demo.service.js'

async function main() {
  const { values } = parseArgs({ options: {
    enable: { type: 'boolean', default: false },
    tenant: { type: 'string' },
    'operator-user-id': { type: 'string' },
    'agent-user-id': { type: 'string' },
    'effective-date': { type: 'string' },
    'issue-example': { type: 'boolean', default: false },
  }, strict: true, allowPositionals: false })
  const options = { enabled: values.enable, tenantId: values.tenant || '', operatorUserId: values['operator-user-id'] || '',
    agentUserId: values['agent-user-id'] || '', effectiveDate: values['effective-date'] || '', issueExample: values['issue-example'] }
  // Reject unsafe options before initDb can apply migrations to a database.
  assertBusinessownersDemoOptIn(options)
  if (!process.env.DATABASE_URL) throw new Error('BOP_DEMO_DATABASE_REQUIRED')
  await initDb()
  const result = await seedBusinessownersDemo(options)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.blockers.length) process.exitCode = 2
}

main().catch(error => {
  const message = String(error?.message || '')
  process.stderr.write(`${/^BOP_DEMO_[A-Z0-9_:.-]+$/i.test(message) ? message : 'BOP_DEMO_SETUP_FAILED'}\n`)
  process.exitCode = 1
}).finally(async () => {
  await closeDb()
  // Imported services leave cache and worker handles open; a CLI must still end.
  process.exit(process.exitCode ?? 0)
})
