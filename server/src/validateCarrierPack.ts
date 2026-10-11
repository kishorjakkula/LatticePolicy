import path from 'path'
import { getPinnedTenantId } from './config.js'
import { getCarrierPackDir } from './lib/carrier-pack.js'
import { formatCarrierPackValidation, validateCarrierPack } from './lib/carrier-pack-validator.js'

// Checks a carrier pack against this release without starting anything:
//
//   node server/dist/validateCarrierPack.js <pack-dir>     (or CARRIER_PACK_DIR)
//   node server/dist/validateCarrierPack.js <pack-dir> --json
//
// Run it with the image of the release you plan to take to see whether the
// pack still fits. Exits 0 when the pack loads, 1 when it does not.

const args = process.argv.slice(2)
const json = args.includes('--json')
const dirArg = args.find((arg) => !arg.startsWith('--'))
const dir = dirArg ? path.resolve(dirArg) : getCarrierPackDir()

if (!dir) {
  console.error('usage: validateCarrierPack <pack-dir> [--json]   (or set CARRIER_PACK_DIR)')
  process.exit(2)
}

const validation = validateCarrierPack(dir, { expectedCarrier: getPinnedTenantId() })
console.log(json ? JSON.stringify(validation, null, 2) : formatCarrierPackValidation(validation))
process.exit(validation.ok ? 0 : 1)
