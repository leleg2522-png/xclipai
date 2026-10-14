const fs = require('node:fs');
const path = require('node:path');

const INTERNAL_REGISTRY = 'package-firewall.replit.internal';

function publicTarball(name, version) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ||
      !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/i.test(version)) {
    throw new Error('Cannot normalize an unsupported package identifier');
  }
  const filename = name.split('/').pop();
  return `https://registry.npmjs.org/${name}/-/${filename}-${encodeURIComponent(version)}.tgz`;
}

function prepareProductionLock(lock) {
  let changed = 0;
  function normalize(entry, name) {
    if (!entry.resolved || new URL(entry.resolved).hostname !== INTERNAL_REGISTRY) return;
    if (!entry.integrity) throw new Error(`Missing integrity for ${name}`);
    entry.resolved = publicTarball(entry.name || name, entry.version);
    changed++;
  }
  for (const [location, entry] of Object.entries(lock.packages || {})) {
    if (entry.resolved) normalize(entry, location.split('node_modules/').pop());
  }
  function legacy(dependencies) {
    for (const [name, entry] of Object.entries(dependencies || {})) {
      normalize(entry, name);
      legacy(entry.dependencies);
    }
  }
  legacy(lock.dependencies);
  return changed;
}

if (require.main === module) {
  try {
    const file = path.resolve(process.argv[2] || 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
    const changed = prepareProductionLock(lock);
    fs.writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Production lock prepared: ${changed} internal registry references normalized.`);
  } catch (error) {
    console.error(`Production lock validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { prepareProductionLock, publicTarball };
