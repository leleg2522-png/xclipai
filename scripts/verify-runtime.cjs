function loadRuntimeModule(name) {
  const location = require.resolve(name);
  if (!name.startsWith('@types/')) require(name);
  return location;
}

function verifyRuntimeDependencies(dependencies, resolveModule = loadRuntimeModule) {
  const missing = [];
  for (const name of Object.keys(dependencies || {})) {
    try {
      resolveModule(name.startsWith('@types/') ? `${name}/package.json` : name);
    } catch {
      missing.push(name);
    }
  }
  if (missing.length) {
    throw new Error(`Production dependencies missing: ${missing.join(', ')}`);
  }
  return Object.keys(dependencies || {}).length;
}

if (require.main === module) {
  try {
    const count = verifyRuntimeDependencies(require('../package.json').dependencies);
    console.log(`Production dependency verification passed (${count} packages).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyRuntimeDependencies };
