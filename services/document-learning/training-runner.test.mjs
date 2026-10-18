import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { syntheticDataset, readJson } from './datasets.mjs'
import { exportTraining } from './pipeline.mjs'
import { runOfflineTraining } from './training-runner.mjs'

test('fixed offline adapter checks carrier exports and strips unrelated credentials', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-train-runner-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const data = syntheticDataset(),
    trainingFile = path.join(dir, 'approved.jsonl')
  await exportTraining(data, data.tenantId, trainingFile)
  const manifest = await readJson(`${trainingFile}.manifest.json`)
  const config = {
    tenantId: data.tenantId,
    modelDir: path.join(dir, 'base'),
    trainingFile,
    outputDir: path.join(dir, 'adapter'),
    dataApproved: true,
  }
  let calls = 0
  const run = async (command, args, options) => {
    calls++
    assert.equal(command, 'python3')
    assert.equal(options.shell, false)
    assert.ok(args[0].endsWith('/training/train.py'))
    assert.equal(options.env.LEARNING_API_TOKEN, undefined)
    assert.equal(options.env.LLM_RELEASE_SIGNING_KEY, undefined)
    assert.equal(options.env.HF_HUB_OFFLINE, '1')
    return {
      stdout: JSON.stringify({
        status: 'TRAINED_NOT_EVALUATED',
        tenantId: data.tenantId,
        trainingFileSha256: manifest.fileSha256,
        sampleCount: 6,
      }),
    }
  }
  assert.equal(
    (
      await runOfflineTraining(config, {
        run,
        env: {
          PATH: process.env.PATH,
          LEARNING_API_TOKEN: 'never-in-child',
          LLM_RELEASE_SIGNING_KEY: 'never-in-child',
        },
      })
    ).status,
    'TRAINED_NOT_EVALUATED',
  )
  await assert.rejects(
    runOfflineTraining({ ...config, dataApproved: false }, { run }),
    /Approved/,
  )
  await assert.rejects(
    runOfflineTraining({ ...config, tenantId: 'other' }, { run }),
    /mismatch/,
  )
  await assert.rejects(
    runOfflineTraining({ ...config, epochs: 11 }, { run }),
    /budget/,
  )
  await assert.rejects(
    runOfflineTraining(config, {
      run: async () => {
        throw new Error('sensitive-data')
      },
    }),
    (error) =>
      error.message === 'Offline training failed or exceeded its budget',
  )
  await writeFile(trainingFile, 'changed')
  await assert.rejects(runOfflineTraining(config, { run }), /mismatch/)
  assert.equal(calls, 1)
})
