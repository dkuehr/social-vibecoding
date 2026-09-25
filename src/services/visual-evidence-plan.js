'use strict';

// #2380 — one versioned contract for semantic evidence intent and the
// executable replay plan derived from it. This module is deliberately pure:
// routes, MCP tools, workers and the replay runtime all call the same parser,
// so a plan cannot become more permissive as it crosses a process boundary.

const crypto = require('crypto');
const { z } = require('zod');

const PLAN_VERSION = 1;
const MAX_STORIES = 3;
const MAX_VIEWPORTS = 2;
const MAX_ACTIONS_PER_SIDE = 40;
const MAX_WAIT_MS = 10_000;
const MAX_SIDE_MS = 45_000;
const MAX_TEXT = 1_000;
const MAX_TYPED_VALUE = 100;
const MAX_LOCATOR_VALUE = 256;
const MAX_PATH = 512;

const IMPACTS = Object.freeze(['ui', 'motion', 'none']);
const PERSONAS = Object.freeze(['member', 'read_only_admin']);
const ANIMATIONS = Object.freeze(['none', 'steps', 'motion']);
const CONTROLLED_FAILURE_LABEL = 'Controlled test: deliberately block the declared API GET on both revisions.';
const LOCATOR_KINDS = Object.freeze(['testId', 'role', 'label', 'placeholder', 'text', 'css']);
const ACTION_TYPES = Object.freeze([
  'navigate', 'click', 'fill', 'press', 'select', 'check', 'uncheck',
  'hover', 'drag', 'clickPoint', 'dragPoints', 'scrollIntoView', 'scrollBy',
  'waitFor', 'requestFailure',
]);
const ASSERTION_TYPES = Object.freeze([
  'visible', 'hidden', 'attached', 'detached', 'text', 'count', 'value',
  'checked', 'url', 'focusWithin',
]);

const ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,94}[a-z0-9])?$/;
const STAGE_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const VIEWPORT_RE = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/ig;
const CREDENTIAL_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i,
  /\b(?:sk|gh[pousr]|github_pat|glpat|xox[baprs]|AIza)[-_][A-Za-z0-9_-]{12,}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
]);

class VisualEvidenceValidationError extends Error {
  constructor(issues) {
    const normalized = Array.isArray(issues) ? issues : [{ path: [], message: String(issues) }];
    super(normalized.map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : 'visualEvidence';
      return `${path}: ${issue.message}`;
    }).join('; '));
    this.name = 'VisualEvidenceValidationError';
    this.code = 'invalid_visual_evidence';
    this.issues = normalized.map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.map(String) : [],
      message: String(issue.message || 'Invalid value'),
    }));
  }
}

function singleLine(value) {
  return typeof value === 'string' && value.trim() === value
    && !CONTROL_RE.test(value) && !/[\r\n]/.test(value);
}

function textField(max = MAX_TEXT, min = 1) {
  return z.string().min(min).max(max).refine(singleLine, 'Must be a trimmed single line without control characters');
}

function validRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_PATH) return false;
  if (!singleLine(value) || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
  if (ABSOLUTE_URL_RE.test(value) || /%2f%2f/i.test(value)) return false;
  try {
    const parsed = new URL(value, 'https://evidence.invalid');
    return parsed.origin === 'https://evidence.invalid'
      && !parsed.username && !parsed.password
      && ![...parsed.searchParams.keys()].some((key) => /^(?:token|access_token|auth|authorization|password|passwd|secret|api[_-]?key)$/i.test(key))
      && parsed.pathname.startsWith('/');
  } catch {
    return false;
  }
}

const relativePathSchema = z.string().max(MAX_PATH)
  .refine(validRelativePath, 'Must be one relative in-app path beginning with a single "/"')
  .refine((value) => {
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { /* malformed escapes are rejected by validRelativePath */ }
    return !credentialLike(value) && !credentialLike(decoded);
  }, 'Must not contain credentials, tokens, or non-fixture email addresses');

function validControlledFailurePath(value) {
  if (!validRelativePath(value) || !value.startsWith('/api/') || value.includes('*')) return false;
  try {
    const parsed = new URL(value, 'https://evidence.invalid');
    return !parsed.hash && `${parsed.pathname}${parsed.search}` === value;
  } catch { return false; }
}

const controlledFailurePathSchema = relativePathSchema.refine(validControlledFailurePath,
  'Must be one exact, same-origin /api/ GET path (optional query, no fragment or wildcard)');

function credentialLike(value, fixtureDomains = ['example.test', 'example.invalid', 'test.invalid']) {
  const text = String(value || '');
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) return true;
  EMAIL_RE.lastIndex = 0;
  let match;
  while ((match = EMAIL_RE.exec(text))) {
    if (!fixtureDomains.includes(String(match[1]).toLowerCase())) return true;
  }
  return false;
}

function literalSchema(max = MAX_TYPED_VALUE) {
  return z.string().max(max)
    .refine((value) => !CONTROL_RE.test(value), 'Must not contain control characters')
    .refine((value) => !credentialLike(value), 'Must not contain credentials, tokens, or non-fixture email addresses');
}

const locatorSchema = z.union([
  z.object({ by: z.literal('testId'), value: textField(MAX_LOCATOR_VALUE) }).strict(),
  z.object({
    by: z.literal('role'),
    role: textField(64),
    name: textField(MAX_LOCATOR_VALUE).optional(),
    exact: z.boolean().optional().default(true),
  }).strict(),
  z.object({ by: z.literal('label'), value: textField(MAX_LOCATOR_VALUE), exact: z.boolean().optional().default(true) }).strict(),
  z.object({ by: z.literal('placeholder'), value: textField(MAX_LOCATOR_VALUE), exact: z.boolean().optional().default(true) }).strict(),
  z.object({ by: z.literal('text'), value: textField(MAX_LOCATOR_VALUE), exact: z.boolean().optional().default(true) }).strict(),
  z.object({ by: z.literal('css'), value: textField(MAX_LOCATOR_VALUE) }).strict()
    .refine(({ value }) => !/^\s*(?:html|body|\*)\s*$/i.test(value), 'Unbounded root selectors are not allowed'),
]);

const viewportSchema = z.object({
  name: z.string().min(1).max(32).regex(VIEWPORT_RE),
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(480).max(1440),
}).strict();

const intentSchema = z.object({
  startPath: relativePathSchema,
  steps: z.array(textField(200)).min(1).max(MAX_ACTIONS_PER_SIDE),
  checkpoint: textField(500),
  focus: textField(200),
  // An explicit author declaration for a genuinely new screen/control. The
  // replay still has to capture and assert an honest stable parent on base;
  // this field only controls the reviewer-facing absence label. Missing
  // media is never inferred to mean absence.
  baseState: z.enum(['present', 'not_present']).default('present'),
  animation: z.enum(ANIMATIONS).default('none'),
  controlledFailurePath: controlledFailurePathSchema.optional(),
}).strict();

const storyIntentObject = z.object({
  id: z.string().min(1).max(96).regex(ID_RE),
  claim: textField(MAX_TEXT),
  persona: z.enum(PERSONAS),
  viewports: z.array(viewportSchema).min(1).max(MAX_VIEWPORTS),
  intent: intentSchema,
}).strict();

const storyIntentSchema = storyIntentObject.superRefine((story, ctx) => {
  if (story.intent.controlledFailurePath && story.intent.steps[0] !== CONTROLLED_FAILURE_LABEL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intent', 'steps', 0],
      message: `A controlled failure must begin its reviewer-visible steps with: ${CONTROLLED_FAILURE_LABEL}` });
  }
  const names = new Set();
  story.viewports.forEach((viewport, index) => {
    if (names.has(viewport.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['viewports', index, 'name'], message: 'Viewport names must be unique within a story' });
    }
    names.add(viewport.name);
  });
});

const semanticIntentSchema = z.object({
  version: z.literal(PLAN_VERSION),
  impact: z.enum(IMPACTS),
  rationale: textField(MAX_TEXT),
  stories: z.array(storyIntentSchema).max(MAX_STORIES).default([]),
}).strict().superRefine((intent, ctx) => {
  if (intent.impact === 'none' && intent.stories.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories'], message: 'No stories are allowed when impact is "none"' });
  }
  if (intent.impact !== 'none' && intent.stories.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories'], message: 'At least one evidence story is required for a visible change' });
  }
  const ids = new Set();
  intent.stories.forEach((story, index) => {
    if (ids.has(story.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories', index, 'id'], message: 'Story ids must be unique' });
    }
    ids.add(story.id);
    if (intent.impact === 'ui' && story.intent.animation === 'motion') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories', index, 'intent', 'animation'], message: 'The motion profile requires impact "motion"' });
    }
  });
});

const actionBase = {
  id: z.string().min(1).max(96).regex(ID_RE),
  stage: z.string().min(1).max(64).regex(STAGE_RE),
};

const pointerRatio = z.number().min(0).max(1);
const actionSchema = z.union([
  z.object({ ...actionBase, type: z.literal('requestFailure'), path: controlledFailurePathSchema,
    enabled: z.boolean() }).strict(),
  z.object({ ...actionBase, type: z.literal('navigate'), path: relativePathSchema }).strict(),
  z.object({ ...actionBase, type: z.literal('click'), target: locatorSchema }).strict(),
  z.object({ ...actionBase, type: z.literal('fill'), target: locatorSchema, value: literalSchema() }).strict(),
  z.object({ ...actionBase, type: z.literal('press'), target: locatorSchema.optional(), key: textField(40) }).strict()
    .refine(({ key }) => /^(?:(?:Control|Meta|Alt|Shift)\+)?(?:Enter|Escape|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))$/.test(key), 'Unsupported key'),
  z.object({ ...actionBase, type: z.literal('select'), target: locatorSchema, value: literalSchema() }).strict(),
  z.object({ ...actionBase, type: z.literal('check'), target: locatorSchema }).strict(),
  z.object({ ...actionBase, type: z.literal('uncheck'), target: locatorSchema }).strict(),
  z.object({ ...actionBase, type: z.literal('hover'), target: locatorSchema }).strict(),
  z.object({ ...actionBase, type: z.literal('drag'), from: locatorSchema, to: locatorSchema }).strict(),
  z.object({ ...actionBase, type: z.literal('clickPoint'), surface: locatorSchema, xRatio: pointerRatio, yRatio: pointerRatio }).strict(),
  z.object({
    ...actionBase,
    type: z.literal('dragPoints'),
    surface: locatorSchema,
    from: z.object({ xRatio: pointerRatio, yRatio: pointerRatio }).strict(),
    to: z.object({ xRatio: pointerRatio, yRatio: pointerRatio }).strict(),
  }).strict(),
  z.object({ ...actionBase, type: z.literal('scrollIntoView'), target: locatorSchema }).strict(),
  z.object({
    ...actionBase,
    type: z.literal('scrollBy'),
    x: z.number().int().min(-2000).max(2000).default(0),
    y: z.number().int().min(-2000).max(2000).default(0),
  }).strict().refine(({ x, y }) => x !== 0 || y !== 0, 'scrollBy must move on at least one axis'),
  z.object({
    ...actionBase,
    type: z.literal('waitFor'),
    target: locatorSchema.optional(),
    state: z.enum(['visible', 'hidden']).optional(),
    text: textField(MAX_LOCATOR_VALUE).optional(),
    path: relativePathSchema.optional(),
    quietNetwork: z.boolean().optional(),
    timeoutMs: z.number().int().min(100).max(MAX_WAIT_MS).default(MAX_WAIT_MS),
  }).strict().refine((value) => [value.target, value.text, value.path, value.quietNetwork === true].filter(Boolean).length === 1,
    'waitFor requires exactly one of target, text, path, or quietNetwork')
    .refine((value) => value.state == null || value.target != null,
      'waitFor state is only supported with a target'),
]);

const assertionSchema = z.discriminatedUnion('type', [
  ...['visible', 'hidden', 'attached', 'detached', 'checked', 'focusWithin'].map((type) =>
    z.object({ type: z.literal(type), target: locatorSchema }).strict()),
  z.object({ type: z.literal('text'), target: locatorSchema, value: literalSchema(MAX_LOCATOR_VALUE), exact: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('count'), target: locatorSchema, count: z.number().int().min(0).max(1000) }).strict(),
  z.object({ type: z.literal('value'), target: locatorSchema, value: literalSchema() }).strict(),
  z.object({ type: z.literal('url'), path: relativePathSchema }).strict(),
]);

const sideSchema = z.object({
  startPath: relativePathSchema,
  actions: z.array(actionSchema).max(MAX_ACTIONS_PER_SIDE),
}).strict().superRefine((side, ctx) => {
  const ids = new Set();
  side.actions.forEach((action, index) => {
    if (ids.has(action.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['actions', index, 'id'], message: 'Action ids must be unique within a side' });
    }
    ids.add(action.id);
  });
});

const checkpointSchema = z.object({
  id: z.string().min(1).max(96).regex(ID_RE),
  label: textField(200),
  focus: z.object({ before: locatorSchema, after: locatorSchema }).strict(),
  assertions: z.object({
    before: z.array(assertionSchema).min(1).max(30),
    after: z.array(assertionSchema).min(1).max(30),
  }).strict(),
  animation: z.enum(ANIMATIONS).default('none'),
}).strict();

const replaySchema = z.object({
  before: sideSchema,
  after: sideSchema,
  checkpoint: checkpointSchema,
}).strict();

const hostedReplayEntrySchema = z.object({
  id: z.string().min(1).max(96).regex(ID_RE),
  replay: replaySchema,
}).strict();

const executableStorySchema = storyIntentObject.extend({ replay: replaySchema }).strict()
  .superRefine((story, ctx) => {
    if (story.intent.controlledFailurePath && story.intent.steps[0] !== CONTROLLED_FAILURE_LABEL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intent', 'steps', 0],
        message: `A controlled failure must begin its reviewer-visible steps with: ${CONTROLLED_FAILURE_LABEL}` });
    }
    const names = new Set();
    story.viewports.forEach((viewport, index) => {
      if (names.has(viewport.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['viewports', index, 'name'], message: 'Viewport names must be unique within a story' });
      }
      names.add(viewport.name);
    });
  });

const replayPlanSchema = z.object({
  version: z.literal(PLAN_VERSION),
  impact: z.enum(['ui', 'motion']),
  rationale: textField(MAX_TEXT),
  stories: z.array(executableStorySchema).min(1).max(MAX_STORIES),
}).strict().superRefine((plan, ctx) => {
  const ids = new Set();
  plan.stories.forEach((story, index) => {
    if (ids.has(story.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories', index, 'id'], message: 'Story ids must be unique' });
    }
    ids.add(story.id);
    if (story.intent.animation !== story.replay.checkpoint.animation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories', index, 'replay', 'checkpoint', 'animation'], message: 'Replay animation must match the accepted intent' });
    }
    if (plan.impact === 'ui' && story.replay.checkpoint.animation === 'motion') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories', index, 'replay', 'checkpoint', 'animation'], message: 'The motion profile requires impact "motion"' });
    }
    if (story.replay.checkpoint.animation === 'steps'
        && [story.replay.before, story.replay.after].some((side) =>
          side.actions.every((action) => ['waitFor', 'requestFailure'].includes(action.type)))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stories', index, 'replay', 'checkpoint', 'animation'],
        message: 'Steps video requires a visible interaction on both revisions; wait-only flows use screenshots',
      });
    }
    const expectedPath = story.intent.controlledFailurePath;
    const toggles = ['before', 'after'].map((side) => story.replay[side].actions
      .filter((action) => action.type === 'requestFailure')
      .map((action) => ({ path: action.path, enabled: action.enabled })));
    if (!expectedPath && toggles.some((sequence) => sequence.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories', index, 'replay'],
        message: 'A request failure must be declared in the accepted intent' });
    } else if (expectedPath && (toggles.some((sequence) =>
      !sequence.length || sequence[0].enabled !== true
      || sequence.some((toggle) => toggle.path !== expectedPath))
      || canonicalJson(toggles[0]) !== canonicalJson(toggles[1]))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stories', index, 'replay'],
        message: 'Both revisions must use the same declared request failure toggle sequence, beginning enabled' });
    }
  });
});

function samePath(left, right) {
  return left.length === right.length && left.every((part, index) => String(part) === String(right[index]));
}

function valueAtPath(value, path) {
  return path.reduce((current, part) => current == null ? undefined : current[part], value);
}

function normalizeZodIssues(error, value) {
  const flattened = [];
  const visit = (issue) => {
    if (issue.code === 'invalid_union' && Array.isArray(issue.unionErrors)) {
      const variants = issue.unionErrors.map((branch) => branch.issues);
      const submitted = valueAtPath(value, issue.path);
      if (submitted == null || typeof submitted !== 'object' || Array.isArray(submitted)) {
        flattened.push({ path: issue.path,
          message: submitted == null ? 'Required' : 'Expected an action or locator object' });
        return;
      }
      const discriminant = ['type', 'by'].find((key) => variants.some((branch) => branch.some((candidate) =>
        candidate.code === 'invalid_literal' && samePath(candidate.path, [...issue.path, key]))));
      if (discriminant) {
        const allowed = discriminant === 'type' ? ACTION_TYPES : LOCATOR_KINDS;
        if (!allowed.includes(submitted[discriminant])) {
          flattened.push({ path: [...issue.path, discriminant],
            message: `Expected one of: ${allowed.join(', ')}` });
          return;
        }
        const matching = variants.find((branch) => !branch.some((entry) =>
          entry.code === 'invalid_literal' && samePath(entry.path, [...issue.path, discriminant])));
        if (matching) {
          matching.forEach(visit);
          return;
        }
      }
      flattened.push({ path: issue.path, message: 'Expected a supported action or locator object' });
      return;
    }
    // Zod includes the submitted field names in this message. The planner
    // needs the expected field path, while diagnostics must not retain raw
    // tool arguments (including arbitrary object keys).
    flattened.push({ path: issue.path,
      message: issue.code === 'unrecognized_keys'
        ? 'Unexpected field(s); use only fields in the replay contract'
        : issue.code === 'invalid_string' && issue.validation === 'regex'
          ? 'Use a lowercase slug with letters, digits, hyphens or underscores'
        : issue.message });
  };
  error.issues.forEach(visit);
  return flattened.slice(0, 20).map((issue) => ({
    path: issue.path.map(String), message: issue.message,
  }));
}

function parseWith(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new VisualEvidenceValidationError(normalizeZodIssues(parsed.error, value));
  return parsed.data;
}

function parseIntent(value) {
  return parseWith(semanticIntentSchema, value);
}

function parseReplayPlan(value) {
  return parseWith(replayPlanSchema, value);
}

function safeParseIntent(value) {
  try { return { ok: true, value: parseIntent(value), errors: [] }; }
  catch (err) {
    if (!(err instanceof VisualEvidenceValidationError)) throw err;
    return { ok: false, value: null, errors: err.issues };
  }
}

function safeParseReplayPlan(value) {
  try { return { ok: true, value: parseReplayPlan(value), errors: [] }; }
  catch (err) {
    if (!(err instanceof VisualEvidenceValidationError)) throw err;
    return { ok: false, value: null, errors: err.issues };
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function planHash(value) {
  const plan = parseReplayPlan(value);
  return crypto.createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

function semanticIntentFromPlan(value) {
  const plan = parseReplayPlan(value);
  return parseIntent({
    version: plan.version,
    impact: plan.impact,
    rationale: plan.rationale,
    stories: plan.stories.map(({ replay: _replay, ...story }) => story),
  });
}

// Hosted planners choose only browser actions and assertions. Semantic fields
// come from the accepted run, so copying a claim or viewport cannot change it.
function replayPlanFromIntent(rawIntent, rawReplays) {
  const intent = parseIntent(rawIntent);
  const replays = parseWith(z.array(hostedReplayEntrySchema).min(1).max(MAX_STORIES), rawReplays);
  const expected = new Set(intent.stories.map((story) => story.id));
  const byId = new Map();
  for (const [index, entry] of replays.entries()) {
    if (!expected.has(entry.id)) {
      throw new VisualEvidenceValidationError([{
        path: ['replays', index, 'id'], message: `Story id ${entry.id} is not in the accepted intent`,
      }]);
    }
    if (byId.has(entry.id)) {
      throw new VisualEvidenceValidationError([{
        path: ['replays', index, 'id'], message: `Story id ${entry.id} is duplicated`,
      }]);
    }
    byId.set(entry.id, entry.replay);
  }
  const missing = intent.stories.filter((story) => !byId.has(story.id));
  if (missing.length) {
    throw new VisualEvidenceValidationError([{
      path: ['replays'], message: `Missing accepted story ids: ${missing.map((story) => story.id).join(', ')}`,
    }]);
  }
  return parseReplayPlan({
    version: intent.version,
    impact: intent.impact,
    rationale: intent.rationale,
    stories: intent.stories.map((story) => ({ ...story, replay: byId.get(story.id) })),
  });
}

// A local pass produces this small handoff, separately from its media and
// verdict. The hashes bind the submitted flow to the exact two Git revisions;
// hosted replay still independently decides whether it works there.
function parseAuthorPlanSubmission(value, intent, revisions = null) {
  const invalid = (path, message) => {
    throw new VisualEvidenceValidationError([{ path: ['visualEvidencePlan', path], message }]);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'baseSha,headSha,plan,planHash') {
    invalid('', 'Expected exactly baseSha, headSha, planHash, and plan');
  }
  for (const side of ['baseSha', 'headSha']) {
    if (typeof value[side] !== 'string' || !/^[0-9a-f]{40}$/.test(value[side])) {
      invalid(side, 'Expected an exact 40-character commit SHA');
    }
    if (revisions && value[side] !== revisions[side]) {
      invalid(side, `Does not match the imported pull request ${side}`);
    }
  }
  const plan = parseReplayPlan(value.plan);
  if (canonicalJson(semanticIntentFromPlan(plan)) !== canonicalJson(parseIntent(intent))) {
    invalid('plan', 'The plan changes the accepted visual evidence intent');
  }
  const hash = planHash(plan);
  if (value.planHash !== hash) invalid('planHash', 'Does not match the submitted plan');
  return { baseSha: value.baseSha, headSha: value.headSha, planHash: hash, plan };
}

function containsRelativePointer(plan) {
  const parsed = parseReplayPlan(plan);
  return parsed.stories.some((story) => ['before', 'after'].some((side) =>
    story.replay[side].actions.some((action) => action.type === 'clickPoint' || action.type === 'dragPoints')));
}

module.exports = {
  PLAN_VERSION,
  MAX_STORIES,
  MAX_VIEWPORTS,
  MAX_ACTIONS_PER_SIDE,
  MAX_WAIT_MS,
  MAX_SIDE_MS,
  MAX_TEXT,
  MAX_TYPED_VALUE,
  MAX_LOCATOR_VALUE,
  MAX_PATH,
  IMPACTS,
  PERSONAS,
  ANIMATIONS,
  CONTROLLED_FAILURE_LABEL,
  LOCATOR_KINDS,
  ACTION_TYPES,
  ASSERTION_TYPES,
  VisualEvidenceValidationError,
  validRelativePath,
  credentialLike,
  parseIntent,
  parseReplayPlan,
  safeParseIntent,
  safeParseReplayPlan,
  canonicalJson,
  planHash,
  semanticIntentFromPlan,
  replayPlanFromIntent,
  parseAuthorPlanSubmission,
  containsRelativePointer,
};
