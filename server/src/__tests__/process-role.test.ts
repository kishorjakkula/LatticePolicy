import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getProcessRole, planProcess } from '../config.js'

describe('process roles', () => {
  const original = process.env.LATTICE_ROLE

  beforeEach(() => {
    delete process.env.LATTICE_ROLE
  })

  afterEach(() => {
    if (original === undefined) delete process.env.LATTICE_ROLE
    else process.env.LATTICE_ROLE = original
  })

  it('defaults to running everything, as existing deployments do', () => {
    expect(getProcessRole()).toBe('all')
    process.env.LATTICE_ROLE = '  '
    expect(getProcessRole()).toBe('all')
  })

  it('reads the configured role and rejects an unknown one', () => {
    process.env.LATTICE_ROLE = ' Worker '
    expect(getProcessRole()).toBe('worker')
    process.env.LATTICE_ROLE = 'cron'
    expect(() => getProcessRole()).toThrow(/LATTICE_ROLE must be one of all, api, worker, dispatcher; got 'cron'/)
  })

  it('starts the API and both loops in the all role, without requiring a database', () => {
    expect(planProcess('all')).toEqual({ role: 'all', http: 'api', jobWorker: true, dispatcher: true, requiresDatabase: false })
  })

  it('keeps background loops out of a dedicated API process', () => {
    expect(planProcess('api')).toEqual({ role: 'api', http: 'api', jobWorker: false, dispatcher: false, requiresDatabase: false })
  })

  it('gives a worker or dispatcher exactly its own loop, probes only, and a required database', () => {
    expect(planProcess('worker')).toEqual({ role: 'worker', http: 'probe', jobWorker: true, dispatcher: false, requiresDatabase: true })
    expect(planProcess('dispatcher')).toEqual({ role: 'dispatcher', http: 'probe', jobWorker: false, dispatcher: true, requiresDatabase: true })
  })
})
