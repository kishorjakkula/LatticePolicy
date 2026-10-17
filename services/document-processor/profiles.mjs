import { readFile, mkdir, writeFile, link, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
export function validateProfile(profile) {
  if (!profile || profile.schemaVersion !== 1 || !ID.test(profile.id) || !VERSION.test(profile.version)) throw new Error('Invalid profile identity/version');
  if (profile.dataPolicy !== 'synthetic-or-consented' || profile.reviewed !== true) throw new Error('Only reviewed, synthetic or explicitly consented examples may be published');
  if (typeof profile.instructions !== 'string' || !profile.instructions.trim() || profile.instructions.length > 10000) throw new Error('Invalid profile instructions');
  if (!Array.isArray(profile.examples) || profile.examples.length > 20) throw new Error('At most 20 examples are permitted');
  for (const example of profile.examples) {
    if (typeof example.text !== 'string' || !example.text.trim() || example.text.length > 10000 || !example.result || typeof example.result !== 'object' || Array.isArray(example.result)) throw new Error('Invalid extraction example');
  }
  if (Buffer.byteLength(JSON.stringify(profile)) > 256 * 1024) throw new Error('Profile exceeds 256 KB');
  return profile;
}

export async function loadProfile(directory, id) {
  if (!ID.test(id)) throw new Error('Invalid profile id');
  const active = JSON.parse(await readFile(path.join(directory, 'active.json'), 'utf8'));
  const version = active[id];
  if (!VERSION.test(version || '')) throw new Error('Profile has no active version');
  const profile = validateProfile(JSON.parse(await readFile(path.join(directory, id, `${version}.json`), 'utf8')));
  if (profile.id !== id || profile.version !== version) throw new Error('Profile identity mismatch');
  return profile;
}

/** Immutable releases. Activation is an atomic pointer change, read on each run. */
export async function publishProfile(directory, profile) {
  validateProfile(profile);
  const destination = path.join(directory, profile.id);
  await mkdir(destination, { recursive: true });
  const temporary = path.join(destination, `.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(profile, null, 2), { mode: 0o644, flag: 'wx' });
  try { await link(temporary, path.join(destination, `${profile.version}.json`)); }
  finally { await unlink(temporary); }
}

export async function activateProfile(directory, id, version, authorization = null, policy = null) {
  if (!ID.test(id) || !VERSION.test(version)) throw new Error('Invalid profile identity/version');
  const profile = validateProfile(JSON.parse(await readFile(path.join(directory, id, `${version}.json`), 'utf8')));
  if (profile.id !== id || profile.version !== version) throw new Error('Profile identity mismatch');
  if (policy) {
    const { verifyAuthorization } = await import('./release-authorization.mjs');
    verifyAuthorization(authorization,policy,profile);
  }
  // A single operator publishes/activates profiles; concurrent writers fail closed.
  const lock = path.join(directory, '.activation.lock');
  await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    if (policy) {
      const destination=path.join(directory,id,`${version}.authorization.json`);
      const receipt=`${destination}.${randomUUID()}.tmp`;
      try { await writeFile(receipt,JSON.stringify(authorization),{mode:0o644,flag:'wx'}); await rename(receipt,destination); }
      finally { await unlink(receipt).catch(()=>{}); }
    }
    let active = {};
    try { active = JSON.parse(await readFile(path.join(directory, 'active.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    active[id] = version;
    await writeFile(temporary, JSON.stringify(active, null, 2), { mode: 0o644, flag: 'wx' });
    await rename(temporary, path.join(directory, 'active.json'));
  } finally { await unlink(temporary).catch(() => {}); await unlink(lock); }
}
