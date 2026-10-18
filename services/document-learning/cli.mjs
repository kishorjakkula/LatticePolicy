import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { immutableJson, readJson, syntheticDataset } from './datasets.mjs'
import { runLearning, exportTraining, registerCandidate } from './pipeline.mjs'
import { compareReports } from './evaluate.mjs'
import { runOfflineTraining } from './training-runner.mjs'

export async function main(args, env = process.env) {
  const [command, file, output, extra] = args
  if (command === 'train' && file && !output)
    return await runOfflineTraining(await readJson(file), { env })
  if (command === 'synthetic' && file && !extra) {
    await immutableJson(file, syntheticDataset(output || 'synthetic-carrier'))
    return { status: 'SYNTHETIC_DATASET_CREATED' }
  }
  if (command === 'run' && file && !output) {
    const config = await readJson(file)
    const result = await runLearning(config)
    if (!result.report.passed) process.exitCode = 2
    if (result.candidate && config.registerOnSuccess === true) {
      await registerCandidate(result.directory, {
        apiUrl: config.apiUrl,
        tenantId: config.tenantId,
        token: env.LEARNING_API_TOKEN,
      })
      return { status: 'REGISTERED_FOR_ADMIN_REVIEW', runId: result.runId }
    }
    return {
      status: result.candidate ? 'READY_FOR_REGISTRATION' : 'EVALUATION_FAILED',
      runId: result.runId,
    }
  }
  if (command === 'compare' && file && output && extra) {
    const report = compareReports(await readJson(file), await readJson(output))
    await immutableJson(extra, report)
    if (!report.passed) process.exitCode = 2
    return { status: report.passed ? 'NO_REGRESSION' : 'REGRESSION_DETECTED' }
  }
  if (command === 'export-training' && file && output && extra) {
    const result = await exportTraining(await readJson(file), extra, output)
    return { status: 'TRAINING_DATA_EXPORTED', ...result }
  }
  if (command === 'register' && file && output && extra)
    return await registerCandidate(file, {
      apiUrl: output,
      tenantId: extra,
      token: env.LEARNING_API_TOKEN,
    })
  throw new Error(
    'Usage: cli.mjs synthetic FILE [TENANT] | run CONFIG | train CONFIG | export-training DATASET JSONL TENANT | register RUN_DIRECTORY PRIVATE_API_ORIGIN TENANT | compare BASELINE CANDIDATE REPORT',
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const result = await main(process.argv.slice(2))
    // Only a fixed metadata allowlist is printed; never echo model/API error bodies.
    console.log(
      JSON.stringify({
        status: result?.status || 'REGISTERED',
        ...(result?.runId ? { runId: result.runId } : {}),
      }),
    )
  } catch {
    console.error(
      'Learning job failed. Check private configuration, reviewed dataset, and local run state.',
    )
    process.exitCode = 1
  }
}
