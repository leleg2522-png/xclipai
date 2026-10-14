const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prepareProductionLock } = require('../scripts/prepare-production-lock.cjs');
const { verifyRuntimeDependencies } = require('../scripts/verify-runtime.cjs');

test('production lock replaces private mirror URLs without changing versions or integrity', () => {
  const entry = {
    version: '1.2.3', integrity: 'sha512-test',
    resolved: 'https://package-firewall.replit.internal/@scope/pkg/-/pkg-1.2.3.tgz',
  };
  const lock = {
    packages: { 'node_modules/@scope/pkg': { ...entry } },
    dependencies: { '@scope/pkg': { ...entry } },
  };
  assert.equal(prepareProductionLock(lock), 2);
  for (const value of [lock.packages['node_modules/@scope/pkg'], lock.dependencies['@scope/pkg']]) {
    assert.equal(value.version, entry.version);
    assert.equal(value.integrity, entry.integrity);
    assert.equal(value.resolved, 'https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz');
  }
  assert.equal(prepareProductionLock(lock), 0);
});

test('public registry URLs are unchanged and missing integrity fails explicitly', () => {
  const entry = { version: '1.2.3', resolved: 'https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz' };
  assert.equal(prepareProductionLock({ packages: { 'node_modules/pkg': entry } }), 0);
  assert.throws(() => prepareProductionLock({
    packages: { 'node_modules/pkg': { ...entry, resolved: 'https://package-firewall.replit.internal/pkg/-/pkg-1.2.3.tgz' } },
  }), /Missing integrity/);
});

test('the actual production lock is portable and preserves all pinned package records', () => {
  const original = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const exported = JSON.parse(JSON.stringify(original));
  assert.ok(prepareProductionLock(exported) > 0);
  assert.ok(!JSON.stringify(exported).includes('package-firewall.replit.internal'));
  for (const [key, value] of Object.entries(original.packages)) {
    assert.equal(exported.packages[key].version, value.version);
    assert.equal(exported.packages[key].integrity, value.integrity);
  }
});

test('missing Express fails verification even if an installer returned success', () => {
  assert.throws(() => verifyRuntimeDependencies({ express: '5.2.1', pg: '8.18.0' }, name => {
    if (name === 'express') throw new Error('MODULE_NOT_FOUND');
    return '/test/pg.js';
  }), /Production dependencies missing: express/);
});

test('verification checks all declared packages and handles type-only packages', () => {
  const checked = [];
  assert.equal(verifyRuntimeDependencies({ express: '5.2.1', '@types/node': '22.0.0' }, name => {
    checked.push(name);
    return '/test/module';
  }), 2);
  assert.deepEqual(checked, ['express', '@types/node/package.json']);
});

test('Docker installs from the lockfile and verifies modules before and after application copy', () => {
  const docker = fs.readFileSync('Dockerfile', 'utf8');
  assert.ok(docker.includes('npm ci --omit=dev --no-audit --no-fund'));
  assert.equal((docker.match(/npm run verify:runtime/g) || []).length, 2);
  assert.ok(docker.includes('test "$(npm --version)" = "10.9.2"'));
  assert.ok(docker.includes('node --check server.js'));
  assert.doesNotMatch(docker, /npm install --production|\|\|\s*true/);
  assert.ok(fs.readFileSync('.dockerignore', 'utf8').includes('**/node_modules'));
});
