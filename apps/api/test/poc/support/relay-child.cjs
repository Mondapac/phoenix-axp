// PoC 3: a worker process that runs ONE relay pass of the built API (apps/api/dist) and, after
// the engine call named by DIE_AFTER returns, prints "engine-call-done <method>" and stalls, so
// the test can SIGKILL it at exactly that point (worker restart mid-relay). Plain CommonJS on
// the built code: the same JavaScript the worker role runs.
//
// Environment: DATABASE_URL (the application login), HOSTED_TENANTS, TENANT, DIE_AFTER,
// LEASE_MS, FLOWABLE_REST_URL.
const path = require('node:path');

const dist = path.resolve(__dirname, '../../../dist');
const load = (file) => require(path.join(dist, file));

const { loadAppConfig } = load('platform/config/app-config');
const { PrismaRoot } = load('platform/persistence/prisma-root');
const { createGuardedClient } = load('platform/persistence/guarded-client');
const { PrismaService } = load('platform/persistence/prisma.service');
const { PrismaUnitOfWork } = load('platform/persistence/prisma-unit-of-work');
const { MODEL_MAP } = load('generated/model-map');
const { SystemClock } = load('platform/clock/system-clock');
const { UuidV7IdGenerator } = load('platform/ids/uuid-v7-id-generator');
const { CommandRelay } = load('modules/process/application/bridge/command-relay');
const { PrismaProcessStore } = load('modules/process/infrastructure/prisma-process-store');
const { FlowableRestEngine } = load('modules/process/infrastructure/flowable/flowable-rest-engine');
const { mintTenantContext, parseTenantId } = require('@phoenix/shared-kernel');

async function main() {
  const config = loadAppConfig({
    NODE_ENV: 'test',
    APP_ROLE: 'worker',
    HOSTED_TENANTS: process.env.HOSTED_TENANTS,
    DATABASE_URL: process.env.DATABASE_URL,
    TENANT_CONFIG_DIR: path.resolve(__dirname, '../../../../../config/tenants'),
  });
  const root = new PrismaRoot(config);
  const unitOfWork = new PrismaUnitOfWork(createGuardedClient(root, MODEL_MAP), MODEL_MAP);
  const clock = new SystemClock();
  const real = new FlowableRestEngine({
    baseUrl: process.env.FLOWABLE_REST_URL,
    user: 'rest-admin',
    password: 'test',
    timeoutMs: 5000,
  });
  const dieAfter = process.env.DIE_AFTER;
  const engine = new Proxy(real, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      return async (...args) => {
        const result = await value.apply(target, args);
        if (property === dieAfter) {
          process.stdout.write(`engine-call-done ${String(property)}\n`);
          await new Promise(() => undefined); // stall until SIGKILL
        }
        return result;
      };
    },
  });
  const relay = new CommandRelay(
    unitOfWork,
    new PrismaProcessStore(new PrismaService()),
    engine,
    new UuidV7IdGenerator(clock),
    clock,
    { leaseMs: Number(process.env.LEASE_MS), batchSize: 20, retryAfterMs: 0 },
  );
  const tenant = parseTenantId(process.env.TENANT);
  if (!tenant.ok) throw new Error('TENANT is not a tenant id');
  const pass = await relay.runOnce(mintTenantContext(tenant.value));
  process.stdout.write(`pass ${JSON.stringify(pass)}\n`);
  await root.$disconnect();
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
