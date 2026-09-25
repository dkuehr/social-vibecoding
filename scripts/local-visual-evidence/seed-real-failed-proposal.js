#!/usr/bin/env node
'use strict';

// Copy only the evidence fields of an actual failed platform proposal into
// the local development database. This supplies representative UI state for
// exact-revision browser replay; it does not create a successful evidence run
// or substitute for a hosted planner test. The source JSON must come from an
// authenticated GET /api/apps/usernode-2d5619/proposals/:id response.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { Pool } = require('pg');
const contract = require('../../src/services/visual-evidence-plan');
const evidenceState = require('../../src/services/visual-evidence-state');

const APP_SLUG = 'usernode-2d5619';
const DB_URL = 'postgres://usernode:localdev@127.0.0.1:5440/usernode';
const MARKER = 'LOCAL_REAL_FAILED_EVIDENCE_SNAPSHOT';
const SHA_RE = /^[0-9a-f]{40}$/;
const RUN_RE = /^[0-9a-f]{32}$/;

function parseSnapshot(snapshot) {
  const proposal = snapshot?.proposal || snapshot?.body?.proposal;
  const id = Number(proposal?.id);
  const source = String(snapshot?.source || '');
  if (!Number.isSafeInteger(id) || id < 1
      || source !== `https://app.onhomeroom.com/app/${APP_SLUG}/dev/proposals/${id}`) {
    throw new Error('Snapshot needs its exact production proposal URL and id.');
  }
  if (proposal.source !== 'imported'
      || !['promoted', 'merging', 'merged'].includes(proposal.status)
      || proposal.visual_evidence_state !== 'failed') {
    throw new Error('Snapshot must describe a visible, failed imported proposal.');
  }
  const detail = proposal.visual_evidence_detail;
  if (!detail || detail.state !== 'failed'
      || detail.repairAvailable !== false || detail.repairCount !== 1) {
    throw new Error('Snapshot must contain a failed run with its automatic repair spent.');
  }
  if (!SHA_RE.test(String(detail.baseSha || ''))
      || !SHA_RE.test(String(detail.headSha || ''))
      || detail.headSha !== proposal.imported_pr_head_sha
      || !RUN_RE.test(String(proposal.visual_evidence_run_id || ''))) {
    throw new Error('Snapshot must contain matching exact run and revision identities.');
  }
  const intent = contract.parseIntent(detail.intent);
  if (intent.impact === 'none' || intent.stories.length === 0
      || contract.canonicalJson(evidenceState.claimsFromIntent(intent)) !== contract.canonicalJson(detail.claims)) {
    throw new Error('Snapshot claims do not match its accepted visual evidence intent.');
  }
  const title = String(proposal.session_title || proposal.pr_title || '').trim();
  if (!title || title.length > 200) throw new Error('Snapshot proposal title is missing or too long.');
  const prNumber = Number(proposal.pr_number);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Snapshot PR number is invalid.');
  const prUrl = String(proposal.pr_url || '');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(prUrl)) {
    throw new Error('Snapshot PR URL is invalid.');
  }
  const failureCode = String(detail.failureCode || '');
  const failureReason = String(detail.failureReason || '');
  if (!failureCode || failureCode.length > 100 || !failureReason || failureReason.length > 2000) {
    throw new Error('Snapshot failure details are missing or too long.');
  }
  const planHash = detail.planHash == null ? null : String(detail.planHash);
  if (planHash !== null && !/^[0-9a-f]{64}$/.test(planHash)) {
    throw new Error('Snapshot plan hash is invalid.');
  }
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify({ source, proposal })).digest('hex');
  return {
    id, source, sourceHash, title, prNumber, prUrl, status: proposal.status,
    runId: proposal.visual_evidence_run_id, baseSha: detail.baseSha,
    headSha: detail.headSha, intent, failureCode, failureReason, planHash,
    progress: detail.progress && typeof detail.progress === 'object' ? detail.progress : null,
  };
}

async function assertLocalOnly(envFile) {
  const env = await fs.readFile(envFile, 'utf8');
  if (!/^USERNODE_LOCAL_DEV=1$/m.test(env)
      || !/^DATABASE_URL=postgres:\/\/usernode:localdev@db:5432\/usernode$/m.test(env)) {
    throw new Error('The environment file is not the local-only evidence lab configuration.');
  }
  const health = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(5000) });
  if (!health.ok || (await health.json()).status !== 'ok') {
    throw new Error('The local Homeroom stack is not healthy.');
  }
}

async function seed(pool, fixture) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: apps } = await client.query('SELECT id FROM apps WHERE slug = $1', [APP_SLUG]);
    const { rows: users } = await client.query(
      "SELECT id FROM users WHERE username = 'usernode-capture' AND has_platform_access = TRUE"
    );
    if (apps.length !== 1 || users.length !== 1 || apps[0].id !== 1) {
      throw new Error('The local platform app or capture member is missing.');
    }
    const { rows: existing } = await client.query('SELECT id FROM chat_sessions WHERE id = $1', [fixture.id]);
    if (existing.length) throw new Error(`Local session ${fixture.id} already exists; refusing to overwrite it.`);
    const marker = `${MARKER} ${fixture.source} sha256:${fixture.sourceHash}`;
    const detail = {
      ...evidenceState.pendingDetail(fixture.intent, { headSha: fixture.headSha }),
      state: 'failed', baseSha: fixture.baseSha,
      failureCode: fixture.failureCode, failureReason: fixture.failureReason,
      repairAvailable: false, repairCount: 1,
      planHash: fixture.planHash, progress: fixture.progress,
    };
    await client.query(
      `INSERT INTO chat_sessions
         (id, app_id, user_id, branch_name, status, source, pr_number, pr_url,
          pr_title, session_title, imported_pr_head_sha, reviewed_head_sha,
          visual_evidence_state, visual_evidence_detail, testing_md, merged_at)
       VALUES ($1, $2, $3, $4, $5::varchar, 'imported', $6, $7, $8, $8, $9, $9,
               'failed', $10::jsonb, $11, CASE WHEN $5::varchar = 'merged' THEN NOW() ELSE NULL END)`,
      [fixture.id, apps[0].id, users[0].id, `local-snapshot-${fixture.id}`,
        fixture.status, fixture.prNumber, fixture.prUrl,
        `[Local real-data test #${fixture.id}] ${fixture.title}`, fixture.headSha,
        JSON.stringify(detail), marker]
    );
    await client.query(
      `INSERT INTO visual_evidence_runs
         (id, session_id, base_sha, head_sha, plan_version, intent, state,
          trigger, failure_code, failure_reason, repair_attempt, plan_hash,
          trace_summary, completed_at)
       VALUES ($1, $2, $3, $4, 1, $5::jsonb, 'failed', 'local-real-snapshot',
               $6, $7, 1, $8, $9::jsonb, NOW())`,
      [fixture.runId, fixture.id, fixture.baseSha, fixture.headSha,
        JSON.stringify(fixture.intent), fixture.failureCode, fixture.failureReason,
        fixture.planHash, JSON.stringify({ progress: fixture.progress })]
    );
    await client.query(
      `UPDATE chat_sessions SET visual_evidence_run_id = $2 WHERE id = $1`,
      [fixture.id, fixture.runId]
    );
    await client.query('COMMIT');
    return { sessionId: fixture.id, source: fixture.source, sourceHash: fixture.sourceHash };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup(pool, sessionId) {
  if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw new Error('Invalid local session id.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT cs.testing_md, cs.visual_evidence_run_id, a.slug
         FROM chat_sessions cs JOIN apps a ON a.id = cs.app_id
        WHERE cs.id = $1 FOR UPDATE OF cs`, [sessionId]
    );
    if (rows.length !== 1 || rows[0].slug !== APP_SLUG
        || !String(rows[0].testing_md || '').startsWith(`${MARKER} `)) {
      throw new Error('The requested session is not a local real-data evidence snapshot.');
    }
    await client.query('UPDATE chat_sessions SET visual_evidence_run_id = NULL WHERE id = $1', [sessionId]);
    await client.query('DELETE FROM visual_evidence_runs WHERE session_id = $1', [sessionId]);
    await client.query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]);
    await client.query('COMMIT');
    return { cleanedSessionId: sessionId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main(args) {
  const snapshotIndex = args.indexOf('--snapshot');
  const cleanupIndex = args.indexOf('--cleanup');
  const envIndex = args.indexOf('--env-file');
  const envFile = envIndex >= 0 ? args[envIndex + 1] : '.env';
  if (!envFile || (snapshotIndex >= 0) === (cleanupIndex >= 0)) {
    throw new Error('Usage: seed-real-failed-proposal.js (--snapshot FILE | --cleanup ID) [--env-file LOCAL_ENV]');
  }
  await assertLocalOnly(envFile);
  const pool = new Pool({ connectionString: DB_URL });
  try {
    const result = snapshotIndex >= 0
      ? await seed(pool, parseSnapshot(JSON.parse(await fs.readFile(args[snapshotIndex + 1], 'utf8'))))
      : await cleanup(pool, Number(args[cleanupIndex + 1]));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseSnapshot };
