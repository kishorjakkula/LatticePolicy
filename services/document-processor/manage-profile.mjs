import { readFile } from 'node:fs/promises';
import { publishProfile, activateProfile } from './profiles.mjs';
import { releasePolicyFromEnv } from './release-authorization.mjs';

try {
  const [command, directory, source, version, receipt] = process.argv.slice(2);
  if (command === 'publish' && directory && source) {
    await publishProfile(directory, JSON.parse(await readFile(source, 'utf8')));
    console.log('Profile published. Activate it after evaluation.');
  } else if (command === 'activate' && directory && source && version) {
    const policy=await releasePolicyFromEnv();
    const authorization=receipt ? JSON.parse(await readFile(receipt,'utf8')) : null;
    await activateProfile(directory, source, version, authorization, policy);
    console.log('Profile activated. New processing runs use this version.');
  } else throw new Error('Usage: manage-profile.mjs publish DIRECTORY FILE | activate DIRECTORY ID VERSION');
} catch (error) { console.error(error.message); process.exitCode = 1; }
