import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readJson } from './datasets.mjs'
import { modelFileDigest } from './pipeline.mjs'

const execute = promisify(execFile)

/** Fixed local adapter only: datasets never select an executable or shell. */
export async function runOfflineTraining(
  config,
  { run = execute, env = process.env } = {},
) {
  if (
    config?.dataApproved !== true ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(config.tenantId || '') ||
    ['modelDir', 'trainingFile', 'outputDir'].some(
      (key) => typeof config[key] !== 'string' || !config[key],
    )
  )
    throw new Error('Approved local training configuration required')
  const limits = {
    epochs: [config.epochs ?? 1, 1, 10],
    maxSteps: [config.maxSteps ?? 100, 1, 10000],
    maxSequenceLength: [config.maxSequenceLength ?? 2048, 32, 8192],
    timeoutSeconds: [config.timeoutSeconds ?? 3600, 1, 86400],
  }
  for (const [value, low, high] of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < low || value > high)
      throw new Error('Invalid training budget')
  const manifest = await readJson(`${config.trainingFile}.manifest.json`)
  if (
    manifest.schemaVersion !== 1 ||
    manifest.tenantId !== config.tenantId ||
    !Number.isInteger(manifest.sampleCount) ||
    manifest.sampleCount < 1 ||
    manifest.sampleCount > 1000 ||
    !/^[a-f0-9]{64}$/.test(manifest.datasetSha256 || '') ||
    manifest.fileSha256 !== (await modelFileDigest(config.trainingFile))
  )
    throw new Error('Approved training export mismatch')
  const args = [
    fileURLToPath(new URL('./training/train.py', import.meta.url)),
    '--model',
    path.resolve(config.modelDir),
    '--data',
    path.resolve(config.trainingFile),
    '--output',
    path.resolve(config.outputDir),
    '--tenant',
    config.tenantId,
    '--data-approved',
    '--epochs',
    String(limits.epochs[0]),
    '--max-steps',
    String(limits.maxSteps[0]),
    '--max-sequence-length',
    String(limits.maxSequenceLength[0]),
  ]
  let result
  try {
    result = await run('python3', args, {
      shell: false,
      timeout: limits.timeoutSeconds[0] * 1000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: env.PATH,
        HOME: path.dirname(path.resolve(config.outputDir)),
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        HF_DATASETS_OFFLINE: '1',
        HF_HUB_DISABLE_TELEMETRY: '1',
        DO_NOT_TRACK: '1',
        WANDB_DISABLED: 'true',
        ...(env.CUDA_VISIBLE_DEVICES
          ? { CUDA_VISIBLE_DEVICES: env.CUDA_VISIBLE_DEVICES }
          : {}),
      },
    })
  } catch {
    throw new Error('Offline training failed or exceeded its budget')
  }
  const output = JSON.parse(result.stdout)
  if (
    output.status !== 'TRAINED_NOT_EVALUATED' ||
    output.tenantId !== config.tenantId ||
    output.trainingFileSha256 !== manifest.fileSha256 ||
    output.sampleCount !== manifest.sampleCount
  )
    throw new Error('Offline training result identity mismatch')
  return { status: output.status, sampleCount: output.sampleCount }
}
