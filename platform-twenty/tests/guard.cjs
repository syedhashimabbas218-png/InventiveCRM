const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const LOOPBACK = /^(localhost|.+\.localhost|127\.0\.0\.1|\[::1\])$/;

const hostAndPort = (url) => {
  const { hostname, port, protocol } = new URL(url);
  return { hostname, port: port || (protocol === 'https:' ? '443' : '80') };
};

// The suites delete records. On a machine that has deploy/.env, the address in it and loopback port 3000 (what
// deploy/docker-compose.yml publishes) are the live CRM. A staging copy has the same file, so there
// ALLOW_DESTRUCTIVE_TESTS must repeat the address.
const assertNotProduction = (serverUrl) => {
  const environmentFile = join(__dirname, '..', 'deploy', '.env');
  if (!existsSync(environmentFile) || process.env.ALLOW_DESTRUCTIVE_TESTS === serverUrl) return;

  const target = hostAndPort(serverUrl);
  const productionUrl = readFileSync(environmentFile, 'utf8').match(/^SERVER_URL=(\S+)/m)?.[1];
  const production = productionUrl ? hostAndPort(productionUrl) : null;
  const isProductionAddress =
    production !== null &&
    target.port === production.port &&
    (target.hostname === production.hostname || target.hostname.endsWith(`.${production.hostname}`));
  const isProductionPort = LOOPBACK.test(target.hostname) && target.port === '3000';

  if (isProductionAddress || isProductionPort) {
    throw new Error(`${serverUrl} is the live CRM on this machine. These tests delete records: use the throwaway test server.`);
  }
};

const testServerUrl = () => {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) throw new Error('Set SERVER_URL to the throwaway test server, for example http://localhost:3001');
  assertNotProduction(serverUrl);
  return serverUrl;
};

module.exports = { assertNotProduction, testServerUrl };

if (require.main === module) {
  try {
    testServerUrl();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
