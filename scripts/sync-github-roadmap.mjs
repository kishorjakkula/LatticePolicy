#!/usr/bin/env node
import fs from 'node:fs'

const repo = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
const dryRun = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run')

if (!repo) {
  console.error('GITHUB_REPOSITORY is required, for example kishorjakkula/LatticePolicy.')
  process.exit(1)
}

if (!token && !dryRun) {
  console.error('GITHUB_TOKEN is required unless --dry-run or DRY_RUN=1 is set.')
  process.exit(1)
}

function parseItems(file) {
  const items = []
  let current = null
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const start = line.match(/^-\s+([^:]+):\s*(.*)$/)
    const prop = line.match(/^\s+([^:]+):\s*(.*)$/)
    if (start) {
      current = {}
      items.push(current)
      current[start[1].trim()] = clean(start[2])
    } else if (prop && current) {
      current[prop[1].trim()] = clean(prop[2])
    }
  }
  return items
}

function clean(value) {
  return String(value || '').trim().replace(/^"|"$/g, '')
}

async function request(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  })
  if (response.status === 204) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${JSON.stringify(body)}`)
  }
  return body
}

async function syncLabels() {
  const labels = parseItems('.github/labels.yml')
  const existing = dryRun ? [] : await request('/labels?per_page=100')
  const byName = new Map(existing.map((label) => [label.name, label]))

  for (const label of labels) {
    const payload = {
      name: label.name,
      color: label.color,
      description: label.description || '',
    }
    const current = byName.get(label.name)
    if (dryRun) {
      console.log(`[dry-run] sync label ${label.name}`)
    } else if (current) {
      await request(`/labels/${encodeURIComponent(label.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: payload.color, description: payload.description }),
      })
      console.log(`Updated label ${label.name}`)
    } else {
      await request('/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      console.log(`Created label ${label.name}`)
    }
  }
}

async function syncMilestones() {
  const milestones = parseItems('.github/milestones.yml')
  const existing = dryRun ? [] : await request('/milestones?state=all&per_page=100')
  const byTitle = new Map(existing.map((milestone) => [milestone.title, milestone]))

  for (const milestone of milestones) {
    const current = byTitle.get(milestone.title)
    if (dryRun) {
      console.log(`[dry-run] sync milestone ${milestone.title}`)
    } else if (current) {
      await request(`/milestones/${current.number}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: milestone.description, state: 'open' }),
      })
      console.log(`Updated milestone ${milestone.title}`)
    } else {
      await request('/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: milestone.title, description: milestone.description }),
      })
      console.log(`Created milestone ${milestone.title}`)
    }
  }
}

await syncLabels()
await syncMilestones()
