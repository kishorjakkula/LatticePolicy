import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { login, prepare } from './pilot-lib.mjs'

const profile = JSON.parse(fs.readFileSync('deploy/pilot/standards.json', 'utf8'))
const root = path.resolve('.pilot')
const kit = path.join(root, 'kit')
fs.mkdirSync(root, { recursive: true, mode: 0o700 })
fs.mkdirSync(kit, { recursive: true, mode: 0o700 })
for (const name of ['stack.sh', 'docker-compose.yml', 'carrier.env.example']) fs.copyFileSync(`deploy/carrier-stack/${name}`, path.join(kit, name))
fs.mkdirSync(path.join(kit, 'no-pack'), { recursive: true })
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()
if (dirty) throw new Error('Commit the reviewed tracked changes before building a traceable pilot release.')
const tag = `pilot-${sha.slice(0, 12)}`
const envFile = path.join(kit, 'carrier.env')
const credentials = path.join(root, 'credentials.json')
if (!fs.existsSync(envFile)) {
  execFileSync('sh', [path.join(kit, 'stack.sh'), 'init', profile.tenantId, tag], { stdio: 'inherit' })
  const password = `Pilot!${crypto.randomBytes(24).toString('hex')}`
  fs.writeFileSync(credentials, JSON.stringify({ username: 'pilot-admin', password }), { mode: 0o600 })
}
const pack = path.join(root, 'pack')
fs.mkdirSync(path.join(pack, 'fields'), { recursive: true })
fs.mkdirSync(path.join(pack, 'screens'), { recursive: true })
if (!fs.existsSync(path.join(pack, 'pack.yaml'))) {
  fs.writeFileSync(path.join(pack, 'pack.yaml'), `packFormat: 1\ncarrier: ${profile.tenantId}\nversion: 1.0.0\nname: ${profile.name}\n`)
  fs.writeFileSync(path.join(pack, 'config.yaml'), `tenantId: ${profile.tenantId}\nenabledProducts: [homeowners]\n`)
}
const values = {
  CARRIER_NAME: profile.name, LATTICE_VERSION: tag, LATTICE_API_IMAGE: 'latticepolicy-pilot-api',
  LATTICE_FRONTEND_IMAGE: 'latticepolicy-pilot-ui', LATTICE_PULL: '0', CARRIER_PACK_PATH: pack,
  DEPLOYMENT_ENV: 'local', PUBLIC_API_URL: profile.apiUrl, ALLOWED_ORIGINS: profile.uiUrl,
  API_PORT: '3310', UI_PORT: '5180', HOST_BIND: '127.0.0.1',
}
let env = fs.readFileSync(envFile, 'utf8')
for (const [key, value] of Object.entries(values)) {
  const re = new RegExp(`^${key}=.*$`, 'm')
  env = re.test(env) ? env.replace(re, `${key}=${value}`) : `${env}\n${key}=${value}\n`
}
fs.writeFileSync(envFile, env, { mode: 0o600 })
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...options })
run('docker', ['build', '-f', 'server/Dockerfile', '--build-arg', `BUILD_COMMIT=${sha}`, '-t', `latticepolicy-pilot-api:${tag}`, '.'])
run('docker', ['build', '-f', 'frontend/Dockerfile', '-t', `latticepolicy-pilot-ui:${tag}`, '.'])
run('sh', [path.join(kit, 'stack.sh'), 'up'])
const auth = JSON.parse(fs.readFileSync(credentials, 'utf8'))
run('sh', [path.join(kit, 'stack.sh'), 'bootstrap'], { env: { ...process.env, CARRIER_ADMIN_USERNAME: auth.username, CARRIER_ADMIN_PASSWORD: auth.password } })
await prepare((await login()).token)
const imageId = name => execFileSync('docker', ['image', 'inspect', `${name}:${tag}`, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim()
fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify({ sha, tag, builtAt: new Date().toISOString(),
  apiImage: imageId('latticepolicy-pilot-api'), frontendImage: imageId('latticepolicy-pilot-ui'), profile }, null, 2))
console.log(`Pilot ready at ${profile.uiUrl}; credentials are in .pilot/credentials.json (local only).`)
