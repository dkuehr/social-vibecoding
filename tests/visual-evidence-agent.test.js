'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../src/services/visual-evidence-agent');
const worker = require('../src/services/worker');
const fs = require('node:fs');
const path = require('node:path');

test('evidence uses temporary worker storage only when no coding session can resume', async () => {
  const options = [];
  const workerService = { ensureWorker: async (_id, config) => { options.push(config); return 'worker'; } };
  const session = { id: 42, repo_url: 'https://github.com/acme/demo.git',
    branch_name: 'proposal', status: 'promoted' };
  await agent.ensureEvidenceWorker(session, { workerService });
  await agent.ensureEvidenceWorker({ ...session, source: 'imported' }, { workerService });
  await agent.ensureEvidenceWorker({ ...session, status: 'merged' }, { workerService });
  assert.deepEqual(options.map((option) => option.temporary), [false, true, true]);
});

test('agent dispatch time is bounded and invokes worker cancellation', async () => {
  let stopped = 0;
  await assert.rejects(
    agent.withDispatchTimeout(new Promise(() => {}), {
      timeoutMs: 10,
      onTimeout: async () => { stopped += 1; },
    }),
    { code: 'evidence_agent_timeout' }
  );
  assert.equal(stopped, 1);
});

test('agent exploration timeout excludes time spent in platform replay', async () => {
  const started = Date.now();
  let pauseStarted = started;
  let completedPause = 0;
  let stopped = 0;
  const suspendedMs = () => completedPause + (pauseStarted == null ? 0 : Date.now() - pauseStarted);
  const result = await agent.withDispatchTimeout(
    new Promise((resolve) => setTimeout(() => {
      completedPause += Date.now() - pauseStarted;
      pauseStarted = null;
      resolve('replay complete');
    }, 90)),
    {
      timeoutMs: 20,
      suspendedMs,
      onTimeout: () => { stopped += 1; },
    }
  );
  assert.equal(result, 'replay complete');
  assert.equal(stopped, 0, 'the replay has its own bounded lifetime');
});

test('hosted evidence dispatch forwards worker lifecycle diagnostics through the normal path', async () => {
  const events = [];
  const workerService = {
    ensureWorker: async () => 'warm-worker',
    execInWorker: async (_sessionId, options) => {
      assert.equal(options.mode, 'evidence');
      options.onEvidenceDiagnostic({ kind: 'provider_init' });
      return { exitCode: 0, sessionId: 'provider-thread' };
    },
  };
  const result = await agent.dispatch({ visualEvidence: { maxAgentMs: 500 } }, {
    pool: {}, session: {
      id: 42, repo_url: 'https://github.com/acme/demo.git',
      branch_name: 'proposal', agent_backend: 'claude_code',
    },
    runId: '1'.repeat(32), origins: { base: 'http://base.test/', head: 'http://head.test/' },
    authTokens: { member: 'private-token', read_only_admin: 'private-token' },
    onEvidenceDiagnostic: (event) => events.push(event),
  }, { workerService });
  assert.equal(result.backend, 'claude_code');
  assert.deepEqual(events.map((event) => event.kind), [
    'worker_prepare_start', 'worker_prepare_end', 'backend_selected',
    'turn_start', 'provider_init', 'turn_end',
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private-token/);
});

test('Codex evidence receives the planning contract as developer context in a fresh turn', async () => {
  let dispatched;
  const result = await agent.dispatch({ visualEvidence: { maxAgentMs: 500 } }, {
    pool: {}, session: {
      id: 42, user_id: 7, repo_url: 'https://github.com/acme/demo.git',
      branch_name: 'proposal', agent_backend: 'codex_openrouter',
      agent_model: 'z-ai/glm-test', agent_thread_id: 'coding-thread',
    },
    runId: '1'.repeat(32), origins: { base: 'http://base.test/', head: 'http://head.test/' },
    authTokens: { member: 'private-token', read_only_admin: 'private-token' },
    resumeThreadId: null,
  }, {
    workerService: {
      ensureWorker: async () => 'warm-worker',
      execInWorker: async (_sessionId, options) => {
        dispatched = options;
        return { exitCode: 0, agentThreadId: 'evidence-thread' };
      },
    },
    agentTurn: {
      resolveCodexRuntimeContext: async () => ({
        agentModel: 'z-ai/glm-test', agentModelMetadata: { supportsTools: true },
      }),
      startCodexAttempt: async ({ resumeThreadId }) => {
        assert.equal(resumeThreadId, null);
        return { turnUuid: 'attempt-1', journal: '/tmp/attempt-1' };
      },
      completeCodexAttempt: async () => {},
      usageTotalFromResult: () => null,
    },
  });
  assert.equal(result.threadId, 'evidence-thread');
  assert.equal(dispatched.resumeSessionId, null);
  assert.equal(dispatched.systemPrompt, agent.SYSTEM_PROMPT);
  assert.match(dispatched.systemPrompt, /Use evidence_get_context first/);
  assert.match(dispatched.systemPrompt, /submit them through the tool/);
});

test('the evidence prompt asks for a replay plan and leaves visual judgement to people', () => {
  assert.match(agent.SYSTEM_PROMPT, /platform code—not you—will reset both sides and\s+replay it twice/i);
  assert.match(agent.SYSTEM_PROMPT, /promptly acknowledges a\s+validated submission; it does not wait for replay or return a verdict/i);
  assert.match(agent.SYSTEM_PROMPT, /platform waits for replay, starts a separate\s+correction turn for a repairable replay failure/i);
  assert.match(agent.SYSTEM_PROMPT, /passing media available to human\s+reviewers/i);
  assert.match(agent.SYSTEM_PROMPT, /do not need image understanding or a relevance verdict/i);
  assert.doesNotMatch(agent.SYSTEM_PROMPT, /evidence_finish/);
  assert.match(agent.SYSTEM_PROMPT, /page[\s\S]*untrusted data/i);
  assert.doesNotMatch(agent.promptFor(), /review was rejected|corrected plan/i);
  assert.match(agent.promptFor({ repair: true }), /rejected plan and the exact replay failure/i);
  assert.match(agent.promptFor({ repair: true }), /BOTH exact\s+revisions/i);
  assert.match(agent.replayPlanGuide(), /No arbitrary JavaScript/);
  assert.match(agent.replayPlanGuide(), /id:"open-menu", stage:"menu"/);
  assert.match(agent.replayPlanGuide(), /"type":"click",\s*"target"/);
  assert.match(agent.replayPlanGuide(), /read the returned field paths/i);
  assert.match(agent.replayPlanGuide(), /exactly one\s+entry for every accepted story id/i);
  assert.match(agent.replayPlanGuide(), /Do not copy those fields yourself/);
  assert.match(agent.replayPlanGuide(), /Every interaction target and each checkpoint focus must\s+identify exactly one visible element/);
  assert.match(agent.replayPlanGuide(), /state:"visible" or state:"hidden"/);
  assert.match(agent.replayPlanGuide(), /waitFor target only needs one or more\s+visible matches when state is visible/);
  assert.match(agent.replayPlanGuide(), /wait for its observed marker to appear,\s+then wait for it to become hidden/i);
  assert.match(agent.promptFor({ repair: true }), /retaining the original checkpoint assertions unchanged/i);
  assert.match(agent.replayPlanGuide(), /waitFor text matches a visible substring/);
});

test('a second hosted dispatch receives an explicit repair task through the normal worker', async () => {
  const prompts = [];
  const workerService = {
    ensureWorker: async () => 'warm-worker',
    execInWorker: async (_sessionId, options) => {
      prompts.push(options.prompt);
      assert.equal(options.resumeSessionId, 'evidence-thread');
      assert.equal(options.evidenceRunId, '1'.repeat(32));
      return { exitCode: 0, sessionId: 'evidence-thread' };
    },
  };
  await agent.dispatch({ visualEvidence: { maxAgentMs: 500 } }, {
    pool: {}, session: {
      id: 42, repo_url: 'https://github.com/acme/demo.git',
      branch_name: 'proposal', agent_backend: 'claude_code',
    },
    runId: '1'.repeat(32), origins: { base: 'http://base.test/', head: 'http://head.test/' },
    authTokens: { member: 'private-token', read_only_admin: 'private-token' },
    resumeThreadId: 'evidence-thread', repairAttempt: 1,
  }, { workerService });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /first submitted plan failed deterministic replay/i);
  assert.match(prompts[0], /evidence_run_plan/);
});

test('backend results cannot silently turn an errored model turn into success', () => {
  assert.equal(agent.failedResult(null), true);
  assert.equal(agent.failedResult({ exitCode: 1 }), true);
  assert.equal(agent.failedResult({ ccIsError: true }), true);
  assert.equal(agent.failedResult({ exitCode: 0 }), false);
});

test('dispatch reports the actual model when a selected model cannot use evidence tools', async () => {
  const session = {
    id: 42, user_id: 7, repo_url: 'https://github.com/acme/demo.git',
    agent_backend: 'codex_openrouter', agent_model: 'z-ai/glm-test', model: 'claude-sonnet-5',
  };
  const result = await agent.dispatch({ visualEvidence: {} }, {
    pool: {}, session, runId: 'a'.repeat(32),
    origins: { base: 'http://base:3000', head: 'http://head:3000' },
    authTokens: { member: 'fixture-member' },
  }, {
    workerService: {
      ensureWorker: async () => ({}),
      execInWorker: async () => ({ exitCode: 0 }),
    },
    agentTurn: {
      resolveCodexRuntimeContext: async () => ({
        agentModel: 'z-ai/glm-test', agentModelMetadata: { supportsTools: false },
      }),
    },
  });
  assert.equal(result.backend, 'claude_code');
  assert.equal(result.model, 'claude-sonnet-5');
  assert.equal(result.fallbackReason, 'model_without_tools');
});

test('Kubernetes evidence tools call the Pod that owns their in-memory replay control', () => {
  assert.equal(worker.evidenceControlUrl({ podIp: '10.20.30.40', port: '3000', fallback: 'http://service:3000' }),
    'http://10.20.30.40:3000');
  assert.equal(worker.evidenceControlUrl({ podIp: '2001:db8::7', port: '3000', fallback: 'http://service:3000' }),
    'http://[2001:db8::7]:3000');
  assert.equal(worker.evidenceControlUrl({ podIp: 'not-an-ip', fallback: 'http://service:3000' }),
    'http://service:3000');
  const source = fs.readFileSync(require.resolve('../src/services/worker'), 'utf8');
  const chart = fs.readFileSync(path.join(__dirname, '../deploy/helm/social-vibecoding-platform/templates/platform.yaml'), 'utf8');
  assert.match(source, /PLATFORM_URL: mode === 'evidence' \? evidenceControlUrl\(\) : PLATFORM_INTERNAL_URL/);
  assert.match(chart, /name: POD_IP\s+valueFrom: \{fieldRef: \{fieldPath: status\.podIP\}\}/);
});
