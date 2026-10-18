#!/usr/bin/env node
// Delivery flow CLI: npm run flow -- <command>. See docs/delivery/WORKFLOW.md.
import path from 'node:path'
import {
  approveGate,
  completeStage,
  findPackage,
  listPackages,
  promptFor,
  readStatus,
  renderStatus,
  repoRoot,
  returnToStage,
  startPackage,
  waiveGate,
} from './lib.mjs'

const USAGE = `Usage: npm run flow -- <command>
  start "<request>" [--track quick|standard|major] [--reason "<why>"]
        [--waive A[,B] --by "<requester>" --note "<their words>"]
  next <WP>                       prompt for the next agent (any AI tool)
  status <WP>                     stages, gates and history
  complete <WP> <agent-id>        mark the current stage done
  approve <WP> <A|B|C|D> --by "<name>" [--note "<their words>"]
  waive <WP> <A|B> --by "<requester>" --note "<their words saying it is not needed>"
  return <WP> <agent-id> --reason "<why>"
  list                            all work packages`

function option(args, name) {
  const index = args.indexOf(`--${name}`)
  if (index < 0) return undefined
  const value = args[index + 1]
  args.splice(index, 2)
  return value
}

function main(argv) {
  const args = [...argv]
  const command = args.shift()
  const root = repoRoot()
  switch (command) {
    case 'start': {
      const track = option(args, 'track')
      const reason = option(args, 'reason')
      const waive = option(args, 'waive')
      const waivedBy = option(args, 'by')
      const waiver = option(args, 'note')
      const { id, dir, status } = startPackage(root, args.join(' '), {
        track,
        reason,
        waive: waive ? waive.split(',').map((gate) => gate.trim()).filter(Boolean) : [],
        waivedBy,
        waiver,
      })
      console.log(`Started ${id} on the ${status.track} track (${status.trackReason}).`)
      console.log(`Work package: ${path.relative(root, dir)}/\n`)
      console.log(promptFor(root, dir))
      return
    }
    case 'next':
      console.log(promptFor(root, findPackage(root, args[0])))
      return
    case 'status':
      console.log(renderStatus(readStatus(findPackage(root, args[0]))))
      return
    case 'complete': {
      const dir = findPackage(root, args[0])
      completeStage(dir, args[1])
      console.log(`${args[1]} completed.\n`)
      console.log(promptFor(root, dir))
      return
    }
    case 'approve': {
      const by = option(args, 'by')
      const note = option(args, 'note')
      const dir = findPackage(root, args[0])
      approveGate(dir, args[1], by, note)
      console.log(`Gate ${String(args[1]).toUpperCase()} recorded.\n`)
      console.log(promptFor(root, dir))
      return
    }
    case 'waive': {
      const by = option(args, 'by')
      const note = option(args, 'note')
      const dir = findPackage(root, args[0])
      waiveGate(dir, args[1], by, note)
      console.log(`Gate ${String(args[1]).toUpperCase()} waived.\n`)
      console.log(promptFor(root, dir))
      return
    }
    case 'return': {
      const reason = option(args, 'reason')
      const dir = findPackage(root, args[0])
      const status = returnToStage(dir, args[1], reason)
      console.log(status.state === 'needs-human' ? `Stopped: ${status.needsHumanReason}. A person must decide.` : promptFor(root, dir))
      return
    }
    case 'list':
      for (const name of listPackages(root)) {
        const status = readStatus(path.join(root, 'docs', 'work', name))
        console.log(`${status.id}  ${status.track.padEnd(8)} ${status.state.padEnd(12)} ${status.title}`)
      }
      return
    default:
      console.log(USAGE)
      if (command && command !== 'help') process.exitCode = 1
  }
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
