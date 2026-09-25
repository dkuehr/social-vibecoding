#!/usr/bin/env node
'use strict';

// Build-turn bridge for declaring WHAT the implementing agent changed in the
// UI. It cannot run or publish evidence and has no broader platform surface;
// the server validates the same v1 contract used by submission APIs.

const { McpServer } = require('/usr/local/lib/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
const { StdioServerTransport } = require('/usr/local/lib/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js');
const { z } = require('/usr/local/lib/node_modules/zod');

const platform = String(process.env.PLATFORM_URL || '').replace(/\/$/, '');
const sessionId = Number(process.env.SESSION_ID);
const token = String(process.env.WORKER_JWT || '');
if (!/^https?:\/\//.test(platform) || !Number.isInteger(sessionId) || sessionId <= 0 || !token) {
  process.stderr.write('Visual-intent MCP configuration is incomplete.\n');
  process.exit(1);
}

const viewport = z.object({
  name: z.string().min(1).max(32),
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(480).max(1440),
}).strict();
const story = z.object({
  id: z.string().min(1).max(96),
  claim: z.string().min(1).max(1000),
  persona: z.enum(['member', 'read_only_admin']),
  viewports: z.array(viewport).min(1).max(2),
  intent: z.object({
    startPath: z.string().min(1).max(512)
      .describe('Use a concrete relative route from an observed screen or declared check, including query and hash. Use / only when the change is visible on the home screen.'),
    steps: z.array(z.string().min(1).max(200)).min(1).max(40),
    checkpoint: z.string().min(1).max(500),
    focus: z.string().min(1).max(200),
    baseState: z.enum(['present', 'not_present']).optional()
      .describe('Use not_present only for a genuinely new screen/control; base replay must still assert and capture its stable parent or explicit absence page.'),
    animation: z.enum(['none', 'steps', 'motion']),
    controlledFailurePath: z.string().min(6).max(512).optional()
      .describe('Only for an error state: exact same-origin /api/ GET path to block on both revisions. Set the FIRST intent.steps entry exactly to "Controlled test: deliberately block the declared API GET on both revisions." so reviewers see the condition. Replay requires a real matching request on both sides.'),
  }).strict(),
}).strict();
const intentSchema = {
  version: z.literal(1),
  impact: z.enum(['ui', 'motion', 'none']),
  rationale: z.string().min(1).max(1000),
  stories: z.array(story).max(3),
};

async function record(intent) {
  const response = await fetch(`${platform}/api/internal/sessions/${sessionId}/visual-evidence-intent`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ intent }),
    signal: AbortSignal.timeout(30_000),
  });
  let payload;
  try { payload = await response.json(); }
  catch { payload = { ok: false, code: 'invalid_platform_response', message: 'Homeroom returned a non-JSON response.' }; }
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(String(payload?.message || `Homeroom returned HTTP ${response.status}`).slice(0, 1000));
    error.code = String(payload?.code || 'visual_intent_failed');
    throw error;
  }
  return payload;
}

const server = new McpServer(
  { name: 'usernode-visual-intent', version: '1.0.0' },
  { instructions: 'After implementing a change, declare its reviewer-facing visual evidence intent only for a visible state you reached in the running local app with representative test data. Report a missing fixture or inaccessible state instead of inventing a claim. This records claims only; Homeroom later explores base/head and deterministically replays the UI flow.' }
);
server.registerTool('record_visual_evidence_intent', {
  description: 'Declare 1-3 concrete UI claims and flows that you reached in the running local app with representative test data, or impact=none with a specific rationale for a truly non-visual change. A visible state needing a server fault or background job requires a repeatable staging fixture; report a blocker rather than submitting a guessed flow. Call once after implementation and before finishing the build turn.',
  inputSchema: intentSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (intent) => {
  try {
    const result = await record(intent);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({
        ok: false,
        code: String(error?.code || 'visual_intent_failed'),
        message: String(error?.message || 'Could not record visual intent.').slice(0, 1000),
      }) }],
    };
  }
});

server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(`${String(error?.message || error).slice(0, 1000)}\n`);
  process.exit(1);
});
