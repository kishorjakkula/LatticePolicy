import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, open, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createProcessor } from '../document-processor/processor.mjs'
import {
  publishProfile,
  activateProfile,
  validateProfile,
} from '../document-processor/profiles.mjs'
import { privateJson } from '../document-processor/private-http.mjs'
import {
  digest,
  validateDataset,
  readJson,
  immutableJson,
  atomicJson,
  trainingMessages,
  learningFeedback,
} from './datasets.mjs'
import { evaluate, compareReports } from './evaluate.mjs'

export async function modelFileDigest(file) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}

export function buildCandidate(dataset, base, version) {
  validateProfile(base)
  if (version === base.version)
    throw new Error('A candidate requires a new profile version')
  const samples = dataset.samples.filter((sample) => sample.split === 'train')
  if (!samples.length) throw new Error('Reviewed training samples are required')
  // One profile per pipeline run; mixing incompatible target profiles is unsafe.
  if (dataset.samples.some((sample) => sample.request.profile !== base.id))
    throw new Error('Dataset profile mismatch')
  const profile = {
    ...base,
    version,
    examples: samples.slice(0, 20).map((sample) => ({
      text: JSON.stringify({
        schema: sample.request.schema,
        documents: sample.request.documents,
      }),
      result: sample.expected,
    })),
  }
  return validateProfile(profile)
}

export async function exportTraining(dataset, tenantId, file) {
  validateDataset(dataset, tenantId)
  const samples = dataset.samples.filter((sample) => sample.split === 'train')
  if (!samples.length) throw new Error('No approved training examples')
  if (
    samples.some((sample) =>
      sample.request.documents.some((document) => !document.textLines.length),
    )
  )
    throw new Error(
      'Weight training requires reviewed local text, not binary inputs',
    )
  const data =
    samples
      .map((sample) => JSON.stringify(trainingMessages(sample)))
      .join('\n') + '\n'
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, data, { flag: 'wx', mode: 0o600 })
  await immutableJson(`${file}.manifest.json`, {
    schemaVersion: 1,
    tenantId,
    datasetSha256: digest(dataset),
    sampleCount: samples.length,
    fileSha256: createHash('sha256').update(data).digest('hex'),
  })
  return { sampleCount: samples.length }
}

/** A resumable offline/operator job, never a background learner of raw uploads. */
export async function runLearning(
  config,
  { extractFactory = createProcessor } = {},
) {
  const {
    tenantId,
    datasetFile,
    baseProfileFile,
    profileVersion,
    model,
    modelArtifactFile,
    modelSha256,
    outputDir,
  } = config
  if (
    typeof model !== 'string' ||
    !model.trim() ||
    model.length > 200 ||
    /[\r\n]/.test(model) ||
    !/^[a-f0-9]{64}$/.test(modelSha256 || '') ||
    typeof outputDir !== 'string'
  )
    throw new Error('Invalid learning configuration')
  const dataset = validateDataset(await readJson(datasetFile), tenantId)
  if ((await modelFileDigest(modelArtifactFile)) !== modelSha256)
    throw new Error('Local model artifact digest mismatch')
  const profile = buildCandidate(
    dataset,
    await readJson(baseProfileFile),
    profileVersion,
  )
  const artifacts = {
    profileId: profile.id,
    profileVersion: profile.version,
    profileSha256: digest(profile),
    model,
    modelSha256,
  }
  const baseline = config.baselineReportFile
    ? await readJson(config.baselineReportFile)
    : null
  const runId = digest({
    tenantId,
    dataset: digest(dataset),
    artifacts,
    baseline: baseline ? digest(baseline) : null,
  })
  const directory = path.join(outputDir, runId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const lockFile = path.join(directory, '.run.lock')
  const lock = await open(lockFile, 'wx', 0o600)
  const stateFile = path.join(directory, 'state.json')
  try {
    try {
      const previous = await readJson(stateFile)
      if (previous.status === 'READY_FOR_REGISTRATION') {
        const report = await readJson(path.join(directory, 'evaluation.json'))
        const candidate = await readJson(path.join(directory, 'candidate.json'))
        if (
          digest(report) !== candidate.evaluation.reportSha256 ||
          digest(candidate.artifacts) !== digest(artifacts) ||
          !report.passed
        )
          throw new Error('Completed run artifacts changed')
        return { runId, directory, candidate, report, reused: true }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await atomicJson(stateFile, {
      schemaVersion: 1,
      tenantId,
      runId,
      status: 'EVALUATING',
    })
    const profilesDir = path.join(directory, 'profiles')
    try {
      await publishProfile(profilesDir, profile)
    } catch (error) {
      if (
        error.code !== 'EEXIST' ||
        digest(
          await readJson(
            path.join(profilesDir, profile.id, `${profile.version}.json`),
          ),
        ) !== digest(profile)
      )
        throw error
    }
    // This directory belongs only to evaluation; application production pointers are untouched.
    await activateProfile(profilesDir, profile.id, profile.version)
    const extract = extractFactory({
      profilesDir,
      modelUrl: config.modelUrl,
      model,
      modelToken: process.env.LEARNING_MODEL_TOKEN || '',
    })
    const report = await evaluate(dataset, { tenantId, extract, artifacts })
    if (baseline) {
      report.regression = compareReports(baseline, report)
      report.passed = report.passed && report.regression.passed
    }
    const reportFile = path.join(directory, 'evaluation.json')
    await atomicJson(reportFile, report)
    const candidate = {
      versionLabel: `candidate-${runId}`,
      artifacts,
      evaluation: { ...report.metrics, reportSha256: digest(report) },
    }
    await atomicJson(
      path.join(directory, 'feedback-summary.json'),
      learningFeedback(dataset),
    )
    if (!report.passed) {
      await atomicJson(stateFile, {
        schemaVersion: 1,
        tenantId,
        runId,
        status: 'EVALUATION_FAILED',
        reportSha256: digest(report),
      })
      return { runId, directory, report, candidate: null, reused: false }
    }
    await atomicJson(path.join(directory, 'candidate.json'), candidate)
    await atomicJson(stateFile, {
      schemaVersion: 1,
      tenantId,
      runId,
      status: 'READY_FOR_REGISTRATION',
      reportSha256: digest(report),
    })
    return { runId, directory, report, candidate, reused: false }
  } catch (error) {
    await atomicJson(stateFile, {
      schemaVersion: 1,
      tenantId,
      runId,
      status: 'FAILED',
    }).catch(() => {})
    throw error
  } finally {
    await lock.close()
    await unlink(lockFile)
  }
}

export async function registerCandidate(
  directory,
  { apiUrl, tenantId, token, request = privateJson },
) {
  const state = await readJson(path.join(directory, 'state.json'))
  const candidate = await readJson(path.join(directory, 'candidate.json'))
  const report = await readJson(path.join(directory, 'evaluation.json'))
  if (
    state.tenantId !== tenantId ||
    state.status !== 'READY_FOR_REGISTRATION' ||
    !report.passed ||
    report.tenantId !== tenantId ||
    digest(report) !== candidate.evaluation.reportSha256 ||
    digest(report.artifacts) !== digest(candidate.artifacts) ||
    digest(report.metrics) !==
      digest(
        Object.fromEntries(
          Object.entries(candidate.evaluation).filter(
            ([key]) => key !== 'reportSha256',
          ),
        ),
      )
  )
    throw new Error('Candidate/report identity mismatch or failed evaluation')
  if (!token || typeof token !== 'string')
    throw new Error('A scoped automation identity token is required')
  const base = new URL(apiUrl)
  if (
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error('Use a private API origin')
  const endpoint = new URL('/api/v1/admin/llm/releases', base)
  endpoint.searchParams.set('tenant', tenantId)
  const result = await request(endpoint.toString(), candidate, {
    token,
    timeoutMs: 30000,
  })
  await atomicJson(path.join(directory, 'registration.json'), {
    schemaVersion: 1,
    tenantId,
    versionLabel: candidate.versionLabel,
    reportSha256: digest(report),
    registered: true,
  })
  return result
}
