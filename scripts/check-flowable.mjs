// The Flowable packaging probe (slice 2.1; PoC 3 R11): the Phoenix Flowable image, started on
// its own PostgreSQL database, answers /management/engine, loaded no demo processes, exposes no
// Spring management endpoint but health, and fires a timer: a one-timer process deployed for a
// probe tenant ends by itself, and its history carries the tenant. The probe deletes what it
// deployed.
// Usage: FLOWABLE_USER=rest-admin FLOWABLE_PASSWORD=... node scripts/check-flowable.mjs [base URL]
// The base URL defaults to http://localhost:8090/flowable-rest.

const base = (process.argv[2] ?? 'http://localhost:8090/flowable-rest').replace(/\/$/, '');
const service = `${base}/service`;
const user = process.env.FLOWABLE_USER ?? 'rest-admin';
const password = process.env.FLOWABLE_PASSWORD;
if (!password) {
  console.error('FLOWABLE_PASSWORD is required');
  process.exit(2);
}
const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

const TENANT = 'phoenix-flowable-probe';
const PROCESS_KEY = 'phoenixFlowableProbe';
// The processes the base image deploys when create-demo-definitions is on.
const DEMO_KEYS = ['oneTaskProcess', 'createTimersProcess', 'VacationRequest', 'FixSystemFailure'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, init = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${service}${path}`, {
    ...init,
    headers: { authorization, ...init.headers },
  });
  const text = await response.text();
  return { status: response.status, body: text ? safeJson(text) : undefined };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok   ${message}`);
}

async function waitForEngine(attempts) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { status, body } = await call('/management/engine');
      if (status === 200) return body;
    } catch {
      // Not listening yet.
    }
    await sleep(2000);
  }
  throw new Error('Flowable did not answer /management/engine');
}

const BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="https://phoenix.local/probe">
  <process id="${PROCESS_KEY}" isExecutable="true">
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="wait"/>
    <intermediateCatchEvent id="wait">
      <timerEventDefinition><timeDuration>PT1S</timeDuration></timerEventDefinition>
    </intermediateCatchEvent>
    <sequenceFlow id="f2" sourceRef="wait" targetRef="end"/>
    <endEvent id="end"/>
  </process>
</definitions>`;

let deploymentId;
try {
  const engine = await waitForEngine(Number(process.env.FLOWABLE_WAIT_ATTEMPTS ?? 90));
  check(engine?.version?.startsWith('7.1.0'), `engine answers, version ${engine?.version}`);

  for (const key of DEMO_KEYS) {
    const { body } = await call(`/repository/process-definitions?key=${key}`);
    check(body?.total === 0, `no demo process ${key}`);
  }

  const env = await call(`${base}/actuator/env`);
  check(env.status === 404, `actuator/env is not exposed (HTTP ${env.status})`);
  const health = await call(`${base}/actuator/health`);
  check(health.status === 200, `actuator/health answers (HTTP ${health.status})`);

  const form = new FormData();
  form.append('tenantId', TENANT);
  form.append('file', new Blob([BPMN], { type: 'text/xml' }), `${PROCESS_KEY}.bpmn20.xml`);
  const deployment = await call('/repository/deployments', { method: 'POST', body: form });
  check(deployment.status === 201, `probe process deployed (HTTP ${deployment.status})`);
  deploymentId = deployment.body.id;
  check(deployment.body.tenantId === TENANT, 'deployment carries the probe tenant');

  const started = await call('/runtime/process-instances', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ processDefinitionKey: PROCESS_KEY, tenantId: TENANT }),
  });
  check(started.status === 201, `probe instance started (HTTP ${started.status})`);
  check(started.body.ended === false, 'probe instance waits on its timer');

  // A 1 s timer with a 1 s acquisition wait ends within a few seconds; 10 s acquisition (the
  // image default) would still end inside this window.
  let ended;
  for (let attempt = 1; attempt <= 30 && !ended; attempt++) {
    await sleep(1000);
    const { body } = await call(`/history/historic-process-instances/${started.body.id}`);
    if (body?.endTime) ended = body;
  }
  check(ended !== undefined, 'the timer fired and the instance ended');
  check(ended.tenantId === TENANT, 'the history row carries the probe tenant');
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  if (deploymentId) {
    const removed = await call(`/repository/deployments/${deploymentId}?cascade=true`, {
      method: 'DELETE',
    });
    if (removed.status !== 204) {
      console.error(`Could not delete the probe deployment (HTTP ${removed.status})`);
      process.exitCode = 1;
    }
  }
}
