import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Exercise the real shell script against a stateful Compose adapter. The
// separate pilot drill exercises Docker/Postgres; these tests cover failure
// ordering deterministically, without touching any local deployment.
function fixture(t, failure = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-stack-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const kit = path.join(dir, 'kit')
  fs.mkdirSync(kit)
  fs.copyFileSync('deploy/carrier-stack/stack.sh', path.join(kit, 'stack.sh'))
  const envFile = path.join(kit, 'carrier.env')
  fs.writeFileSync(envFile, 'CARRIER_TENANT_ID=test-carrier\nLATTICE_VERSION=v0.2.3\nLATTICE_PULL=0\nDB_USER=test\nDB_NAME=test\n')
  fs.writeFileSync(path.join(dir, 'database'), 'accepted-before-stop')
  fs.mkdirSync(path.join(dir, 'documents'))
  fs.writeFileSync(path.join(dir, 'documents', 'packet'), 'original-document')
  fs.writeFileSync(path.join(dir, 'docker'), `#!/usr/bin/env node
const fs=require('fs'),path=require('path'),cp=require('child_process');
const a=process.argv.slice(2),d=process.env.FAKE_STACK_DIR,f=process.env.FAKE_FAILURE;
fs.appendFileSync(path.join(d,'calls'),JSON.stringify(a)+'\\n');
const fail=(s)=>{if(f===s)process.exit(1)};
if(a.includes('ps')){console.log('api\\nworker\\ndispatcher\\nfrontend');process.exit(0)}
if(a.includes('stop')){fail('stop');fs.writeFileSync(path.join(d,'stopped'),'yes');process.exit(0)}
if(a.includes('pg_dump')){fail('backup');if(!fs.existsSync(path.join(d,'stopped')))process.exit(2);process.stdout.write(fs.readFileSync(path.join(d,'database')));process.exit(0)}
if(a.includes('tar')){fail('documents');process.stdout.write(cp.execFileSync('tar',['-czf','-','-C',path.join(d,'documents'),'.']));process.exit(0)}
if(a.includes('pg_restore')){fs.writeFileSync(path.join(d,'database'),fs.readFileSync(0));process.exit(0)}
if(a.includes('sh')&&a.some(x=>x.includes('tar -xzf'))){cp.execFileSync('tar',['-xzf','-','-C',path.join(d,'documents')],{input:fs.readFileSync(0)});process.exit(0)}
if(a.some(x=>x.endsWith('/migrate.js'))){fs.writeFileSync(path.join(d,'database'),'migration-write');fail('migration')}
if(a.includes('wget')){const e=fs.readFileSync(a[a.indexOf('--env-file')+1],'utf8'),v=e.match(/^LATTICE_VERSION=(.*)$/m)[1];console.log(a.at(-1).endsWith('/health')?'{"db":true,"cache":true}':JSON.stringify({version:v.replace(/^v/,''),schema:{schemaAhead:false}}))}
`)
  fs.chmodSync(path.join(dir, 'docker'), 0o755)
  const run = (...args) => spawnSync('sh', [path.join(kit, 'stack.sh'), ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_STACK_DIR: dir, FAKE_FAILURE: failure },
  })
  const calls = () => fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse)
  return { dir, envFile, run, calls }
}

test('upgrade stops every writer before dumping and keeps them stopped through migration', t => {
  const f = fixture(t)
  const r = f.run('upgrade', 'v0.2.4')
  assert.equal(r.status, 0, r.stderr)
  const c = f.calls()
  assert(c.findIndex(x => x.includes('stop')) < c.findIndex(x => x.includes('pg_dump')))
  const dump = c.findIndex(x => x.includes('pg_dump')), migrate = c.findIndex(x => x.some(y => y.endsWith('/migrate.js')))
  assert(!c.slice(dump, migrate).some(x => x.includes('up') && x.includes('api')))
})

test('failed migration restores accepted transactions and original release', t => {
  const f = fixture(t, 'migration')
  assert.notEqual(f.run('upgrade', 'v0.2.4').status, 0)
  assert.equal(fs.readFileSync(path.join(f.dir, 'database'), 'utf8'), 'accepted-before-stop')
  assert.equal(fs.readFileSync(path.join(f.dir, 'documents', 'packet'), 'utf8'), 'original-document')
  assert.match(fs.readFileSync(f.envFile, 'utf8'), /LATTICE_VERSION=v0.2.3/)
})

for (const failure of ['backup', 'documents', 'stop']) test(`${failure} failure resumes the old services without changing the release`, t => {
  const f = fixture(t, failure)
  assert.notEqual(f.run('upgrade', 'v0.2.4').status, 0)
  assert.match(fs.readFileSync(f.envFile, 'utf8'), /LATTICE_VERSION=v0.2.3/)
  assert(f.calls().some(x => x.includes('up') && x.includes('api') && x.includes('worker') && x.includes('dispatcher')))
  assert(!f.calls().some(x => x.some(y => y.endsWith('/migrate.js'))))
})

test('standalone backup pauses writers and returns a complete archive pair', t => {
  const f = fixture(t)
  const r = f.run('backup', 'nightly')
  assert.equal(r.status, 0, r.stderr)
  assert(fs.statSync(`${r.stdout.trim()}.dump`).size > 0)
  assert(fs.statSync(`${r.stdout.trim()}.documents.tgz`).size > 0)
  assert(f.calls().some(x => x.includes('up') && x.includes('api')))
  const calls = f.calls()
  const resumed = calls.findIndex(x => x.includes('up') && x.includes('api'))
  assert(calls.slice(resumed + 1).some(x => x.includes('wget') && x.at(-1).endsWith('/health')))
})

test('restore rejects a missing document archive before stopping or replacing data', t => {
  const f = fixture(t)
  const prefix = path.join(f.dir, 'incomplete')
  fs.writeFileSync(`${prefix}.dump`, 'dump')
  assert.notEqual(f.run('restore', prefix).status, 0)
  assert(!fs.existsSync(path.join(f.dir, 'calls')))
  assert.equal(fs.readFileSync(path.join(f.dir, 'database'), 'utf8'), 'accepted-before-stop')
})
