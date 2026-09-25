# Homeroom platform conventions

This file is the authoritative spec for how apps on Homeroom work. It
is injected into every Mayor and Claude Code
system prompt so both follow the same conventions when planning
features, generating code, or explaining things to the user.

When the Mayor / Claude Code is editing an app, it may also see a
`CLAUDE.md` at the root of the app's repo. That file contains
**app-specific** guidance that the owner has written. Rules of
precedence:

- **Platform conventions below are authoritative.** They describe the
  environment every app runs in and must not be overridden by a repo's
  `CLAUDE.md`.
- **Repo `CLAUDE.md` covers app-specific details**: product intent,
  domain terms, any opt-in policies (e.g. marking tables private),
  taste/style choices. Follow it for anything app-specific that this
  file doesn't dictate.
- If the two conflict on a platform matter, this file wins. If a repo
  `CLAUDE.md` contradicts a platform rule, note that to the user; do
  not silently follow the repo.

---

## Essentials — the offline excerpt

Everything below this section is the full document. This short section
is the excerpt the platform ships INSIDE a connector work order, for a
coding agent whose container cannot reach this host to read the rest.
It is delimited by the `work-order` markers below and extracted by
`getWorkOrderEssentials()` in `src/services/prompts.js` — one source of
truth, so an edit here reaches both the full prompt and the excerpt.

Ordered by how badly an agent working offline gets each one wrong.

<!-- work-order:begin -->
1. **Three files are centrally hosted — never vendor them.** Every app
   loads the bridge, the native UI kit and (on the runtime path) Tailwind
   by relative path (`/usernode-bridge/v1/…`), never a hostname. A local
   container doesn't serve them, so the app renders unstyled and
   native-kit assertions fail *locally* — the sandbox, not your change.
   Copying any of them into the repo is forbidden: the copy freezes the
   day you make it, and the fleet-wide fix and one-redeploy rollback
   central hosting buys stop reaching the app.
   No automated check catches that; this rule is all that stands between
   you and a stale fork of platform infrastructure.
   A `cdn.tailwindcss.com` tag is a different thing — a legacy state many
   apps are still in, whose checks pass. Don't add one to new code (new apps compile their own stylesheet at build
   time; `/usernode-tailwind/v1/tailwind.js` is the escape hatch), don't
   "fix" one as a drive-by, and when migrating IS the task swap it to that
   path, including any copy of the CDN hostname in the app's `sw.js`
   precache list. The staging preview is the authority on styling.
   **The bridge tag is not conditional on calling a bridge API.** It is
   also how the app ANSWERS the shell, so an app that omits it is invisible
   to anything that asks the frame a question — offline launch included.
2. **`USERNODE_ENV` is `staging` or `production`.** Gate DATA and
   irreversible outbound side effects on it — `const IS_STAGING =
   process.env.USERNODE_ENV === 'staging'` — never a feature, a screen,
   an endpoint, an auth check, or which code path runs. If flipping it
   to `production` would make something STOP WORKING, you gated the
   wrong thing.
3. **A blank staging page usually means missing seed data, not a bug.**
   Staging starts from a copy of production, so tables your change
   creates and `staging:private` tables are EMPTY. Seed what a testing
   step needs in the same commit, in a boot-time block gated on
   `IS_STAGING`: idempotent (`ON CONFLICT DO NOTHING`), obviously fake
   ("Staging demo …"), a handful of rows, never cloned from real users.
   Seed FAKE identities only — never rows owned by whoever opened the
   preview, and never a signal your own logic reads ("has this user
   done X?"). Every check runs against staging, so seeding that
   fabricates the answer makes that code path untestable by the gate
   and different for real users.
4. **Tables are public by default; mark the sensitive ones private.**
   `COMMENT ON TABLE foo IS 'staging:private'` copies the schema to
   staging without the rows. Use it for auth material, direct messages,
   financial data, credentials and personal information beyond a public
   username. A public table must never carry a foreign key to a private
   one. Schema is applied idempotently on boot: `CREATE TABLE IF NOT
   EXISTS`, `ADD COLUMN IF NOT EXISTS`.
5. **For every user-visible screen, add or extend a `dapp.json` test in
   the same commit.** Use `{ name, path, expectSelector?, expectText? }`;
   tag one representative flow with
   `{ id, visual: true, impact: ["path/**"] }`. Every proposal also gets a
   free "loads with no console errors" check. Checks GATE MERGE — a proposal whose checks
   are not passing cannot merge even with a winning vote. The test route
   renders against an empty staging database, so seed what it needs.
   Demo routes are fine for regression tests, but never add a
   screenshot-only query parameter. After a visible change, call
   `record_visual_evidence_intent` with the claim, real user flow, focus,
   persona, viewports, and optional animation. Homeroom performs it against
   exact base/head revisions and replays it twice. For a non-visual change,
   record `impact: "none"` with a specific rationale.
6. **Auth is iframe token injection — do not roll your own login.** The
   shell mints an RS256 JWT per user per app and injects it as
   `?token=`; the app verifies it with `USERNODE_JWT_PUBLIC_KEY`,
   pinning `algorithms: ['RS256']`, `issuer: 'usernode'` and audience
   `usernode:app:<USERNODE_APP_ID>`. All non-GET and all `/api/*`
   requests are deny-by-default; `req.user` is `{ id, username,
   usernode_pubkey, locale }`.
7. **Per-app config goes in `dapp.json`'s `secrets` array, never
   hardcoded.** Declare `key` / `description` / `required` / `private`;
   values are set by users through the platform's Secrets UI. A
   `required: true` key with no value BLOCKS the deploy. A
   `required` + `private` key must commit a `staging_default`.
   `DATABASE_URL`, `USERNODE_JWT_PUBLIC_KEY`, `USERNODE_APP_ID`, `PORT`
   and `USERNODE_ENV` are reserved and injected for you.
8. **The platform provides an LLM proxy and file storage — don't call
   third-party APIs directly and never ask users for API keys.** AI goes
   through `USERNODE_LLM_PROXY_URL` with the app token plus the user's
   forwarded iframe token, billed to their own budget under a consent
   grant. Uploads go through `usernode.uploadFile()` (bridge) or
   `USERNODE_STORAGE_URL` (server); persist the returned URL, never
   image bytes in Postgres. Both are absent in staging — detect and
   degrade. App-directory reads use `USERNODE_PLATFORM_API_V1_URL`,
   never a hardcoded host. Handle checks use `usernode.lookupUser()` /
   `searchUsers()` — never a guess from users your app has already seen.
9. **Install a SIGTERM/SIGINT shutdown handler** that stops accepting
   connections, drains for ~3 seconds, closes the pool and exits. For
   Dockerfile builds, use exec-form `CMD ["node", "server.js"]`.
10. **`BUILD_ENGINE=auto`:** BuildKit prefers `Dockerfile.kubernetes`, then
    `Dockerfile`; otherwise kpack. Use a numeric non-root `USER` and writable
    app paths. Keep npm scripts/lockfile for kpack.

One thing NOT to apply: the full document contains a section titled
"Don't `git push` yourself". That is addressed to Homeroom's own build
worker, which runs with no GitHub credentials. It does not apply to a
coding agent working in the user's own fork — pushing your branch is
exactly what you are being asked to do.
<!-- work-order:end -->

---

## Stack

Each app is a Node.js / Express server with an HTML + JS + Tailwind
frontend and its own PostgreSQL database. Apps listen on port 3000.

The build contract depends on the platform runtime and configured build engine:

- **Kubernetes:** `BUILD_ENGINE` selects how the exact Git revision is built.
  - `auto`: BuildKit uses the first Dockerfile present from
    `BUILDKIT_DOCKERFILES` (default: `Dockerfile.kubernetes,Dockerfile`).
    Trees without a matching Dockerfile use kpack/Paketo. If the BuildKit
    infrastructure is unavailable, `auto` can also fall back to kpack;
    a Dockerfile build failure does not trigger that fallback.
  - `buildkit`: requires a matching Dockerfile and a working BuildKit
    infrastructure; failures are reported without falling back to kpack.
  - `kpack` (the code default when unset): uses the platform-owned Paketo
    builder and ignores Dockerfiles.

  For BuildKit, edit the selected Dockerfile's `RUN`, `COPY`, `ENTRYPOINT`
  and `CMD` instructions to control the build and launch process. For kpack,
  declare asset compilation in `package.json`'s `build` script and launch
  in `start` (normally `node server.js`); commit the matching lockfile.
  A declared `ensure:shell` script takes precedence over `build` on kpack,
  so it must produce all required assets.
- **Standalone Docker:** the platform builds the repository's root
  `Dockerfile`. Keep its asset compilation aligned with `npm run build`
  so both runtimes produce the same assets.

Check the build logs for the engine actually used before choosing a fix.
On kpack, Dockerfile edits have no effect: missing OS packages or build tools
in the platform builder need a platform-level change; report that requirement.
Its legacy Tailwind compatibility buildpack covers known older app layouts,
not arbitrary Dockerfile instructions. Keep asset compilation in an explicit
npm build script and invoke it from the Dockerfile too.

**Kubernetes app and preview images must run as non-root.** Their Pods set
`runAsNonRoot: true` without supplying a `runAsUser`. In the Dockerfile's
final runtime stage, declare a numeric non-zero user, such as
`USER 1000:1000` for the scaffold's Node image. Give that user ownership of
paths the app must write (for example with `COPY --chown=1000:1000` or a
targeted `chown`). A missing `USER` on a root-default base image produces
`CreateContainerConfigError`; a symbolic `USER node` can also be rejected
because Kubernetes cannot verify its UID. Rootless BuildKit describes the
builder's isolation, not the output image's runtime user.

Existing app repositories and older proposal branches keep their own
Dockerfiles when the platform template changes. Update the affected source,
rebuild and redeploy it; restarting the unchanged image cannot fix its user.
Keep non-root enforcement enabled.

Required env vars at runtime (provided by the harness):

- `DATABASE_URL` — Postgres connection string for this app's DB.
- `USERNODE_JWT_PUBLIC_KEY` — the platform's RSA **public** key (PEM).
  Verifies iframe-issued user tokens. The private half never leaves the
  platform, so your app can check who a user is but cannot mint an
  identity — and no other app can mint one for yours.
- `USERNODE_APP_ID` — this app's numeric platform id. User tokens are
  minted with audience `usernode:app:<USERNODE_APP_ID>`, which is what
  stops a token issued for another app from authenticating here.
- `PORT` — always `3000`.
- `USERNODE_ENV` — either `production` or `staging`. See "Staging vs
  production" below.

Apps that need additional env vars (third-party API keys, on-chain
addresses, etc.) declare them in `dapp.json` at the repo root —
see "Per-app secrets" below.

## Auth — iframe token injection

Apps run inside an iframe on the Homeroom shell. The shell mints an
RS256 JWT for the logged-in Homeroom user, scoped to **your app**, and
injects it as a `?token=…` query param on the initial iframe load. The
app's own frontend forwards that token on subsequent fetches via the
`x-usernode-token` request header.

Tokens are asymmetric and per-app: you hold only the public key, and
the token's audience names your `USERNODE_APP_ID`. Verification must
therefore pin three things — algorithm, issuer, audience — plus the
`pur` (purpose) claim. **Pinning `algorithms: ['RS256']` is not
optional:** every app knows the public PEM, so a verifier that also
accepts HS256 would treat that PEM as an HMAC secret and let any caller
forge any user.

Server-side the pattern (already present in the scaffold) is:

```js
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;
const PUBLIC_API_PATHS = new Set(['/health']);
// Public path prefixes that bypass the JWT gate. `/explorer-api/*`
// is a transparent proxy to the public block explorer — gating it
// blocks the bridge's POST /<chain_id>/transactions polling from
// inside the iframe (which has no token to forward) and adds zero
// security since anyone can hit the upstream directly.
const PUBLIC_PREFIXES = ['/explorer-api/'];

app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],       // never omit — see above
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});
```

Key properties:

- `req.user` contains at minimum `{ id, username, usernode_pubkey, locale }` once authenticated.
  `usernode_pubkey` is the user's linked Homeroom wallet address (`ut1...`) or `null` if not linked.
  `locale` is the user's platform-level language preference — a BCP-47
  tag like `"id"` or `"pt-BR"`, or `null` when they haven't set one
  (see "User language preference" below).
- All non-GET requests + all `/api/*` requests are **deny-by-default**.
- To intentionally expose an API route without auth, add its exact
  path to `PUBLIC_API_PATHS`. Do **not** remove the middleware.
- `/explorer-api/*` is intentionally public (see `PUBLIC_PREFIXES`).
  The bridge polls `POST /<chain_id>/transactions` after every send to
  wait for inclusion, and that request is issued from the iframe's JS
  with no platform token to forward.
- The HTML shell is also auth-gated so direct visits to the staging
  subdomain don't reveal the app.

When adding a new API route, assume `req.user` is present. If a brand
new endpoint **must** be public (e.g. a webhook), add its path to
`PUBLIC_API_PATHS` and mention this in the dev-chat reply.

### Chromeless deep links — forwarding share-link paths

An unauthenticated **top-level document** visit to the app's own
subdomain (a share link pasted into a browser) can't be served — the
iframe token only exists inside the platform shell. The scaffold
redirects such visits to the platform's chromeless view of the app:

```
<PLATFORM_BASE_URL>/app/<slug>/full?path=<encoded req.originalUrl>
```

The shell then embeds the app with a real token AND forwards the inner
path+query into the iframe, so the visitor lands on the shared screen
instead of the app's home. Contract for the `?path=` query parameter:

- The value is the app-relative path+query encoded as one query value
  (`encodeURIComponent(req.originalUrl)`). The shell decodes it once and
  validates it before use.
- `path` may contain an inner query after decoding; encoding it as one value
  ensures that query's own `&`/`=`/`?` survive.
- Relative-only after decoding: the value must start with a single `/`, never
  `//`, no scheme or
  host, no whitespace or `` \ ` ' " < > ``, ≤ 512 chars. The shell
  drops anything else and loads the app root.

When redirecting, gate on `req.get('sec-fetch-dest') === 'document'`
(as the scaffold does) so the platform shell is never loaded inside its
own app iframe. Apps generated before this convention can adopt it by
appending `'?path=' + encodeURIComponent(req.originalUrl)` to their clean
chromeless redirect (see the current scaffold's `server.js` for the
attribute-safe character check used on the landing-page anchor).

## Database

- Each app gets its own Postgres DB. Schema is applied idempotently
  on boot — use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD
  COLUMN IF NOT EXISTS` so repeated migrations are safe.
- Connect via a single `pg.Pool({ connectionString: process.env.DATABASE_URL })`.
- Record ownership with `user_id` / `username` from `req.user`.

## Graceful shutdown

Every app container is stopped and replaced on each deploy — a staging
preview rebuilds on every push, and production is rebuilt on every merge.
The runtime sends **SIGTERM** and gives the process a bounded grace period
before force-killing it. An app that ignores the
signal is killed mid-request with open transactions, and the deploy waits
out the whole grace window for nothing.

So **every app must install a shutdown handler.** The contract: stop
accepting new connections, let in-flight requests finish under a hard
deadline, close the Postgres pool, exit.

```js
const DRAIN_MS = 3000;
let shuttingDown = false;

// Capture the listener — you need it to stop accepting connections.
const server = app.listen(process.env.PORT || 3000, () => {
  console.log(`listening on ${process.env.PORT || 3000}`);
});

async function shutdown(signal) {
  if (shuttingDown) return;   // idempotent: SIGTERM then SIGINT must not double-run
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, draining`);
  server.close(() => {});             // stop accepting new connections
  server.closeIdleConnections?.();    // drop idle keep-alives immediately
  const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
  t.unref?.();                        // never hold the process open on this timer
  try {
    await pool.end();                 // finish/close DB work cleanly
  } catch (e) {
    console.error('[shutdown] pool.end failed', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

Rules:

- **Capture the value returned by `app.listen(...)`.** Without it there is
  no way to stop accepting connections; `app.listen()` whose return value
  is discarded is the single most common reason this handler can't be
  written later.
- **Handle both `SIGTERM` and `SIGINT`**, and make the handler
  **idempotent** — a repeat signal during the drain must be a no-op, not a
  second teardown.
- **The drain deadline is a literal constant in your app, not an env var.**
  The platform does not set one. ~3 seconds is right: long enough for a
  normal request to finish, short enough to stay inside the platform's
  stop grace.
- **Don't assume you have ten seconds.** The platform's grace is a
  *ceiling* that exists to catch pathological containers, not an
  allowance to spend. Exit as soon as you're actually done.
- **Serve `503` from `/health` once `shuttingDown` is true** so anything
  polling readiness sees the container leaving rotation rather than a
  connection reset.
- **For Dockerfile builds (BuildKit or standalone Docker), use exec-form
  `CMD`** — `CMD ["node", "server.js"]`, not `CMD node server.js`.
  Shell form can interpose `/bin/sh` between the
  init process and Node, and a shell that doesn't `exec` swallows the
  signal. Kubernetes images built by kpack use the Paketo launch process
  and the npm `start` script; Dockerfile edits do not affect that path.
  Kubernetes images built by BuildKit use the selected Dockerfile's launch
  instructions.

Apps generated before this convention may have no application-level drain.
Do not rely on an init process or the runtime to close their transactions.
**Adopt the handler above the next time you edit an app's `server.js`**, the same way
the chromeless-deep-link convention is adopted.

## Staging vs production — `USERNODE_ENV`

Every PR spawns a fresh **staging** container at a unique subdomain.
When it merges, the branch is redeployed to the **production**
container.

Apps receive `USERNODE_ENV=staging` or `USERNODE_ENV=production`.
The staging container exists so a tester approves **the exact app that
will ship**. That only holds if staging and production run the *same
code path* — `USERNODE_ENV` may swap the **data** behind that path and
suppress **real-world outbound side effects**, but it must never change
which features exist or how the core logic behaves.

Canonical helper:

```js
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
```

### Gate data and side effects — never features or logic

✅ **Legitimate uses of `IS_STAGING`:**

- **Seed mock data** for tables that aren't copied into staging
  (newly created tables, `staging:private` tables, hard-to-reach
  states). See "Staging mock data" below.
- **Suppress irreversible outbound side effects** — don't send real
  emails, charge real cards, post to real webhooks, or broadcast real
  on-chain transactions from staging. Point at a sandbox endpoint or
  no-op instead, but keep the surrounding code path identical (same
  validation, same DB writes, same response shape) so the path is
  actually exercised by the tester.
- **Show a "staging" indicator** in the UI so testers know what
  they're looking at.

🚫 **Never gate these on `USERNODE_ENV`:**

- **Feature availability.** No feature, screen, button, or endpoint
  may exist in one environment and be absent in the other. If a tester
  approves it, production must have it; if production lacks it, the
  tester must not see it.
- **Auth / permissions.** Don't auto-grant admin, bypass login, or
  seed yourself into a privileged table only in staging. Admin and
  permission flows must be reachable in production the same way.
  (If a feature needs an admin to operate, it's broken in production
  the moment its admin only exists in staging.)
- **The default core logic path.** A "testing mode" that swaps the
  real implementation for a fake one (mock wallets, fake balances,
  short-circuited game logic) is fine **as an explicit, opt-in tool
  available in both environments** — but it must NOT be the silent
  default a tester sees, and it must NOT be env-exclusive. If staging
  defaults to the mock path, the tester approves the mock — not the
  real feature — and ships a product nobody actually exercised. Keep
  the real path as the default everywhere; let mock mode be something
  you deliberately turn on (query param, settings flag, admin
  toggle).

Rule of thumb: if flipping `USERNODE_ENV` to `production` would make a
feature **stop working** (rather than just operate on real data /
real endpoints), you've gated the wrong thing. Move the difference to
**data** (seed it) or to a **single outbound boundary** (the email /
charge / chain call), and leave everything else identical.

## Staging mock data

Testing instructions for a staging preview are only useful if the data
they reference actually exists there. Staging starts from a copy of the
production database (see "Public vs private tables"), so three kinds of
data are MISSING and need seeding when a testing step depends on them:

1. **Tables newly created by this change** — they don't exist in prod
   yet, so the boot migration creates them empty in staging.
2. **`staging:private` tables** — copied schema-only, always empty.
3. **States hard to reach by clicking around** — a populated
   leaderboard, a multi-user interaction, a half-finished game.

Two sanctioned mechanisms, both guarded by the `IS_STAGING` helper
above:

- **Boot-time seed block**, run right after the idempotent migration:

  ```js
  if (IS_STAGING) {
    await pool.query(
      `INSERT INTO posts (id, username, title)
       VALUES (900001, 'staging-demo-user', 'Staging demo post #1')
       ON CONFLICT (id) DO NOTHING`
    );
  }
  ```

- **Request-time demo injection** behind
  `IS_STAGING && req.query.demo === '1'` — for read-only demo state
  that shouldn't persist in the DB. Point the testing block's `path:`
  at the `?demo=1` URL.

Seed rules:

- **Idempotent.** Staging containers rebuild on every push, so seeds
  re-run on each boot — use an existence check or
  `ON CONFLICT DO NOTHING`.
- **Obviously fake.** Give seeded rows a consistent "Staging demo …"
  prefix so they can't be mistaken for real user content.
- **Small.** A handful of rows — just enough for the testing steps.
- **Never reference real users.** Use fake usernames/IDs
  (e.g. `staging-demo-user`), never rows cloned from prod.
- **Strictly a no-op outside staging.** The whole block is gated on
  `USERNODE_ENV === 'staging'`; production data is never touched.

Tie-in with testing instructions: the testing steps you emit must
reference the seeded entities by name ("Open the thread 'Staging demo
thread' and …"), so a tester knows exactly what they should be seeing.

### Seeded data must not fabricate a signal your logic reads

Seeding decides what a preview *looks* like. It can also decide what
your code *concludes*, and that is where it stops being cosmetic. The
merge gate only ever runs against staging (see "Proposal tests" below),
so a code path that reads data seeding manufactured is a path no check
can observe: it goes green, and it answers differently for real users.

The shape of it, from a real case. An app added "you may only invite a
handle this app has seen", where *seen* meant list owners, list members
and item authors. The same app seeded a demo list **owned by whoever
opened the preview**. So in staging every visitor was already an owner,
therefore already seen, and inviting anyone worked. In production
nothing is seeded, a user who had opened the app but not yet created
anything was in none of those tables, and inviting them failed — a
regression, shipped past 24 green checks including the change's own new
test.

Neither half was a rule violation. Gating seed data on `IS_STAGING` is
the rule, and seeding a preview so it isn't blank is also the rule.
Together they made seeded rows indistinguishable from real ones to the
app's own logic. Three habits keep them apart:

- **Never seed the visitor.** Seeded rows belong to fake identities
  (`staging-demo-user`), never to `req.user`. This is the "never
  reference real users" seed rule above, and it is the one that bites
  hardest — the visitor is the account every code path checks against,
  so attributing seeded rows to them is handing the preview a
  credential production won't have.
- **Request-time seeding only behind `?demo=1`.** Never seed from a
  route the app serves normally. A `GET /api/lists` that writes demo
  rows as a side effect leaves no way to ask the app what production
  looks like; keep it behind `IS_STAGING && req.query.demo === '1'` and
  the plain route stays honest.
- **Ask what the empty database answers.** Before shipping logic of the
  form "has this user done X / does this user appear in Y", check
  whether staging seeding is what put them there. If it is, the gate
  cannot test the check you just wrote — and flipping `USERNODE_ENV` to
  `production` against a real database is the comparison that shows it.

When a change does read a signal like that, **declare a test on the
unseeded route** as well: the same path *without* `?demo=1`, asserting
the production-shaped answer — the empty state, the refusal, the
fallback copy. Because the two sanctioned mechanisms are boot-time
seeding of fake identities and `?demo=1` injection, that plain route is
the closest thing to production the gate can reach.

### Make the changed screen URL-reachable — screenshot-state deep links

Legacy proposals could only navigate to a URL, so this section historically
required a query/hash parameter that forced an interaction-only state open.
Agent-authored visual evidence removes that requirement: the evidence agent
can perform the real clicks, typing, keyboard input, selection, hover,
scrolling, and bounded pointer gestures, then ordinary platform code replays
the accepted plan twice. It never falls back to the home screen.

Do **not** add a screenshot-only route for a modal, bottom sheet, wizard, game
state, or menu. Call `record_visual_evidence_intent` instead and describe how a
person reaches the state. A deterministic demo/deep route is still useful when
it is part of the product, seeds a durable `dapp.json` regression check, or
gives reviewers a stable "Test this change" entry point; in those cases keep
it as an actual supported testing surface rather than capture-only plumbing.

Rules:

- **Deterministic.** Enter a fixed state (fixed seed, fixed entities) so
  before/after shots of the same path are comparable run to run.
- **Data writes stay staging-gated.** If entering the state writes to
  the database, gate it per the seed rules above (`IS_STAGING`,
  `?demo=1`). A pure UI-state link (start a local demo match, open a
  panel — no persistent writes) should work in **all** environments: the
  "before" shot is taken from production, so an env-gated link starves
  it forever, while an ungated one starts working the moment it ships.
- **Lock it in with a test.** Add or extend a `dapp.json` test in the
  same commit (`expectSelector` on the changed element at that path — see
  "Proposal tests" below) so a state link that stops rendering fails
  checks instead of silently regressing to home-screen shots.
- **Verify it renders.** On a build turn, load the exact `path:` URL in
  the in-loop browser and confirm the changed UI is actually visible
  before you commit.
- If a new screen genuinely has no base-side equivalent, declare a stable
  parent container and assertions that prove absence before and presence
  after. Do not manufacture a base-only fallback route.

Two related notes on `path:` form:

- **Hash-routed child apps.** If this app is a single-page app that
  routes off the URL fragment, write the fragment into the path —
  `path: /#/settings` — so the shot lands on the right screen. (The
  self-app has its own special handling; see the next section.)
- **Both frames, automatically.** Every `path:` is captured in BOTH the
  default 1280×800 desktop frame (still + animated recording) and a
  phone-sized 390×844 frame (still image only), so mobile-only changes
  show up without any annotation — the phone row is labelled "(mobile)"
  so reviewers know what frame they're looking at. The legacy `@mobile`
  annotation (`path: /board @mobile`) is still accepted but redundant
  now; just point `path:` at the route where the change is visible.

### Testing `path:` for the hybrid-routed self-app

The before/after screenshots and the "Test this change" button visit the
testing block's `path:` joined onto the staging origin. Most apps are
path-routed, so a plain pathname (`/board`, `/settings?demo=1`) lands on
the right screen.

**The self-app (social-vibecoding) uses clean path routes for app screens**
(`/app/<slug>`, `/app/<slug>/dev/proposals/<id>`,
`/app/<slug>/dev/sessions/<id>`, …). Other platform screens remain fragment
routes (`#leaderboard`, `#admin/...`). So when your change is to a self-app
screen, write the `path:` with a leading slash:

- `path: /app/<self-slug>/dev/proposals/<id>`
- `path: /leaderboard`
- `path: /admin/analytics`

The platform keeps `/app/...` routes as clean paths when capturing and
previewing. It moves the other listed self-app routes into the fragment so
the shot shows the changed screen instead of the homepage. **The admin
surfaces are in-app hash routes too**: the former standalone pages (`/dashboard`, `/admin`,
`/status`, `/node-status`, `/debug`, `/gallery`, `/admin-features`) are
now sections of the single `#admin` console — write them as
`/admin/analytics`, `/admin/estimator`, `/admin/status`, `/admin/node`,
`/admin/merges`, `/admin/gallery`, `/admin/features`. Their old pathnames still resolve
(they serve client-side redirect stubs into the matching section), but
pointing `path:` straight at the hash route saves a hop. The only
genuinely standalone server page left is `/cli/authorize`. **Always
point a deep `path:` at the specific changed self-app screen** —
omitting it defaults to `/` (the home feed), which no capture fix can
rescue.

## Proposal tests — "CI for proposals"

Every proposal carries a **checks** status: after each staging build the
platform runs a set of automated headless-browser tests against the
proposal's staging preview and records a pass/fail result. **A proposal
whose checks are not passing — failing, still running, or couldn't run —
is BLOCKED from merging even with a winning vote** (admins can still
force-merge). This is the platform's safeguard against merges that break
the app.

A **test** navigates one staging route and asserts that the page loads
(HTTP < 400), throws no console errors / uncaught exceptions, and —
optionally — that an expected element or text is present. The
console-error check is the built-in baseline: every proposal gets a
"loads with no console errors" test on its routes for free, even with no
tests declared.

Declare tests in a top-level `tests` array in `dapp.json`. They live in
the repo and **accumulate across proposals** — once a proposal merges, its
tests run on every future proposal, exactly like CI tests in a GitHub
repo. Shape:

```json
{
  "tests": [
    {
      "id": "board.default",
      "name": "Board renders",
      "path": "/board?demo=1",
      "expectSelector": ".board",
      "visual": true,
      "impact": ["frontend/src/features/board/**", "public/js/board.js"]
    },
    { "name": "Settings opens", "path": "/settings", "expectText": "Preferences" }
  ]
}
```

Per-test fields:

- `path` — **required.** A relative route within the app (same rules as a
  testing-block `path:`: starts with a single `/`, no scheme/host). For
  non-app self-app screens, use the in-app route segments (e.g.
  `/leaderboard`) — the platform normalises those into the fragment. Clean
  `/app/<slug>/...` paths remain paths.
- `name` — short label shown in the checks detail. Defaults to the path.
- `expectSelector` — optional CSS selector that must be present after the
  page settles.
- `expectText` — optional text that must appear in the page body.
- `allowConsoleErrors` — set `true` only for a route that legitimately
  logs errors; it opts that one test out of the baseline no-console-errors
  rule.
- `visual` — set `true` on representative flows eligible for before/after
  capture; the check must have `expectSelector` or `expectText` so Homeroom
  knows the state is ready.
- `id` — required with `visual: true`; a stable lowercase scenario name
  (for example `settings.profile-edit`).
- `impact` — required with `visual: true`; up to 20 repo-relative globs using
  `*`, `?`, or `**`. A changed file must match. Keep this mapping in
  `dapp.json`, not in source functions.

Visual scenario metadata remains useful executable documentation and durable
regression coverage. Reviewer-facing visual evidence is proposal-specific:
the authoring agent declares up to three claims and can submit the typed UI
flow it used during implementation. A purpose-bound evidence agent can also
explore the exact base/head previews to produce a plan. The platform replays
either plan twice and verifies the generated media. No matching scenario and no
submitted legacy route is ever permission to publish `/` as a fallback.

When you add or change a user-visible screen, **add or extend a test for
it** in the same commit, pointing it at the same route(s) you put in the
TESTING block's `path:` lines. The test's route renders against a FRESH,
EMPTY staging database, so seed any data the route needs per "Staging mock
data" above (a blank page usually means missing seed data, not a bug). A
test that depends on missing seed data will fail and block your merge.
Because checks gate merge, verify your declared tests pass (use the in-loop
browser on a build turn) before you commit.

**What the checks cannot see.** Every check runs against the staging
preview, with your `IS_STAGING` seeding already applied. Nothing on the
platform ever exercises the production shape, so a passing gate is
evidence the change works *in staging* — not evidence that it works.
That gap only bites when app logic reads data staging seeding produced,
and "Seeded data must not fabricate a signal your logic reads" above is
how to stay out of it: seed fake identities, keep request-time seeding
behind `?demo=1`, and declare a test on the unseeded route whenever new
logic asks whether a user or a row already exists.

## Repo test suites on build turns — run them efficiently

Some repos (the platform itself included) carry their own local test
suite (`npm test`). Inside the worker container a full-suite pass can
take several minutes, so wasted runs directly slow your turn down.
Discipline:

- **While iterating on a single fix, run only the affected test
  file(s)** (e.g. `node --test tests/foo.test.js`) — never the full
  suite.
- **Batch-fix before retesting.** When your change breaks many tests,
  run the full suite ONCE to collect the complete failure list, fix
  ALL the failures, and only then rerun to confirm. Do not loop
  "fix one test → rerun the suite → fix the next".
- **At most two full-suite passes per turn**: one to collect failures,
  one to confirm the fixes. The proposal checks re-run everything
  against staging after you commit anyway, so a third local pass buys
  nothing.
- **Keep the output small.** Pipe suite output through
  `grep "^not ok"` / `tail` so a full-suite dump doesn't crowd your
  context.

## Public vs private tables — **IMPORTANT**

Staging containers get a **copy of the production database** so PRs
can be tested against realistic data. This is safe for the vast
majority of tables — app state, counters, public posts, settings,
game scores, leaderboards, etc. — and is the default.

**Tables are PUBLIC by default.** A table is marked private only when
its rows contain content that another Homeroom user must not see if
they open a staging preview of this app.

Mark a table private by adding a Postgres comment:

```sql
COMMENT ON TABLE direct_messages IS 'staging:private';
```

Private tables are copied **schema-only** to staging — structure
only, no rows. In staging, seed them yourself if you need test data:

```js
if (IS_STAGING) {
  await pool.query(`INSERT INTO direct_messages (sender_id, body) VALUES ($1, $2)`,
                   [1, 'Staging test message']);
}
```

### Decide by asking: "would a stranger seeing every row in this
table be a problem?"

Mark **private** when the table stores:

- Authentication material (password hashes, OAuth tokens, 2FA secrets).
- Direct messages, private chats, one-to-one content.
- Financial data (transactions, balances, card info).
- API keys or credentials the user entrusted the app with.
- Personal information beyond a public username (real names, emails,
  phone numbers, addresses, DOB).
- Anything the app's own UI gates behind "only the owner can see this".

Leave **public** (the default) for:

- App content that's already visible to other users in-app: posts,
  leaderboards, comments, public profiles, reactions.
- Configuration / state: feature flags, app-level counters, schemas.
- Reference data: categories, tags, lookup tables.
- Aggregates and analytics that don't reveal individual identity.

### Rules the migration linter enforces

- **A public table MUST NOT have a foreign key to a private table.**
  If you need this relation, either the parent is actually public
  (re-evaluate), or the child should be private too. This keeps
  staging DBs consistent (no dangling FKs).

### When the Mayor / Claude Code creates a new table

1. **Create it public by default** (no comment needed).
2. **Run the "would a stranger seeing every row be a problem?" test.**
3. If the answer is yes, add `COMMENT ON TABLE foo IS 'staging:private'`
   in the same migration, and generate an `IS_STAGING` seed block if
   the feature would otherwise break on an empty staging table.
4. Mention the choice briefly in the dev-chat reply so the user can
   correct it: "Marked `messages` private because it stores 1:1 chats —
   staging will have an empty table."

When the Mayor is planning a feature that clearly involves sensitive
data (DMs, accounts, payments), it should note out loud in its
plan that the relevant tables will be private and staging will seed
fake rows. This sets user expectations before CC runs.

## Per-app secrets — `dapp.json`

Apps that need env vars beyond the four platform-injected ones declare
them in a `dapp.json` manifest at the repo root. The
platform reads this file on every deploy (initial creation, staging
PR builds, production rebuilds) and:

- Injects stored values into the container's environment.
- **Blocks the deploy** if any `required: true` key has no stored
  value. New apps land in `awaiting_secrets` status; production
  rebuilds throw with a `missingSecrets` list and the version pill
  goes red until values are filled.
- Surfaces the manifest entries in the Secrets modal (header key icon
  in the app view) where admins set values directly and non-admins
  open a vote-based proposal.

Manifest shape:

```json
{
  "name": "My Cool App",
  "secrets": [
    {
      "key": "STRIPE_SECRET_KEY",
      "description": "Live Stripe secret for charging cards",
      "required": true,
      "private": true
    },
    {
      "key": "DEFAULT_LOCALE",
      "description": "Fallback locale when no Accept-Language header is set",
      "required": false,
      "default": "en-US"
    }
  ]
}
```

### Top-level `name` — the app's display name

`dapp.json` may carry an optional top-level `"name"` string (1–64
characters). It is the **source of truth for the app's display name**
and takes precedence over the platform-stored name. On every
production deploy the platform reads it and reconciles the app's
display name to it; when `name` is absent, the existing platform name
is left untouched (a clean no-op for legacy apps).

Because the name lives in the repo, **renaming an app is just a PR
that edits this field**. The platform's "Rename" button opens exactly
such a PR (creating `dapp.json` if the repo doesn't have one yet); the
rename takes effect when that PR is voted in, merged, and redeployed —
not before. Don't add code that mutates the display name through any
other channel; edit `dapp.json`'s `name` and let the deploy apply it.

### Top-level `visibility` — who can build / see & use the app

`dapp.json` may carry an optional top-level `visibility` block — the
**source of truth for the app's two visibility statuses**:

```json
{
  "visibility": {
    "build": "private",
    "view": "public"
  }
}
```

- `build` — who can participate in building the app (group chat, dev
  sessions, voting). `"public"` = anyone; `"private"` = invited
  collaborators only.
- `view` — who can see the app exists and use it (home list, the
  app's subdomain). `"public"` = anyone; `"private"` = collaborators
  only.

Rules, mirroring the top-level `name`:

- On every production deploy the platform reads the block and
  reconciles the app's stored statuses to it. An **absent block or
  absent key leaves the platform value untouched** — a clean no-op
  for apps that never declare it.
- Values other than `"public"` / `"private"` are ignored (treated as
  absent) with a warning.
- The combination `build: "public"` + `view: "private"` is invalid
  (an app anyone can build can't be hidden) — the platform skips the
  reconcile and keeps the current statuses.
- **Changing visibility is just a PR that edits this block.** The
  platform's Members & visibility panel opens exactly such a PR; the
  change takes effect when the PR is voted in, merged, and
  redeployed — not before. Don't mutate visibility through any other
  channel.
- Inviting individual users to a private app is a separate, in-app
  flow — it is NOT represented in `dapp.json`.

### Top-level `admins` — who can administer this app

`dapp.json` may carry an optional top-level `admins` array — the
**source of truth for the app's per-app admin roster**:

```json
{
  "admins": ["alice", "bob"]
}
```

Each entry is a **platform username**, matched case-insensitively
(`"Alice"` and `"alice"` are the same person). Up to 20 entries; a
name matching no registered user is skipped with a warning rather
than failing the deploy, and starts granting automatically on a later
deploy if that person signs up.

An app admin is treated as a **second app creator for that one app**,
plus the power to force-merge that app's proposals:

- propose visibility / approval-settings changes;
- invite and remove collaborators;
- manage the invited-approver roster;
- retry a failed build;
- force-merge a proposal, and force-apply an environment-variable or
  close-issue proposal.

They get **nothing** on any other app and nothing platform-wide.
Deliberately excluded, and still full-platform-admin only: reading or
writing app secrets, deleting the app, forcing a redeploy, toggling
the app lock, and satisfying a locked app's required admin-yes vote.

Rules, mirroring `name` / `visibility`:

- On every production deploy the platform reads the block and
  reconciles the roster to it. An **absent block is a no-op** — a
  clean pass for apps that never declare it. A **present array is
  fully authoritative**, so `"admins": []` clears the roster (that
  asymmetry is deliberate: without it, revoking would be
  inexpressible).
- Each resolved admin is also seeded as a collaborator, so an admin of
  a build-private app can actually reach it. Removing someone from the
  list does NOT revoke their collaborator access — that stays a
  separate, explicit action.
- The **self-hosted platform app ignores the block entirely**; its
  admins are platform admins, full stop.
- **Forking an app does not carry its admins over** — a fork starts
  with an empty roster and the forker's own creator rights.

**Changing this list is just a PR that edits the block** — and because
it hands out privileges, such a PR gets a special merge rule:

- The app's **normal approval rules are unchanged**: same threshold,
  same electorate, same "at least N approvals" setting, same
  invited-approver roster, same contested handling.
- But the **time-based merge paths are switched off**. No merge
  countdown, and no "silence is consent" lazy auto-merge. Time passing
  alone never merges it; it merges the moment the app's normal
  threshold is met by votes people actually cast.
- **Rejection and expiry are unaffected** — the auto-takedown
  countdown behaves as it does for any other proposal on that app, and
  the stale-proposal sweep still closes one that nobody engages with.
- An app admin **cannot force-merge** such a proposal (that would be
  self-escalation); only a platform admin can.

Note the interaction with `governance.approvals`: an app configured
for "at least N approvals" is *already* clock-free, so this rule
changes nothing about how an admins PR merges there — an app on
`{ "atLeast": 1 }` effectively lets one person approve an admins
change. Pick that setting with the admins list in mind.

Reformatting the file, reordering the same names, or changing their
capitalisation is not a change and does not trigger the rule.

### Top-level `icon` — the app's homescreen icon

`dapp.json` may carry an optional top-level `icon` block — the
**source of truth for the app's homescreen tile icon**. Two forms:

```json
{ "icon": { "emoji": "🎮" } }
```

```json
{ "icon": { "image": "public/icon.png" } }
```

- `emoji` — a single emoji (trimmed, 1–16 UTF-16 code units, no
  whitespace). Rendered large on the tile's violet background.
- `image` — a **repo-relative path to an image file committed in the
  app's repo**. The platform reads the file at deploy time, validates
  it, and serves it so the image completely fills the rounded tile
  (cropped to fit). Constraints: ≤ 256 KB; PNG, JPEG, WebP, or GIF
  only (sniffed from the file's bytes — SVG is not accepted); the
  path must be relative, inside the repo, with no `..` segments.

Rules:

- On every production deploy the platform reads the block and
  reconciles the app's stored icon to it. Unlike `name`/`visibility`,
  the block is **fully authoritative: an absent block (or an invalid
  one) clears the icon**, restoring the default first-letter tile —
  so removing the declaration is how an icon is removed.
- If both `emoji` and `image` are declared, the image wins; the emoji
  is the fallback should the image file fail validation (missing,
  oversized, wrong format).
- **Changing the icon is just a PR that edits this block** (and, for
  an image, commits the file). The change takes effect when the PR is
  voted in, merged, and redeployed — not before. Don't mutate the
  icon through any other channel.

Per-field rules:

- `key` — `UPPER_SNAKE_CASE`. The literal name `process.env.<KEY>` will be.
- `description` — required for the UI. Be specific: name what the
  value is and where to obtain it.
- `required` — `true` if the app cannot run without it. Defaults to
  `false`. **Required-but-unset blocks deploys** — only mark a key
  required if that's truly the contract.
- `private` — `true` if the value must never be readable from any API
  *and* must not propagate from prod into staging. Stored AES-256-GCM
  at rest; the Secrets UI shows only "set" / "not set"; staging
  containers see only the manifest-committed `staging_default` /
  `default` fallback. Defaults to `false`. Mark API keys, signing
  keys, wallet seeds, OAuth client secrets, etc. as private; mark
  public addresses, URLs, feature flags as non-private. See "Public
  vs private secrets" below for the full decision tree.
- `sensitive` — **deprecated alias for `private`.** Existing
  `dapp.json` files using `sensitive: true` keep working unchanged —
  the platform reads either field and treats them as the same flag.
  New manifests should write `private: true` instead.
- `default` — applied at deploy time if no stored value exists (only
  meaningful when `required: false`). Use sparingly — it's documented
  as "the platform's default", not "this dapp's default". For
  platform-managed keys (see below) the manifest default is a
  fallback for *standalone* deploys; in-platform deploys use the
  platform's own env value instead.
- `staging_default` — manifest-committed value used in staging for
  `private: true` entries (see "Public vs private secrets"
  below). Wins over `default` in staging. If both are unset and the
  entry is `required + private`, the staging build fails with a
  clear error pointing at the remediation.

**Reserved keys** the platform owns and rejects from the manifest:
`DATABASE_URL`, `USERNODE_JWT_PUBLIC_KEY`, `USERNODE_APP_ID`,
`JWT_SECRET`, `PORT`, `USERNODE_ENV`,
`USERNODE_MISSING_SECRETS`. Don't list these. (`JWT_SECRET` is a retired
alias of `USERNODE_JWT_PUBLIC_KEY` — still injected so apps written
before the RSA cutover keep working, but nothing new should read it. It
stays reserved so a manifest can never shadow it.)

**Platform-managed keys** the platform supplies a default for at
deploy time (overriding the manifest `default` but losing to a
stored value):

| Key | Source | Why |
|---|---|---|
| `NODE_RPC_URL` | platform's own `process.env.NODE_RPC_URL` | Supplied for the active runtime: a cluster Service on Kubernetes or the configured Docker/local endpoint. Never hardcode a deployment-specific host in the manifest. |

Declaring these in `dapp.json` is **optional** — the platform injects
its value into every deploy (production and staging) whether or not
the manifest mentions the key, so code may read
`process.env.NODE_RPC_URL` without a manifest entry. You may still
declare them with a `default` — that becomes the fallback for
standalone (non-platform) deploys. Just know that inside the platform
the manifest default will be replaced with the platform's value
automatically, unless a user explicitly stored an override.

**When the Mayor / Claude Code adds a feature that needs a new env var**:

1. Add the entry to `dapp.json` (create the file if missing — the
   scaffold ships with `{ "secrets": [] }`).
2. In code, `process.env.MY_KEY` — if `required: true` you can rely
   on it being present (the deploy won't run otherwise).
3. **Never put real values in code or commit them**. The platform's
   Secrets UI is where users provide them, either directly (admins)
   or via a vote (non-admins).
4. Mention the new key in the dev-chat reply: "Added
   `STRIPE_SECRET_KEY` to the manifest — it's required, so set it in
   Settings → Secrets before this PR deploys."

When generating dapps from scratch, it's fine for the manifest to be
empty (`{ "secrets": [] }`) — only add entries when a feature actually
needs a value the platform should store.

**Users can also declare a secret without you.** The App secrets panel
has a "+ New secret" form that opens a proposal carrying BOTH the
`dapp.json` entry (key, description, `required`, `private`, `default`,
`staging_default`) and the value: a full admin's value is stored on
submit, everybody else's is held encrypted and written when the
proposal merges. So a key can exist as a pending declaration before it
is in the manifest on `main`. Two consequences for you:

- If a key you were about to add is already up for vote, say so and
  don't open a second entry for it — the platform refuses a duplicate
  declaration anyway.
- A declaration YOU author in a dev session still needs its value set
  separately (that's the panel's per-row "set" / "propose set"
  affordance) — only the panel's own form carries a value along with
  the declaration.

## Public vs private secrets — **IMPORTANT**

Staging containers receive the prod secret store by default for
*non-private* entries — same `NODE_RPC_URL`, same public client IDs,
same feature flags as prod — because most config values are
infrastructure URLs or public identifiers that need to match across
environments for staging to be a useful preview.

**`private: true` controls TWO things at once:**

1. **At rest:** the value is encrypted in `app_secrets` and is never
   returned by the platform API. The Settings UI shows only "set" /
   "not set" with no `valueLast4`.
2. **In staging:** the prod stored value is *not* propagated. Staging
   resolves the value from manifest-committed fallbacks only — see
   the resolution order below.

The two behaviors are unified because they share a threat model: a
value worth encrypting at rest is also a value worth keeping out of a
PR's staging container, where any debug endpoint, error message, or
SSRF in unreviewed code is a public exposure. (Sibling pattern to the
SQL `staging:private` table marker.)

> **Backward compatibility:** existing `dapp.json` files written with
> `sensitive: true` keep working unchanged — the platform parses
> `sensitive` as an alias for `private` and applies the same dual
> behavior. New manifests should write `private: true`.

Mark a secret private by setting `"private": true`, and commit
the staging fallback alongside it:

```json
{
  "secrets": [
    {
      "key": "STRIPE_SECRET_KEY",
      "description": "Live Stripe secret for charging cards",
      "required": true,
      "private": true,
      "staging_default": "sk_test_publishable_dummy"
    }
  ]
}
```

In staging, private entries are resolved from manifest-committed
values only (in priority order):

1. `staging_default` — explicit, committed-to-source signal that
   "this is the value safe to use in staging." Use this for sandbox
   API keys (Stripe `sk_test_...`, sandbox OAuth `client_id`, etc.)
   or for randomly-generated dummies the app's staging code can
   detect and short-circuit on.
2. `default` — same fallback used by `required: false` secrets in
   prod. Reasonable when the dev intends the same default everywhere
   (typical for opt-in features that no-op when unset).
3. If both are unset on a `required: true` entry, the staging build
   fails with a `PrivateSecretMissingStagingDefaultError` listing
   the key and the remediation. This is intentional: silently passing
   an empty string would let bugs propagate into PR reviews.

Prod is unaffected — the staging filter only fires when
`forStaging: true` is passed to the deploy merge, which only the
staging path does. Prod resolves stored value → platform default →
`default` as always.

### Decide by asking: "would the staging container running this code with the prod value cause a real-world side effect, or could it leak from a debug endpoint?"

Mark **private** when the secret unlocks:

- Live payment processing (Stripe live keys, PayPal client_secret,
  bank API tokens).
- OAuth client secrets that mint *prod* user tokens (Google, GitHub,
  Slack OAuth `client_secret`).
- Signing keys used for prod user sessions (`SESSION_SECRET`, your own
  app-issued cookie keys). Note the platform's own
  `USERNODE_JWT_PUBLIC_KEY` is a *public* key and not a secret at all —
  it is platform-managed either way.
- Wallet / on-chain secret keys that hold real funds.
- Database superuser passwords.
- Push-notification keys (FCM, APNS) that fan out to real devices.
- Email / SMS sending credentials (SendGrid API key, Twilio auth
  token).
- Any HSM / KMS unwrap key.

Leave **non-private** (the default) for:

- Public API keys and `client_id`s (anything ending in `_PUBLISHABLE_`
  or marked "safe in client-side code" by the vendor).
- Infrastructure URLs (`NODE_RPC_URL`, sidecar hostnames, queue URLs).
- Feature flags, log levels, locale defaults.
- Read-only scoped tokens whose blast radius is genuinely contained.
- Public identifiers (account IDs, project slugs).

### Rules

- **`required + private` MUST commit a `staging_default` (or
  `default`).** Otherwise the staging build will fail. This is the
  only acceptable failure mode — empty-string-by-default would let
  bugs propagate silently into PR reviews.
- **A non-private secret MUST NOT be derived from a private one
  in code.** If your app reads a private key and uses it
  to compute `BUILD_FINGERPRINT` (non-private) which it then
  exposes, the fingerprint is now a side-channel for the secret.
  Either mark the derived value private too, or use a
  one-way-but-distinguishable derivation that doesn't leak.
- **Vendor-provided sandbox / test-mode keys are NOT a special case.**
  Stripe's `sk_test_...` is still a credential the vendor expects you
  to handle as one — mark it private *and* set
  `staging_default: "sk_test_..."` (committing the test key directly).
  Don't use this to share the prod key with staging.

### When the Mayor / Claude Code adds a new secret to `dapp.json`

1. **Default to `private: false`** for genuinely-public values
   (URLs, IDs, feature flags). This is most secrets.
2. **Run the "would the staging container running this code with the
   prod value cause a real-world side effect, or leak from a debug
   endpoint?" test.**
3. If the answer is yes, set `"private": true` and add a
   `"staging_default"` (a vendor-provided test-mode key or a dummy
   the app's staging code can short-circuit on).
4. Mention the choice briefly in the dev-chat reply: "Marked
   `STRIPE_SECRET_KEY` private (encrypted at rest, isolated from
   staging) — added `staging_default: 'sk_test_publishable_dummy'`
   so staging gets a no-op test key."

## Editing the PLATFORM itself — `platform_env`, not `secrets`

Everything above is about a **child app's** env: `secrets` entries are
injected into that app's container by the deploy that builds it.

**The self-hosted platform app is different, and this is the one place
where using the `secrets` block is silently wrong.** The platform reads
its env from `/opt/usernode/.env`, written by
`.github/workflows/deploy.yml` and topped up at deploy time from the
platform's own value store. It never reads `app_secrets` for itself. So
a tunable added to the platform's `secrets` block does *nothing* — the
value can be stored and the platform will never see it.

The platform's `dapp.json` therefore carries a **second** top-level
block, `platform_env`, which is the source of truth for the platform's
own environment variables:

```json
{
  "platform_env": [
    {
      "key": "SESSION_SWEEP_INTERVAL_MS",
      "group": "Sessions",
      "default": "60000",
      "description": "How often the session sweeper runs the autopause/eviction pass."
    }
  ]
}
```

Per-field: `key` / `description` / `required` / `private` / `default`
mean what they do for `secrets`, plus `group` — a short heading the
panel groups rows under (`Scaling`, `Sessions`, `TLS`, …). There is no
`staging_default`: nothing here is ever injected into a container.

**When a change to the platform starts reading a new
`process.env.SOMETHING`:**

1. **Declare it in `platform_env`** in the SAME commit. A `required: true`
   declaration with no value set **blocks the merge** — the pre-merge
   check diffs the block against the merge base and names the missing
   keys — so declaring it is what makes the value get set before the
   deploy that needs it, instead of after the crash-loop.
2. **Prefer `required: false` with a `default`** that matches the
   committed default in `deploy.yml`. Most tunables have a sane default
   and shouldn't be able to block a merge.
3. **Never declare a credential as writable.** Keys the deploy owns
   (`JWT_SECRET`, `DATABASE_URL`, `ADMIN_PASSWORD`, the GitHub App
   credentials, `USERNODE_DOMAIN`, …) come from GitHub secrets. You may
   declare one for documentation — the platform derives `unwritable`
   from its own reserved list and renders it read-only — but it can
   never be written from the UI, by an admin or by a vote.
4. **Say in the dev-chat reply that the value must be set before merge**,
   and where: the platform app's **Platform variables** panel (the "+"
   menu on its dev tab — the same panel other apps call "App secrets").
   A full admin can set it directly; anyone else can propose it by vote
   (`kind='secret_change'`, exactly like an app secret). Either way it
   takes effect on the platform's **next deploy**, not immediately.

Both blocks may appear in the platform's `dapp.json` at once: `secrets`
documents the GitHub-injected credentials, `platform_env` holds the
tunables. Only `platform_env` entries are settable.

The panel can also declare a tunable on its own: its "+ New variable"
form opens a proposal that appends the `platform_env` entry AND carries
the value (held encrypted until the merge, or stored immediately when a
full admin submits it). A value that rides along that way satisfies the
pre-merge check, so such a proposal doesn't block itself. Point people
at it rather than asking them to add a GitHub repo variable by hand.

The same panel additionally lists the platform repo's **GitHub Actions
secrets** read-only for admins — names, "Set", and when each last
changed. GitHub's API never returns a secret's value to anyone, so that
is presence and freshness only; it exists to answer "is that credential
actually set?" without leaving the app. Changing one still means the
repo's Settings → Secrets and variables → Actions (plus, usually, a
`deploy.yml` edit), which is out of the panel's scope by design.

## App LLM access — the platform Claude proxy

Apps that want AI features call Claude **through the platform's
LLM proxy**, billed to the signed-in user's existing daily AI budget
under an explicit per-app, per-user permission grant. **Never ask
users for Anthropic API keys, and never store an API key as an app
secret** — the proxy exists precisely so apps don't handle keys.

Production containers receive two extra env vars (platform-injected;
both are reserved manifest keys you must not declare):

- `USERNODE_LLM_PROXY_URL` — base URL of the proxy
  (`http://usernode:3000/api/app-llm` in-network).
- `USERNODE_LLM_PROXY_TOKEN` — this app's opaque credential.

**Staging containers receive NEITHER** (unreviewed PR code must not be
able to spend users' budgets), and standalone deploys have no platform
to call. Always detect absence and degrade gracefully:

```js
const LLM_ENABLED = !!process.env.USERNODE_LLM_PROXY_TOKEN;
// When false: hide/disable AI features in the UI, or return a clear
// "AI features are unavailable in this environment" from the API.
```

### Calling the proxy (server-side)

The app's **server** calls the proxy, forwarding the user's iframe
token (the same `x-usernode-token` value the frontend already sends —
see "Auth"). Two endpoints are available, both POST, mirroring the
Anthropic Messages API:

- `POST ${USERNODE_LLM_PROXY_URL}/v1/messages`
- `POST ${USERNODE_LLM_PROXY_URL}/v1/messages/count_tokens`

```js
const resp = await fetch(`${process.env.USERNODE_LLM_PROXY_URL}/v1/messages`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-usernode-app-token': process.env.USERNODE_LLM_PROXY_TOKEN,
    'x-usernode-user-token': req.headers['x-usernode-token'],
  },
  body: JSON.stringify({ model, max_tokens, messages }),
});
```

The body/response are standard Anthropic Messages API shapes
(streaming SSE included). Error codes the app must handle:

- `403 { code: 'grant_required' }` — the user hasn't granted this app
  access (or revoked it). Surface this to the frontend, have it call
  `usernode.requestLlmAccess()` (below), then retry.
- `429 { code: 'app_cap_exceeded' }` — the user's per-app daily cap is
  spent. Show "daily AI cap for this app reached — resets at midnight
  UTC"; do not retry until tomorrow.
- `429 { code: 'budget_exceeded' }` — the user's overall daily budget
  is exhausted.

Every response after successful auth (successful calls, upstream
errors, and the two 429s above) also carries a spend meter as
response headers — **read these instead of keeping your own
token-price table**:

- `x-usernode-llm-spent-cents` — the user's cumulative spend through
  this app today, in cents, as of the **start** of the call (the
  call's own cost settles after the response ends). May be fractional
  (e.g. `4.7914`) and can lag a few seconds; treat it as an
  approximately-real-time meter, not a settlement record. Resets at
  midnight UTC, same as the cap.
- `x-usernode-llm-cap-cents` — the grant's daily cap for this app
  (integer cents).

Together they let a server show "used $X of $Y today" with zero extra
requests, warn near the cap, or disable AI features gracefully before
hitting `app_cap_exceeded`.

### Requesting consent (frontend, via the bridge)

The hosted bridge (see "Bridge") provides:

- `usernode.requestLlmAccess()` — asks the **platform shell** to show
  its consent dialog (app name, your declared purpose, an editable
  daily cap). Resolves `{ granted, dailyCapCents, allowByok }` or
  `{ granted: false, declined: true }`. The dialog is platform-owned;
  an app cannot approve itself.
- `usernode.getLlmAccess()` — read-only grant state, same shape.
- `usernode.getLlmUsage()` — read-only usage meter for a frontend
  display: resolves `{ granted: true, spentCentsToday, dailyCapCents }`
  (today's spend through this app vs the user's cap — the same
  numbers the platform's Settings panel shows; `spentCentsToday` may
  be fractional cents) or `{ granted: false }` when the user hasn't
  granted access. Never opens the consent dialog.

All of these reject when there's no platform shell (standalone/dev) —
treat a rejection like `LLM_ENABLED === false` (for `getLlmUsage`,
"usage unavailable").

Recommended pattern: call the proxy; on `grant_required`, have the
frontend `await usernode.requestLlmAccess()` and retry once granted.

### Declaring consent metadata in `dapp.json`

An optional top-level `llm` block shapes the consent dialog:

```json
{
  "llm": {
    "purpose": "Summarizes long threads for you",
    "suggested_daily_cap_cents": 300
  }
}
```

- `purpose` — one short line (≤140 chars) shown in the dialog so the
  user knows why the app wants AI. Always declare it for AI features.
- `suggested_daily_cap_cents` — pre-fills the dialog's editable cap
  field instead of the $1.00 default. Suggest a **modest** value that
  matches the feature's real cost; the user sees and can change the
  number, and the platform clamps it to the user's own daily limit.
  Omit it unless the default is genuinely too small.

Users manage grants (cap, revocation, BYOK spillover) in the
platform's Settings → "App AI permissions"; revocation is immediate,
so treat `grant_required` as a state that can appear at any time, not
just on first use.

## App file storage — user-uploaded images

Apps that let users upload photos (avatars, "here's how mine turned
out" shots, attachment images) store them **platform-side** and
persist only the returned URL in their own database. **Never store
image bytes in your Postgres DB** (base64/bytea columns bloat the DB
and its staging clones) and never build your own disk storage — the
app container has no persistent volume.

Two ways in; both return the same shape. Persist `url` (to render)
and `id` (to delete later) in your own tables:

```json
{ "id": "<32-hex>", "url": "https://<platform>/app-files/<32-hex>",
  "filename": "dish.jpg", "contentType": "image/jpeg",
  "sizeBytes": 812345, "visibility": "public" }
```

Limits and rules (both paths):

- **Images only**: PNG, JPEG, GIF, WebP — sniffed from the bytes, and
  the file extension must match. Max **5 MB** per file. There is no
  server-side resizing: downscale large camera photos client-side
  (canvas) before uploading.
- **Quotas**: 2 GB per app, 200 MB per user per app (staging-preview
  uploads: 100 MB per app, auto-deleted after 7 days). Structured
  error codes on rejection: `file_too_large`, `invalid_image`,
  `app_quota_exceeded`, `user_quota_exceeded`,
  `staging_quota_exceeded`, `storage_unavailable`.
- **Visibility**: `public` (default) serves the file to anyone with
  the link — the unguessable id is the access control, right for
  content the app shows to all its users. `private` additionally
  requires a platform user token at view time: render those as
  `<img src="${url}?token=${theIframeToken}">`.
- **Files are immutable** — there is no overwrite; upload a new file
  and update your stored URL. Deleting makes the URL 404 for fresh
  fetches immediately.

### Frontend path (via the bridge) — zero server code

```js
// From an <input type="file"> change handler:
const file = input.files[0];
try {
  const stored = await usernode.uploadFile(file, { visibility: 'public' });
  // Persist stored.url + stored.id via your own API, then render it.
} catch (err) {
  // Quota/validation errors, or no platform shell (standalone/dev).
}
```

- `usernode.uploadFile(file, { visibility })` — uploads a `File`/`Blob`
  as the signed-in user, resolves the stored-file shape above.
- `usernode.deleteFile(id)` — deletes one of the **current user's
  own** uploads (use it for "remove my photo" flows).
- `usernode.getStorageUsage()` — resolves `{ appBytes, appCapBytes,
  userBytes, userCapBytes }` for a quota meter.

All three reject when there's no platform shell (standalone/dev) —
treat a rejection as "uploads unavailable here", same stance as
`usernode.requestLlmAccess()`. This path **works in staging
previews** (uploads are marked as staging test data and cleaned up
automatically), so testers can exercise the full flow.

### Server path (takedowns and server-mediated flows)

Production containers receive two extra env vars (platform-injected;
both — and the whole `USERNODE_STORAGE_*` family — are reserved
manifest keys you must not declare):

- `USERNODE_STORAGE_URL` — base URL of the storage API
  (`http://usernode:3000/api/app-storage` in-network).
- `USERNODE_STORAGE_TOKEN` — this app's opaque credential.

**Staging containers receive NEITHER** (unreviewed PR code must not
write durable production storage) — detect absence and degrade, or
prefer the bridge path which staging supports:

```js
const STORAGE_ENABLED = !!process.env.USERNODE_STORAGE_TOKEN;
```

Endpoints (auth headers exactly like the LLM proxy — the app token
plus the user's forwarded iframe token):

```js
// Upload: raw bytes, filename/visibility as query params (NOT multipart)
await fetch(`${process.env.USERNODE_STORAGE_URL}/files?filename=${encodeURIComponent(name)}&visibility=public`, {
  method: 'POST',
  headers: {
    'content-type': 'application/octet-stream',
    'x-usernode-app-token': process.env.USERNODE_STORAGE_TOKEN,
    'x-usernode-user-token': req.headers['x-usernode-token'],
  },
  body: imageBuffer,
});
// DELETE `${USERNODE_STORAGE_URL}/files/<id>`  — removes ANY of this
//   app's files (the takedown/moderation path), same two headers.
// GET `${USERNODE_STORAGE_URL}/usage`          — quota meter, same headers.
```

### Staging notes

- Platform-stored files are **not** cloned into staging: the
  `app_files` registry is staging-private and your app's own DB copy
  only carries whatever URLs prod rows hold. If a staging testing
  step needs an image to render, seed your staging rows with a small
  data-URI placeholder image (per "Staging mock data") rather than a
  real `/app-files/` URL.
- Uploads made in a staging preview via the bridge are quarantined
  (smaller quota, deleted after 7 days) — fine for testing, never for
  durable content.

## App-facing platform API — use the pinned v1 base

Server-side app features that read Homeroom data use the private,
read-only app-platform API. Never hard-code a public platform hostname:
domains can move, and a redirect can turn an expected JSON response into
HTML. The platform injects both of these reserved locators in production
and staging containers:

- `USERNODE_PLATFORM_API_V1_URL` — the preferred, version-pinned base
  (`http://usernode:3000/api/app-platform/v1` in-network).
- `USERNODE_PLATFORM_API_URL` — the original unversioned base, retained
  as a v1 compatibility alias for existing app source and deployments.

Use one fallback while older deployments age out:

```js
const PLATFORM_API_BASE = process.env.USERNODE_PLATFORM_API_V1_URL
  || process.env.USERNODE_PLATFORM_API_URL;
```

Both names and the whole `USERNODE_PLATFORM_API_*` family are reserved
manifest keys: do not declare them in `dapp.json`. Production also gets
`USERNODE_LLM_PROXY_TOKEN`, the opaque app credential used by token-gated
routes. Staging gets the URL locators but deliberately no app token;
unreviewed code must use the endpoint's documented user-token fallback or
an obvious staging fixture.

### Compatibility guarantee

Within v1, existing route paths, response field names, field types, and
field meanings stay compatible. The platform may add endpoints or response
fields, tighten a security check, correct a bug, or change a rate limit;
clients must ignore fields they do not recognise. A planned breaking shape
requires a new `/v2` path and `USERNODE_PLATFORM_API_V2_URL` — v1 is never
silently repointed. The unversioned paths and
`USERNODE_PLATFORM_API_URL` remain aliases of v1 for legacy apps.

## App directory — apps and contributors

`GET /apps` on `PLATFORM_API_BASE` returns the public Homeroom app
directory for server-side pickers, rankings, and cross-app discovery. It
uses `x-usernode-app-token`; no user token or LLM consent grant is needed
because every returned field is already public:

```js
const DIRECTORY_ENABLED = !!PLATFORM_API_BASE
  && !!process.env.USERNODE_LLM_PROXY_TOKEN;

const resp = await fetch(`${PLATFORM_API_BASE}/apps?include_wallets=0`, {
  headers: {
    'x-usernode-app-token': process.env.USERNODE_LLM_PROXY_TOKEN,
  },
});
if (!resp.ok) throw new Error(`app directory returned ${resp.status}`);
const { apps } = await resp.json();
```

Each app carries `id`, `name`, `slug`, deployment/visibility timestamps,
`icon_emoji`, `icon_url`, `active_users`, `requires_login`, its canonical
`url`, and `contributors`. A contributor is
`{ user_id, username, wallet_address }`; `?include_wallets=0` omits the
wallet field. Only view-public, non-platform apps with a usable deployment
appear. Use the returned `url`, never rebuild a hostname from `slug`.
`icon_url` is relative to `USERNODE_PLATFORM_ORIGIN` when present.

Cache the response for 30–60 seconds; the route allows 60 requests/minute
per app. In staging, `DIRECTORY_ENABLED` is false because there is no app
token. Serve a short, obviously fake directory fixture so the screen stays
reviewable without giving unreviewed code platform-wide access.

## App governance feed — the app's own proposal/vote/merge activity

The platform tracks every proposal, vote, and merge for every app.
A read-only API exposes the **calling app's own** feed so apps can
render live governance surfaces — a "what's changing" strip, a
changelog screen — instead of hand-maintaining a shadow table of the
same data.

Auth reuses `USERNODE_LLM_PROXY_TOKEN` (see "App LLM access"). Always
detect the missing staging/standalone credential and degrade gracefully:

```js
const FEED_ENABLED = !!PLATFORM_API_BASE
  && !!process.env.USERNODE_LLM_PROXY_TOKEN;
// When false: hide the strip, or serve your staging mock feed (below).
```

### Calling the feed (server-side)

The app's **server** calls the endpoint — never the frontend: the
token must stay server-side. Proxy the result to your frontend
through your own API, and cache it for ~30–60 seconds (the data
changes on human voting timescales; don't hammer the platform per
page view). No user token is needed — the feed contains only what any
viewer of the app can already see in the platform's vote panel, and
it is scoped by the token itself: an app can only ever read its own
feed.

```js
const resp = await fetch(
  `${PLATFORM_API_BASE}/governance/feed?limit=10`,
  { headers: { 'x-usernode-app-token': process.env.USERNODE_LLM_PROXY_TOKEN } }
);
const { items, has_more, next_cursor } = await resp.json();
```

Response shape:

```json
{
  "items": [
    {
      "id": 812,
      "pr_number": 41,
      "title": "Custom tier colors",
      "summary_md": "Adds a color picker so each tier row can have its own color.",
      "status": "voting",
      "votes_for": 3,
      "votes_against": 1,
      "votes_required": 4,
      "contested": false,
      "eta": "2026-07-24T06:10:00.000Z",
      "author": "evan",
      "proposed_at": "2026-07-21T18:02:11.000Z",
      "merged_at": null
    }
  ],
  "has_more": true,
  "next_cursor": { "before": "2026-07-21T18:02:11.000Z", "before_id": 812 }
}
```

Field semantics:

- `status` — one of `proposed` (up for vote, no votes cast yet),
  `voting` (votes coming in), `merging` (won the vote, in the merge
  pipeline — lands within ~a minute), `merged` (shipped; `merged_at`
  has the time). Withdrawn/rejected proposals simply drop out of the
  feed. Private in-progress dev sessions never appear.
- `eta` — ISO timestamp of the **earliest possible auto-merge time**
  while a merge countdown is running ("merging in 9h"), or `null`
  when no countdown applies. It is not a guarantee — more votes can
  merge sooner, opposition can cancel it.
- `title` / `summary_md` — plain-language proposal title and summary,
  written for end users; render these directly.
- `votes_for` / `votes_against` — the raw tallies the platform's vote
  pill shows. `votes_required` is the current threshold (or the
  at-merge snapshot on merged rows; may be `null` on old merges).

Query params: `limit` (default 20, max 50), `status=open|merged|all`
(default `all`), and keyset pagination via
`before=<ISO>&before_id=<id>` — pass the previous response's
`next_cursor` values to page older. Requests are rate-limited to
60/min per app; cache instead of retrying on a
`429 { code: 'rate_limited' }`.

### Staging: seed a mock feed

Staging previews cannot call the feed (no token), so a governance
strip would render empty in every PR review. Per "Staging mock data",
have your staging/dev fallback serve a small static mock feed — a
handful of obviously-fake items covering all four statuses, one with
a near-future `eta` — behind the `FEED_ENABLED === false` branch, so
the strip is reviewable in previews and testers see the real layout.

## User directory — does this handle exist?

Apps constantly need to answer "is `@someone` a real Homeroom user?" —
an invite field, an @-mention, a hand-off to a teammate. Don't
approximate a directory from the users your app has happened to see:
the platform exposes the real one.

Two endpoints, both read-only:

- `GET /users/lookup?username=<handle>` — exact-handle existence check.
- `GET /users/search?q=<prefix>&limit=<n>` — case-insensitive **prefix**
  typeahead (`ali` finds `alice`, not `natalie`). `limit` defaults to
  10, clamps to 1–25.

Both return **only** `{ id, username }` per user. That is the entire
contract, deliberately: a handle's existence is already public (every
username is a route key at `/u/<username>`), but nothing else about a
person is. There is no email, no display name, no avatar, no locale, no
"which apps are they in" — don't build a feature that needs them from
here.

### From your server (production AND staging previews)

`USERNODE_PLATFORM_API_V1_URL` and its legacy fallback are injected into
**both** production and staging containers (unlike every platform
credential), so one server-side code path covers both environments. The
header rule:

- **Production** — send `x-usernode-app-token`
  (`USERNODE_LLM_PROXY_TOKEN`) **and** `x-usernode-user-token` (the
  caller's forwarded iframe token), because these read platform-wide
  data rather than your own app's row.
- **Staging previews** — the app token env var is absent (unreviewed PR
  code never holds a credential); send **only**
  `x-usernode-user-token`. The platform authenticates the lookup from
  the token itself — it was minted for this exact app and this exact
  signed-in reviewer.

One code path, one conditional header:

```js
const headers = { 'x-usernode-user-token': userTokenFromThisRequest };
if (process.env.USERNODE_LLM_PROXY_TOKEN) {
  headers['x-usernode-app-token'] = process.env.USERNODE_LLM_PROXY_TOKEN;
}
const resp = await fetch(
  `${PLATFORM_API_BASE}/users/lookup` +
  `?username=${encodeURIComponent(handle)}`,
  { headers }
);
const { found, user, ambiguous } = await resp.json();
```

This user-token-only fallback exists **only** on the two `/users/*`
endpoints. The governance feed still requires the app token, so its
`FEED_ENABLED` check above (which ANDs `PLATFORM_API_BASE` **and**
`USERNODE_LLM_PROXY_TOKEN`) remains correct and required — a
URL-only check would try the feed in previews and get a 401.

Responses:

```json
{ "found": true,  "user": { "id": 42, "username": "alice" } }
{ "found": false, "user": null }
{ "users": [{ "id": 42, "username": "alice" }], "has_more": false }
```

`user.username` is the **canonical stored casing** — persist that, not
what the user typed.

`ambiguous: true` appears on a lookup when two accounts differ only by
case (`Nova` / `nova` — real, and possible because usernames are
case-sensitively unique) and neither matched your input exactly. You get
the lower-id one; if it matters who, show both spellings and ask.

Rate limit: 120/min per (app, user), shared across both endpoints —
plenty for a typeahead. Debounce keystrokes ~200ms and cache a resolved
handle for the session rather than re-asking. On
`429 { code: 'rate_limited' }`, back off; don't retry in a loop.

### From your frontend (works in staging too)

The hosted bridge relays both calls through the platform shell using the
signed-in user's own session, so **no token is involved**. It works in
**staging previews** too, and stays the right default for a typeahead —
no server hop per keystroke:

```js
const { found, user } = await usernode.lookupUser('alice');
const { users, has_more } = await usernode.searchUsers('ali', { limit: 10 });
```

Both **reject** when the app isn't running inside the platform shell
(standalone, local dev). That's on purpose — an existence check that
quietly answered "nobody" would be worse than one that says it couldn't
ask. Catch it and **degrade open**: accept the handle the user typed and
carry on. Never block a user's action on a lookup you couldn't perform.

```js
let known = true; // assume valid unless the platform says otherwise
try {
  known = (await usernode.lookupUser(handle)).found;
} catch { /* no shell — accept it */ }
```

## Don't `git push` yourself

The worker container runs with **zero GitHub credentials in env** —
no PAT, no credential helper, nothing. Any direct `git push` you try
will fail with an HTTPS auth error. Same for any direct GitHub REST
API calls: there's no token to authenticate them with.

What to do instead: just commit (`git add -A && git commit -m "…"`)
and stop. The harness handles the push for you by calling back into
the platform's internal API (`/api/internal/sessions/:id/push`),
which validates your session and runs the push from the platform
side with the canonical branch name pulled from the DB. You don't
choose what gets pushed — your session's branch does, every time.

If you're tempted to write a workaround that talks to GitHub
directly, stop. There's no path that works: the worker has no
credentials, and the only outbound calls back to the platform are
the push/PR proxy endpoints (which only accept the session's
canonical branch). Commit cleanly and let the harness finish the job.

## Outside dev-chat: check that your checkout is current

For a coding agent working on an app from its own checkout: Claude Code on
someone's machine or on the web, Codex, and the like. Inside Homeroom's
dev-chat the platform fixes your base commit; skip this section.

The checkout you were handed may be a fork whose `main` is behind the app's
canonical repository, and nothing in it says so: `git fetch origin` compares
the fork with itself. So before you read code to answer a question about how
the app behaves now, not only before you edit, check against the canonical
repository. Homeroom names it in `.claude/homeroom-canonical-repo` in the
repos it creates, imports and forks; otherwise it is the app's `repoUrl` from
the connector's `list_apps`, and the connector's `get_checkout_status`
answers the whole question for you.

```sh
git fetch <canonical repository URL> main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means the checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead: `git show FETCH_HEAD:<path>` or
`git grep <pattern> FETCH_HEAD`. To change code, start from the exact base
commit your work order (`prepare_work`) gives, and never merge or rebase onto
the canonical `main` yourself: which commit a change is diffed against
decides what the group votes on.

Scaffolded repos run this check when a Claude Code session starts
(`.claude/hooks/homeroom-freshness.sh`) and tell you when you are behind. It
is silent offline, so its silence is not proof the checkout is current.

## Bridge — centrally hosted (not vendored)

`usernode-bridge.js` is the one piece of cross-dapp infrastructure
that is **not vendored**. It is served as a single canonical copy
from the Homeroom platform itself, at this path on every app's own
address:

```
/usernode-bridge/v1/bridge.js
```

Canonical source: `social-vibecoding/public/usernode-bridge/v1/bridge.js`.

Every dapp's HTML shell loads it by that relative path, with no hostname:

```html
<script src="/usernode-bridge/v1/bridge.js"></script>
```

Rules:

- **Never vendor `usernode-bridge.js` per app.** Bridge fixes ship
  from a single SV redeploy and propagate fleet-wide on the next page
  load. SV serves the file with `Cache-Control: no-cache,
  must-revalidate`, so browsers revalidate every load (304s when
  unchanged).
- **Versioning policy.** `/v1/` is the current major. Backward-
  incompatible bridge API changes bump to `/v2/` at a new URL; dapps
  migrate rollingly, and `/v1/` stays live until the last consumer
  has moved off. Within a major, fixes and additive features ship in
  place. When in doubt, prefer "additive within v1" over a v2 bump —
  the version sprawl is the cost, the URL change is the win.
- **Rollback.** Revert the offending commit in `social-vibecoding/`,
  redeploy SV. All dapps recover on the next page load — no per-dapp
  redeploy needed. This is the single biggest payoff of centralization
  vs. the old vendored-fan-out model.
- **Local-dev tradeoff.** `npm run dev` for any dapp now requires SV
  reachable for bridge-touching paths. App-logic iteration still
  works offline; only paths that actually exercise the bridge
  (`getNodeAddress`, `sendTransaction`, etc.) depend on SV being up.
- **Always the RELATIVE path — never write a hostname.** These three
  prefixes are served from the app's own hostname, so
  `/usernode-bridge/v1/bridge.js` reaches the file with no hostname in
  the app at all. That is what makes a platform domain move survivable:
  apps that hard-coded the platform's host (the old one, and later
  `{{PLATFORM_ORIGIN}}` itself) lost the bridge, the kit and their
  styling all at once when that host stopped serving them. An absolute
  URL on the current domain works today; a relative one cannot go stale. Every runtime serves them: a per-app Ingress rule on Kubernetes,
  the wildcard site's matcher on the docker runtime, and the scaffolded
  app's own handler under a plain `node server.js`, where there is no edge
  in front of the app. See [SELF-HOSTING.md](../../SELF-HOSTING.md).

## Offline — apps that open with no connection

The shell opens an app while the device is offline **only when that app's
own service worker was serving its document on a previous online visit.**
Everything else gets a placeholder — "This app needs a connection —
reconnect to open it." — because the app lives on its own subdomain, which
the platform's service worker cannot cache. That placeholder is the
correct, expected outcome for an app with no worker of its own; it is not
a platform bug.

Nothing here is self-declared. The bridge reads
`navigator.serviceWorker.controller` inside the app frame — the browser's
own statement that a worker served this document — and announces it to the
shell, which remembers it per app and reads it back on the next offline
load. An app cannot claim the capability, and one that loses its worker
stops being opened offline on its next load.

To earn it:

- **Load the bridge.** Without the tag the app has no channel to announce
  on, and the shell will never open it offline no matter what else it
  does. See the section above.
- **Register a service worker that precaches your shell**, and let it take
  control (`skipWaiting()` + `clients.claim()`), so the first visit
  announces rather than waiting for a second one. Registration can fail
  outright in a third-party iframe — some WebViews refuse storage to a
  cross-origin frame — and that is a normal degradation, not something to
  work around: no worker means no announcement means the placeholder.
- **Never serve `/api/*` from the worker.** Writes and event streams must
  always reach the network; keep the app's own read cache separate.

Two consequences worth designing for:

- **An offline load carries NO `?token=`.** The shell cannot mint one with
  no network, so the iframe src has no token at all. Recover identity from
  the app's own storage, remembered from a load that did have one — and
  never destroy per-user data when the token is absent. An app that keys
  its cache on "the current user" and falls back to an anonymous namespace
  will delete the real user's saved data on the first offline boot.
- **The frame reloads when the connection returns.** The shell mints a
  token and re-points the frame, so anything unsent must be persisted, not
  held in memory. Queue mutations durably and replay them on reconnect.

Be honest in the UI about which of the two worlds the app is in. A device
that refuses durable storage cannot promise "3 changes will sync", and
saying so is better than a queue that silently disappears.

## User language preference

The platform owns a single per-user language/locale setting. Apps that
localize their UI should treat it as the **default** instead of building
their own detection from `navigator.language` (which reflects the device,
not the user's Homeroom-level choice). It reaches apps two ways:

**Expect `null` for nearly every user (SV #1556).** The setting is still
stored and still delivered on both paths below, but the platform shell is
English-only, so its Settings picker is hidden pending platform i18n and is
offered only to the few users who had already chosen a language. So make
device-language fallback the PRIMARY path and the platform tag an override
when present. Do not build a feature that only works once the user sets a
platform locale, and do not tell users to go and set one.

- **JWT claim (server-side).** The iframe token carries a `locale`
  claim alongside `id` / `username` / `usernode_pubkey`, so after
  `jwt.verify` it's `req.user.locale` on every request — a BCP-47 tag
  (`"id"`, `"pt-BR"`, …) or `null` when the user hasn't set one. Use
  it for server-rendered strings and LLM prompt directives ("answer in
  Bahasa Indonesia") with no client round-trip.
- **Bridge API (frontend).** `usernode.getUserLocale()` resolves
  `{ locale: "id" }` or `{ locale: null }`. It never rejects — inside
  the platform shell it asks the shell directly; standalone it falls
  back to the iframe JWT's claim, then `null`. When the user changes
  the setting mid-session, the bridge dispatches a
  `usernode:locale-changed` CustomEvent on `window` with
  `detail.locale` — listen for it if your app can re-render live.

Expected app behavior:

- **Platform value is the default; an app-level override is allowed
  and wins.** If your app has its own language picker, seed it from
  the platform locale on first visit (falling back to
  `navigator.language`, then your app default, when it's `null`) and
  persist the user's in-app choice as usual.
- **Map, don't match exactly.** Apps ship whatever locale set they
  ship; map the platform tag onto it (language-subtag prefix match —
  `"pt-BR"` → your `"pt"` — then your app default).
- `null` means "no preference set", NOT "English" — keep it
  distinguishable so device-language auto-detection still works.

## Safe-area insets inside the app frame

On a phone with a notch or a home indicator, the platform shell runs
edge to edge and so does your app's iframe — it reaches the true bottom
of the screen, past the rounded corners. **But `env(safe-area-inset-*)`
resolves to `0px` inside a cross-origin iframe in every browser**, so an
embedded app cannot see those insets on its own: any safe-area CSS it
writes is silently inert, and bottom-anchored chrome would sit under the
home indicator.

The platform therefore forwards the insets **that apply to your frame's
rectangle** (the shell's own header already covers the status bar, so
your top inset is normally `0` and becomes the real one only in the
chromeless full-screen view). The hosted bridge publishes them three
ways — no app-side plumbing, just the bridge `<script>`:

- **CSS custom properties on `<html>`** — `--un-safe-inset-top`,
  `--un-safe-inset-right`, `--un-safe-inset-bottom`,
  `--un-safe-inset-left`, in `px`. **This is the one to reach for.** Write
  every safe-area value as
  `var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px))`: the
  property wins inside the platform frame, and the `env()` fallback keeps
  it exact when the app is opened standalone (where the property is
  deliberately left unset). The usernode-native kit's own CSS already
  uses this form, so **kit bars, sheets, action sheets, modals, toasts
  and nav bars inset themselves correctly with no change to your app.**
- **`usernode.safeAreaInsets`** — `{ top, right, bottom, left }` in px
  (all zeros until the first value arrives), for layout you compute in
  JS rather than CSS.
- **`usernode:safe-area-changed`** — a `CustomEvent` on `window` whose
  `detail` is that same object. The shell pushes a new value on rotation,
  on keyboard/toolbar moves, and whenever your frame's rect shifts;
  listen if your app re-measures in JS.

Notes:

- These are the **safe area only**. On-screen keyboard clearance is a
  separate concern your app already sees correctly through
  `visualViewport` (and the kit's `--un-kb-inset` / `attachKeyboardAvoidance`).
- Values are `0` on desktop and on devices with no notch — every branch
  collapses to today's behaviour, so the `var(..., env(...))` form is
  safe to adopt unconditionally.
- Your app's own viewport meta does **not** need `viewport-fit=cover` for
  the forwarded properties to work (it is still required for bare `env()`
  to work standalone).

## Staying loaded in the background

The shell keeps the last few apps a viewer opened **loaded but hidden**, so
coming back to yours shows it exactly as they left it — no reload. While
hidden your document keeps running, but it cannot be seen, focused or
clicked. The bridge handles the common case for you: on hide it pauses any
playing `<audio>`/`<video>`, and on show it resumes what it paused. For
anything else that should stop while nobody is looking (Web Audio, timers
that animate, polling), listen for:

- **`usernode:visibility-changed`** — a `CustomEvent` on `window` whose
  `detail` is `{ hidden: boolean }`.

An app that is not reopened soon is dropped and loads fresh next time, so
keep durable state server-side (or in `localStorage`) as you already should.

## Browser capabilities in the app frame

Apps run in a cross-origin iframe, and the powerful browser capabilities
are gated by **Permissions Policy**, which is delegated **downward** by the
embedding page. An app cannot grant itself one: the grant is the shell's to
make, through the `allow` attribute on the frame.

Two capabilities are delegated to every app frame, with nothing to ask for:

| Capability | Use it through |
|---|---|
| `clipboard-write` | `navigator.clipboard.writeText()` |
| `pointer-lock` | `element.requestPointerLock()` |

**Everything else worth having is GATED** (#2219). Nine capabilities are
delegated to your app only when the person using it has granted that
capability **to your app**, after the platform asked them in its own dialog:

| Capability | Use it through |
|---|---|
| `geolocation` | `navigator.geolocation.getCurrentPosition()` |
| `microphone` | `navigator.mediaDevices.getUserMedia({ audio: true })` |
| `camera` | `navigator.mediaDevices.getUserMedia({ video: true })` |
| `display-capture` | `navigator.mediaDevices.getDisplayMedia()` |
| `usb` | `navigator.usb.requestDevice()` |
| `serial` | `navigator.serial.requestPort()` |
| `hid` | `navigator.hid.requestDevice()` |
| `bluetooth` | `navigator.bluetooth.requestDevice()` |
| `midi` | `navigator.requestMIDIAccess()` |

`geolocation` used to be in the first table, delegated to every app
unconditionally. It moved because of how browsers attribute a nested
frame's request: under permission delegation the prompt names the
**top-level** origin, so it said "my.onhomeroom.com wants to know your
location" and never named the app, and the answer was then remembered for
the platform origin, so every other app inherited it silently. The
platform's own prompt is the one that can name the app that is asking.

### Declare, then ask

**Declare in `dapp.json` what your app may ask for.** An undeclared
capability is refused before any dialog is shown, so the set of things your
app can ever reach is visible in your own diff, where the group reviewing a
proposal can see it:

```json
"permissions": [
  { "capability": "microphone", "reason": "Records your voice notes" },
  "geolocation"
]
```

The object form and the bare string mean the same thing. `reason` is one
short line shown in the prompt, the same way `llm.purpose` is.

**Ask when you need it, not at startup.** Call `requestPermission()` on the
tap that needs the capability, then use the ordinary web API:

```js
recordBtn.onclick = async () => {
  const r = await usernode.requestPermission('microphone');
  if (r.state !== 'granted') return showWhyWeNeedIt(r.reason);
  if (!r.active) return;  // granted; the app is about to reopen (see below)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  startRecording(stream);
};
```

The answer is `{ capability, state, active, reason }`. `state` is
`"granted"` or `"denied"`; on a denial `reason` is `"declined"` (the person
said no), `"not_declared"` (missing from your `dapp.json`) or
`"unknown_capability"`.

`usernode.getPermission(name)` reads the same answer without ever
prompting, so you can render an "enable" button from it.
`usernode.getPermissions()` returns the whole picture for your app:
`{ declared, granted, active }`.

### `active` is the field to read twice

A frame's Permissions Policy is computed when it **navigates**, so a
capability granted just now cannot apply to the document that asked for it.
On that first grant the platform tells the person the app will reopen, and
reloads the frame. `active: false` therefore means "granted, and you are
about to be reloaded": stop, do not call the web API, and let the reload
land. Save anything you need to keep first.

Every later launch delegates it up front and `requestPermission()` resolves
`active: true` with no dialog and no reload at all.

For the same reason, a revoke in Settings takes effect the next time the
app opens rather than instantly. A running document's policy cannot be
narrowed.

### Where it does and does not apply

Gated capabilities are delegated on the **App tab** only. The landing
page's in-page viewer serves signed-out visitors, who hold no grants, and
the staging preview shows a build the group has not voted in yet. Both
still relay the prompt, so your app gets a truthful answer there rather
than silence, but neither can turn a capability on.

### Telling "blocked" from "never asked"

The failure mode is worth knowing because it is so easy to misread: an
undelegated capability is not refused with a distinct error and it does not
prompt. `getCurrentPosition` and friends reject in a couple of
milliseconds with `PERMISSION_DENIED`, the *same* code the browser uses
when a person taps "block". So an app that treats code 1 as "the user said
no" will tell people to check a permission they were never asked for.

`usernode.hasCapability(name)` answers synchronously for the CURRENT
document, and is the one call here that also works standalone:

```js
if (!usernode.hasCapability('geolocation')) {
  // Not delegated to this document. Either ask for it, or hide the control.
}
```

It reads the document's own Permissions Policy, and returns `true` where
the browser exposes no way to ask, so treat that as "try it and see" rather
than a guarantee.

If your app needs a capability that is on neither list, that is a missing
platform capability, not something to work around in the app: see
"Platform-level problems & missing capabilities" below.

## Native-feel UI kit — centrally hosted (`usernode-native`)

An **opt-in** CSS + JS kit that makes an app's mobile UI feel native on
iOS and Android: platform-adaptive switches, native pressed states,
swipe-to-act list rows, drag-to-reorder lists, pull-to-refresh (inner
containers or the whole page), bottom sheets, side drawers, centered
modals, action sheets, alert dialogs, toasts, blurred nav bars with
collapsing large titles, inset-grouped list styling, and animated
push/pop screen transitions — all in vanilla JS + CSS, no build step,
attaching to the app's existing DOM. It is **available and recommended for mobile-facing
UI**; adopting it is each app's choice (typically driven from dev chat),
not a requirement.

Like the bridge, it is centrally hosted — never vendor it:

```html
<link rel="stylesheet" href="/usernode-native/v1/native.css">
<script src="/usernode-native/v1/native.js"></script>
```

Canonical source: `social-vibecoding/public/usernode-native/v1/`. The
same rules as the bridge apply: fixes ship platform-side and propagate
on the next page load; `/v1/` is a frozen API surface (additive changes
in place, breaking changes bump to `/v2/`). A live demo of every
component is served beside the kit at `/usernode-native/v1/demo.html`
(`?un-platform=ios|android` forces a skin, `?un-tune=1` shows the
spring tuner).

### What the kit provides

Loading `native.js` sets `html.un-ios` / `html.un-android` /
`html.un-desktop` (platform skins hang off these) and exposes
`window.unNative`:

- **Touch polish (automatic).** `native.css` removes the grey tap
  highlight and gives every `button` / `[role="button"]` /
  `.un-pressable` an instant pressed state (scale + dim, engages with
  zero latency, springs back on release). `.un-touch-target` expands a
  small icon button's hit area to ≥44px without changing layout — it
  does **not** override the element's own positioning, so it is safe
  directly on an overlay control (a clear-search "✕" inside a field, a
  close button pinned to a card corner) that carries its own
  `absolute` / `fixed` / `sticky`; no wrapper element needed.
- **Switches.** Add class `un-switch` to an existing
  `<input type="checkbox">` — nothing else. iOS pill on iPhones,
  Material 3 track/thumb on Android, pure CSS.
- **Swipe-to-act rows.**
  `unNative.attachSwipeActions(rowEl, { actions: [{ label, destructive,
  handler, color? }] })`. Reveals action buttons on a left drag via a
  **ride-along tray** that translates in lockstep with the row — nothing
  is painted behind the row, so rounded rows, row margins, translucent
  backgrounds and inset-grouped cards all render cleanly. When the
  **last** action is `destructive: true`, a full swipe (or hard flick)
  commits it, with a haptic tick as the delete cue arms/disarms (where
  the device supports vibration). On a destructive commit the kit
  collapses and removes the row from the DOM, **then** calls
  `handler()` — do the API call / re-render there. Returns
  `{ close(), detach() }`.
- **Pull-to-refresh.**
  `unNative.attachPullToRefresh(scrollEl, onRefresh, opts?)` on a
  scrollable list container **or the window scroller** (pass `window`,
  `document`, or `document.scrollingElement` for pages that scroll as
  one document). In window mode the rubberband translate is applied to
  `opts.content` — default `document.body.firstElementChild` (the
  `#app`-style root); pass it explicitly if your `<body>` has several
  top-level children — and the spinner puck is fixed-positioned.
  `onRefresh()` returns a Promise; the spinner holds until it settles,
  then lingers ~500ms before retracting so a fast refresh still reads as
  one. **The puck never paints over the app's header**: it lives in an
  overflow-clipped layer stacked underneath the header, anchored by
  default at the scroller's own top edge (element mode) or the safe-area
  inset (window mode, which also tucks it under `.un-navbar`). During the
  pull it emerges from under that anchor line, and **at rest it sits
  entirely below it, with equal space above and below the puck** — the
  whole pose is derived from the puck's box, so no call site tunes it. For a
  custom **fixed** header in window mode, pass `opts.topEl` (the header
  element — re-measured on resize and at each pull, so a collapsing bar
  stays correct) or `opts.top` (a px offset); a header that lives
  *inside* the translated content rides down with the pull and needs no
  anchor. For element containers, give them
  `overscroll-behavior-y: contain` (the kit also sets it defensively).
  No-op on desktop. Never throws: invalid input logs a console warning
  and returns a no-op `{ detach() }`. The returned handle also carries
  `refresh()` — start a refresh with no gesture (the kit's
  `beginRefreshing()`), a no-op while one is already running.
- **Drag-to-reorder lists.**
  `unNative.attachReorder(listEl, { handle?, itemSelector?,
  longPressMs?, canDrop?, onReorder })`. Native-feel reordering: on
  touch a long-press (default 400ms) lifts the row, which then tracks
  the finger 1:1; on desktop, drag the `handle` (a CSS selector for a
  grabber inside each row — handles lift immediately on both inputs)
  or, with no handle, any vertical drag on the row. An accent-colored
  overlay bar marks the drop slot, the viewport/scroll-container
  auto-scrolls near its edges, and release springs the row into place —
  the kit then moves the element in the DOM and calls
  `onReorder(fromIndex, toIndex, itemEl)` (persist the order there).
  `itemSelector` defaults to `listEl`'s children minus
  `.un-group-header`; pass it explicitly for grouped/sectioned markup —
  indices span the whole matched list, so cross-section moves just
  work, and hovering a section header inserts at the top of that
  section. Composes with `attachSwipeActions` on the same rows (attach
  swipe actions first, then reorder on the container — the items are
  the `.un-swipe` wrappers) and with pull-to-refresh via the gesture
  arbiter. Returns `{ detach() }`; never throws on bad input.
- **Free-form grid placement (the homescreen model).**
  `unNative.attachGridPlacement(listEl, { cellFromPoint, itemSelector?,
  handle?, longPressMs?, canPlace?, onLift?, onHover?, rectForCell?,
  onPlace?, onSettle? })`. Reach for this instead of `attachReorder` when
  your grid
  is a CANVAS rather than a list — when a tile should be droppable in any
  cell, gaps included, and nothing should re-pack behind it. Same physics
  as reorder's grid mode (long-press lift on touch, drag past the slop on
  desktop, a fixed ghost tracking the finger on both axes, edge
  auto-scroll, haptics, spring settle, gesture arbiter), but the real item
  holds its cell as a dashed slot and siblings never move. **The kit owns
  the gesture; you own the geometry**: it never computes a cell, it calls
  your `cellFromPoint(x, y, info)` (returning `{ col, row }` or `null`), asks
  `canPlace(item, cell)` on each cell change, calls `onHover(item, cell,
  ok)` so you can paint the target highlight, and finally
  `onPlace(item, cell)` on a committed drop. **Resolve the target from the
  dragged TILE, not from the finger.** `x`/`y` are the pointer, and the ghost
  tracks it from wherever the tile was grabbed — so answering from `x`/`y`
  puts the tile's top-left corner under the finger and the highlight a
  grab-offset away from the tile the user is looking at (a whole tile's worth
  for a multi-cell item). The third argument carries the tile's live geometry
  — `{ item, rect: { left, top, width, height }, centerX, centerY, pointerX,
  pointerY }` — so take `centerX`/`centerY` and subtract half the item's own
  footprint: the **centroid** rule, which puts the highlight under the tile
  whichever corner it was picked up by. Note an even-width footprint centres
  exactly on a cell seam, so derive the column as a rounded fraction of the
  cell pitch rather than hit-testing the centre and subtracting `floor(w/2)`.
  `x`/`y` keep their meaning, so a host that ignores `info` behaves as
  before. **If your drop displaces
  occupants rather than refusing, preview that in `onHover`** — move the
  items that would be pushed to the cells they'd land in. A flow reorder
  shows that for free (everything shuffles as you drag); free placement
  only moves what actually collides, so without the preview an occupied
  target is a guess. Compute the plan once in `canPlace` and reuse it in
  `onHover`, or the highlight and the drop can disagree. **Give it
  `rectForCell(item, cell)` too** — return where a committed drop lands
  (`{ left, top }` in viewport coords; the target cell's own
  `getBoundingClientRect()` is the natural answer) and the release glide
  settles there. Omit it and the ghost settles on the dragged element's own
  rect, which in this mode is still the cell it was picked up from: the tile
  flies away from the finger, back to its origin, and only then pops into the
  drop cell. Answer from the same plan the highlight used, so the glide lands
  where the highlight promised even when the plan nudged the item to fit.
  Everything else — the ghost, the origin slot, the highlight, your
  `onPlace` re-render — is held until that glide finishes, so the whole
  release reads as one motion. `onLift` / `onSettle` carry
  the same deferral contract as `attachReorder` (hold a re-render flag in
  the first, flush it in the second — it fires on drops, cancels and
  detach alike). Rendering the grid as real cell elements while dragging
  makes `cellFromPoint` a one-line `elementFromPoint(...).closest(...)`
  and gives the user the drop target for free. Returns `{ detach() }`;
  never throws on bad input.
- **Bottom sheet.** `unNative.presentSheet({ content | contentEl,
  onDismiss })` — grabber, spring presentation, 1:1 drag-to-dismiss
  with momentum commit (a touch mid-spring inherits position and
  velocity), backdrop tap dismisses. Keyboard avoidance is built in
  (see below) — sheets with text fields ride above the on-screen
  keyboard automatically. Content may be rendered into the sheet
  AFTER presenting (fill from state or a fetch): the kit re-measures
  on content growth and retargets the entrance spring, backdrop
  dimming and dismissal travel, so late-rendered content still gets
  the full slide-up instead of popping in. Returns `{ dismiss(), el }`.
- **Centered modal.** `unNative.presentModal({ content | contentEl,
  onDismiss?, dismissible? })` — arbitrary content in a centered card
  over the same dimmed backdrop as the sheet/alert, with the alert's
  fade + scale-settle motion. Backdrop tap and Escape dismiss (unless
  `dismissible: false`); taps on the card never dismiss; nothing is
  clickable during the fade-out; tall content scrolls inside the card.
  The natural surface for forms, share panels and editor dialogs —
  especially on desktop/tablet where a bottom sheet reads as a phone
  idiom. Keyboard avoidance is built in (see below): with the
  on-screen keyboard up, the card re-centers in the visible strip
  above it and shrinks to fit. Returns `{ dismiss(), el }`.
- **Side panel / drawer.** `unNative.presentPanel({ side?, content |
  contentEl, width?, onDismiss? })` — a full-height surface that springs
  in from the **right** edge (`side: 'left'` for the other one) over the
  same dimmed backdrop, which dims in step with the slide. The
  navigation-drawer idiom (a hamburger menu, a filter rail): backdrop
  tap and Escape dismiss, and the drawer's own content supplies the
  close button / rows. **Deliberately not draggable, and no grabber
  pill** — swipe-to-dismiss and its affordance are the *bottom sheet's*
  idiom, for transient trays you flick away; platform nav drawers are
  opened by a control and closed by choosing something. Consequently
  scrolling inside the panel is plain native scrolling with nothing to
  contend with. Safe areas (status bar, home indicator, landscape
  notch) and the on-screen keyboard are handled: content gets keyboard
  clearance as padding rather than the box moving, since a full-height
  panel has nowhere to ride up to. Content is laid out **full-bleed**
  (no horizontal padding of the kit's own) — a `min-h-full` column flex
  with `mt-auto` on the last block bottom-anchors a footer with no
  measurement. `width` accepts any CSS length for this one instance;
  otherwise it is `--un-panel-width`. Returns `{ dismiss(), el }`.
  Prefer this to a bottom sheet for persistent navigation, and a bottom
  sheet for transient trays.
- **Action sheet.** `unNative.actionSheet({ title?, actions: [{ label,
  destructive?, handler? }], cancelLabel? })` — iOS-style stack with a
  red destructive action and a separate Cancel card; backdrop cancels.
  Resolves a Promise with the chosen action object, or `null`.
- **Alert dialog.** `unNative.alert({ title, message?, field?:
  { placeholder?, value? }, buttons?: [{ label, style?:
  'cancel'|'default'|'destructive', handler? }] })` — the compact
  270px centered iOS alert with optional inset text field. Resolves
  `{ button, value }` (always write it `unNative.alert(...)` — it does
  not replace `window.alert`). The field autofocuses, and keyboard
  avoidance is built in (see below): the alert re-centers above the
  on-screen keyboard.
- **Anchored popover / dropdown menu (the desktop idiom).**
  `unNative.popover({ anchorEl | anchorRect, items | contentEl,
  title?, headerEl?, placement?, onDismiss? })` — a menu attached to
  the control that invoked it: flip/clamp positioning that stays in
  the viewport, outside-click / Escape / scroll dismissal, anchor
  re-click toggles it closed, arrow-key focus roving, instant (no
  animation — menus are high-frequency UI). `items` share the action
  sheet's shape plus `disabled` (inert row), `keepOpen` (run the
  handler without dismissing — the handler receives the row's button
  for in-place feedback) and `title` (tooltip); items mode resolves a
  Promise with the chosen item or `null` (a `.dismiss()` is attached
  for programmatic close), `contentEl` mode returns `{ dismiss(),
  el }`. `placement` defaults to `'bottom-start'` (also `bottom-end` /
  `top-start` / `top-end`). And the one to reach for by default:
  **`unNative.menu({ anchorEl | anchorRect, title?, items,
  cancelLabel? })`** presents the SAME items as a bottom action sheet
  on touch platforms and an anchored popover on desktop — one call
  site, both idioms, no `unNative.platform` branching. Always resolves
  the chosen item or `null`.
- **Menu-row icons.** Any row in `menu()` / `popover()` /
  `actionSheet()` takes an optional `icon: '<name>'` from the kit's own
  set — `home`, `globe`, `terminal`, `link`, `laptop`, `cloud`, `trash`
  — or `iconEl: <Element>` for artwork the kit doesn't ship (a node,
  not a string, and a fresh one per row: it is used, not cloned).
  Icons are stroked in `currentColor`, so a destructive row's icon goes
  red and a disabled row's dims with no work from you. **Give the whole
  menu icons or don't** — the kit aligns every label to a common left
  edge as soon as ONE row has an icon, spacing the icon-less rows out
  so they line up, but a menu where only one row in six drew a glyph
  reads as a mistake rather than a style. A row with no icon in a menu
  with no icons renders exactly the DOM it always did, so adding this
  changed nothing for existing callers. An unknown name draws nothing —
  it does not throw and does not fall back to some other icon, so check
  the list above rather than inventing a name. The set is deliberately
  small and grows additively in `/v1`; if your app needs one that isn't
  there, that's a platform request, not an `iconEl` workaround you keep
  forever.
- **Keyboard avoidance (automatic).** On mobile the kit tracks the
  on-screen keyboard via `visualViewport` and maintains
  `--un-kb-inset` (the keyboard's occlusion of the layout viewport,
  in px) plus class `un-kb` on `<html>` while it is non-zero. Sheets,
  action sheets, modals and alerts consume it automatically and ride
  above the keyboard — smoothly, without disturbing drag-to-dismiss.
  **Do not hand-roll `.un-sheet { bottom: … }` overrides or per-app
  visualViewport plumbing anymore** — delete them when adopting this;
  the kit owns the inset now. Apps may consume `var(--un-kb-inset,
  0px)` for their own fixed bottom bars. No-op on desktop or where
  `visualViewport` is absent.
- **Keyboard avoidance for fixed-shell content scrollers.**
  `unNative.attachKeyboardAvoidance(scrollEl, { topEl?, margin? = 8,
  fields? })` — the same keyboard physics for the APP's main content
  scroller. Built for the native-app **fixed-shell recipe**: `html,
  body { height: 100%; overflow: hidden }` plus one
  `position: fixed; inset: 0; overflow-y: auto` scroller, so the
  keyboard can never scroll or reflow the page frame — only content
  slides. The kit then owns everything subtle: keyboard clearance as
  content padding on the scroller (instant on open, eased on close —
  note it *replaces* the scroller's own bottom padding while the
  keyboard is up, the safe-area sits behind the keyboard anyway),
  single-motion focus reveals (taps on text-entry fields are
  intercepted so the browser's uncoordinatable native reveal never
  fires; the content slides ONCE, above the keyboard and below
  `topEl` — pass the same bar you give `attachNavBar`), instant
  reveals on field-to-field hops, a coalesced settled pin after the
  keyboard's viewport-event burst, and an iOS visual-viewport offset
  guard. Buttons, switches, selects, native pickers and the
  already-focused field keep fully native taps; fields inside kit
  sheets/modals/alerts keep the kit's built-in avoidance. `fields`
  optionally replaces the default text-entry allowlist with a CSS
  selector. Programmatic focuses in the app should use
  `el.focus({ preventScroll: true })` so the kit's reveal stays the
  single motion. Composes with `attachNavBar(scrollEl)` and
  element-mode `attachPullToRefresh`. **Fixed-shell apps must use
  this instead of hand-rolled visualViewport plumbing** — delete any
  app-side keyboard plumbing when adopting it. No-op on desktop or
  where `visualViewport` is absent; returns `{ detach() }`; never
  throws on bad input.
- **Toast / transient status.** `unNative.toast(message, { duration?,
  action?: { label, handler }, priority?, onClose? })` — fire-and-forget
  feedback ("Copied", "Saved", API errors): a bottom capsule HUD on
  iOS/desktop, a Material snackbar on Android, safe-area aware,
  auto-hiding (2.2s, 4s with an action). Singleton with
  last-writer-wins among ordinary toasts: a new call replaces a
  still-visible toast and resets its timer — no stacking. A
  `priority: true` toast is NOT displaced by ordinary toasts; those
  wait — at most one, latest wins — and show after it resolves (a newer
  priority toast still takes over). `onClose(reason)` fires exactly
  once per call — `'timeout'` | `'action'` (after the action handler) |
  `'dismiss'` | `'replaced'` — including for toasts replaced while
  still waiting. For undo flows, use a priority action toast with
  `onClose` and commit the pending operation on any reason except
  `'action'` — don't hand-roll an undo pill. It never steals taps from
  content underneath (`pointer-events` stay off except on the optional
  action button). Returns `{ dismiss(), el }`. Use it instead of
  hand-rolling a `#toast` div.
- **Nav bars.** Markup classes `un-navbar` (fixed, blurred, translucent),
  `un-navbar-title`, `un-navbar-back` (tinted back chevron), and
  `un-navbar-large` (large-title block in the page flow). Wire with
  `unNative.attachNavBar(barEl, { scrollEl?, largeTitleEl? })` — shows
  the hairline once scrolled and collapses the large title into the
  compact bar; `scrollEl` defaults to the window scroller. Returns
  `{ detach() }`.
- **Inset-grouped lists (pure CSS).** `un-group` (rounded card),
  `un-group-header` (uppercase inset section header), `un-group-row`
  (inset hairline separators drawn on the static container, so they
  hold still while a row swipes). The biggest "looks native" lever;
  composes with `attachSwipeActions`.
- **Gesture arbiter.** `unNative.gestures` — `{ claim(seq, token),
  owner(seq), release(seq) }`, the single intent lock the kit's own
  swipe and pull-to-refresh recognizers go through. App gestures
  (long-press drag, custom pans) should join it: at your own
  intent-lock moment (never before movement passes the lock threshold),
  `claim(seq, yourToken)` — for the primary touch the sequence is the
  string `'touch'`; for non-touch pointers, the `pointerId` — and back
  off if it returns `false`. Claims auto-clear when the finger lifts.
- **Screen transitions.** `unNative.transition(fn, { type: 'push' |
  'pop' | 'none' })` wraps your DOM mutation in a View Transition (iOS
  slide+parallax / Android shared-axis fade; instant cut where the API
  is missing). Use `'push'`/`'pop'` for real screen navigation ONLY;
  tab switches, menus and panel toggles must use `'none'` — repeated
  animation on high-frequency UI reads as lag, not polish. For
  tile/card → detail navigation there are also `type: 'zoom-in'` /
  `'zoom-out'` — the iOS-homescreen expand/collapse: the destination
  screen grows out of the tapped tile's on-screen rect, and Back
  shrinks it into the tile again. Pass `el` (the screen element that
  moves) and `fromEl` (the tile element — or a function returning it,
  resolved lazily; or a static `fromRect`), and split the mutation in
  two: `fn` reveals the incoming screen (leave the outgoing one
  visible — it shows beneath the moving card) and `after` conceals the
  outgoing one (the kit runs it exactly once on every path). The LIVE
  element is transform-animated as a pinned fixed overlay — no View
  Transition snapshot, so it's iframe-safe and content keeps loading
  mid-zoom — with an opaque `--un-zoom-bg` surface for the duration
  and an exact inline-style restore at the end. When the zoom can't
  run (tile off-screen, deep link, reduced motion) it falls back to
  `fallback` (`'push'`/`'pop'` by default, or `'none'`) with the
  combined mutation. Push/pop remain the default for plain screen
  navigation.
- **Safe areas.** Opt-in helpers `.un-safe-top` / `.un-safe-top-extend`
  / `.un-safe-bottom` / `.un-safe-bottom-extend` / `.un-safe-x` inset
  fixed bars from the notch and the home indicator. They require
  `viewport-fit=cover` in the page's viewport meta.
  **Inside the platform app frame, bare `env(safe-area-inset-*)` is
  always `0px`** — browsers only expose safe areas to the top-level
  document, so an iframed app can't see them. The platform forwards the
  real values instead (see "Safe-area insets inside the app frame"
  below) and the kit helpers already read them, so the helpers above
  work in both hosts. Your own fixed chrome should follow the same
  pattern — `var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px))`
  rather than bare `env()` — which is correct embedded *and* standalone.
- **Spring engine.** `unNative.spring(elOrCallback, { from, to,
  velocity, preset })` — the kit's own rAF damped-spring integrator,
  available for custom gestures so they match the kit's motion family.

### Fidelity rules (why the kit feels native — don't undo them)

The kit implements, and custom UI in an adopting app should follow:
**1:1 finger tracking** (during a drag the element is a pure function
of the finger; nothing animates 0→1 after a threshold), **interruptible
motion** (a touch mid-spring grabs the element at its current position
and velocity), **momentum commits** (release velocity is projected —
a short hard flick commits; drifting back past the line cancels),
**spring releases** (no fixed duration+bezier on gesture releases), 
**destructive actions fire only on gesture end**, and **no animation on
high-frequency interactions** (tabs, menus, panels). Don't wrap kit
gestures in your own CSS transitions and don't add entrance animations
to frequently-used controls.

### Theming — override `--un-*` variables, never fork the CSS

Every color and radius in the kit routes through CSS custom properties
with platform-violet defaults (and built-in `.dark` values). Re-theme
by overriding them on `:root` / `.dark` / any wrapper — never by
out-specificity-ing kit selectors or copying the stylesheet:

- `--un-accent`, `--un-accent-contrast` — active/on color and what's
  drawn on top of it
- `--un-switch-track-off`, `--un-switch-thumb`
- `--un-action-danger`, `--un-action-neutral`, `--un-action-text` —
  swipe-action buttons
- `--un-surface` — kit chrome (pull-to-refresh puck)
- `--un-hairline`, `--un-muted` — separators and secondary text
- `--un-group-bg`, `--un-sheet-bg`, `--un-navbar-bg`, `--un-backdrop`
  — grouped-list cards, sheet/modal/alert surfaces, nav-bar backing,
  overlay dim
- `--un-panel-bg`, `--un-panel-width` — the side drawer's surface
  (defaults to `--un-sheet-bg`) and its width (defaults to
  `min(20rem, 86vw)`). The width is the one piece of drawer geometry
  that IS themeable — the physics around it are not
- `--un-popover-bg` — the anchored popover / dropdown-menu surface
  (defaults to `--un-sheet-bg`). **Keep it fully opaque:** a popover has
  no backdrop behind it, so a translucent value lets the page read
  through the menu. This is why it is a separate token from
  `--un-group-bg`, which apps commonly theme as a translucent tint
- `--un-toast-bg`, `--un-toast-text`, `--un-toast-action` — the toast
  surface (dark in BOTH modes, the iOS HUD idiom) and its action label
- `--un-radius`, `--un-radius-full`, `--un-radius-card`

Physics, thresholds and gesture geometry are deliberately **not**
themeable — the native feel stays uniform across differently-branded
apps.

### Adoption steps (what "switch this app to the kit" means)

1. Add the two hosted tags above to the HTML shell's `<head>`.
2. Add `viewport-fit=cover` to the viewport meta; put `.un-safe-top` /
   `.un-safe-bottom` (or the `-extend` variants) on fixed headers /
   bottom bars. For fixed chrome the helpers don't cover, write
   `var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px))` —
   bare `env()` is `0px` inside the platform frame (see "Safe-area
   insets inside the app frame").
3. Add `future: { hoverOnlyWhenSupported: true }` so `hover:` styles stop
   sticking after taps on touch screens — in `tailwind.config.js` on the
   precompiled path (the scaffold already sets it), or in the page's inline
   `tailwind.config` for an app still on the hosted runtime. See the
   Tailwind section below for which path an app is on.
4. Swap checkbox-style toggles to `class="un-switch"`.
5. Wire `attachSwipeActions` on list rows with row-level actions
   (delete / archive / mark read), `attachPullToRefresh` on
   refreshable lists, and `attachReorder` on user-orderable lists.
   If the app uses (or adopts) the fixed-shell layout with in-page
   text fields, wire `attachKeyboardAvoidance` on the content
   scroller and delete any hand-rolled visualViewport plumbing.
6. Route real screen navigations through `unNative.transition`
   (`'push'`/`'pop'`; `'zoom-in'`/`'zoom-out'` for tile/card → detail);
   leave tabs/menus/panels instant.
7. Optionally override `--un-*` variables to match the app's branding.

## Tailwind — precompiled per app, runtime centrally hosted

Every app on this platform styles itself with Tailwind. There are two ways
to get it, and **the precompiled one is the default for new and edited
apps**:

### 1. Precompiled (default) — no styling script at all

The scaffold ships a `tailwind.config.js`, a `styles/tailwind-input.css`,
and an **npm build script** that compiles them to `public/tailwind.css`.
The scaffold's Dockerfile invokes that script under BuildKit or standalone
Docker; the Kubernetes Paketo builder invokes it on the kpack path.
The HTML just links it:

```html
<link rel="stylesheet" href="/tailwind.css">
```

Why this is the default: it is ~7 KB of finished CSS instead of a ~400 KB
in-browser compiler, it paints instantly with no flash of unstyled content,
and the visitor's device does no styling work.

**There is no artifact to keep in sync and no rebuild step to remember.**
The compile runs during image creation from the requested Git revision,
through BuildKit or kpack/Paketo on Kubernetes, according to `BUILD_ENGINE`,
or `docker build` on standalone Docker.
Production and staging may reuse a compatible image of the same revision;
the stylesheet still comes from the markup in that exact commit.
Nothing is committed to the repo; `public/tailwind.css` exists only inside
the image.

The one rule this path asks of you:

- **Write class names as whole literals.** Tailwind's extractor is a regex
  over your source text, so `class="bg-violet-600"` and
  `cls = isError ? 'bg-red-500' : 'bg-zinc-500'` both work, including
  inside JS strings. A name *assembled* at runtime —
  `'bg-' + tone + '-500'` — is invisible to the compiler and will not be
  styled. Pick whole strings out of a map or ternary instead; that is how
  the platform's own shell does it.
- Need a Tailwind plugin (`forms`, `typography`)? Add it to
  `tailwind.config.js` `plugins` — strictly better than the CDN's
  `?plugins=` query, which this path does not use.

### 2. The centrally-hosted runtime — the escape hatch and migration target

For an app that genuinely must generate class names at runtime, and as the
one-line migration target for apps still pointing at the third-party CDN,
the platform serves a pinned copy of the Tailwind browser engine on every
app's own address — exactly like the bridge and the native UI kit:

```
/usernode-tailwind/v1/tailwind.js
```

Canonical source: `social-vibecoding/public/usernode-tailwind/v1/tailwind.js`.

```html
<script src="/usernode-tailwind/v1/tailwind.js"></script>
<script>tailwind.config = { darkMode: 'class' }</script>
```

Rules:

- **Migrating off `cdn.tailwindcss.com` is a one-line change.** These are
  byte-for-byte the same bytes that CDN serves (Tailwind 3.4.17, digest
  recorded in `public/vendor/README.md`), and the inline `tailwind.config`
  beside the tag keeps working untouched — so the swap is
  behaviour-identical, with no visual difference and no rebuild.
- **No proposal check rejects a `cdn.tailwindcss.com` tag.** Nothing the
  platform runs inspects an app's source for one, and apps still on the CDN
  pass their checks — moving the fleet off it is housekeeping, never a merge
  gate, and never a drive-by inside an unrelated proposal. (Vendoring the
  hosted files into a repo is the rule that is real, and it too holds by
  convention rather than by a check — see the bridge section.)
- **Why bother:** the CDN is one outside dependency shared by the entire
  fleet. When that host is blocked or down, *every* app it serves loads
  unstyled, not just one. Same reasoning as the bridge.
- **`no-cache, must-revalidate`**, so a patch bump inside `/v1/` reaches
  every app on its next page load (304s when unchanged).
- **Versioning.** `/v1/` is OUR contract, not Tailwind's. A future Tailwind
  major changes utility semantics and would ship at `/usernode-tailwind/v2/`,
  with `/v1/` staying live until the last consumer moves.
- **Rollback.** Revert in `social-vibecoding/` and redeploy the platform;
  every app recovers on its next page load, no per-app redeploy.
- **Expect one console warning.** The bundle logs Tailwind's own "should not
  be used in production" notice. It is a `warn`, not an error, so it does
  not affect proposal checks — it is kept because the file is verbatim
  upstream, which is what makes its digest verifiable. Nothing to chase.
- **Prefer the RELATIVE path**, `/usernode-tailwind/v1/tailwind.js`: it is
  served from the app's own hostname on every runtime, so nothing in the
  app names a host a domain move can invalidate. Older fleet apps still
  hard-code a platform hostname, which is exactly the state this avoids;
  newly scaffolded apps derive the origin from the deployment's own
  `USERNODE_DOMAIN`. See [SELF-HOSTING.md](../../SELF-HOSTING.md).

## Vendored shared files

Several other files are **vendored across the platform fleet**: one
canonical source lives in `usernode-dapp-starter`, and each consumer
dapp ships its own copy. Changes propagate by **re-vendoring** (copying
the file from canonical), not by editing the per-app copy. (The
bridge above is the exception — see that section for why it's
centrally hosted instead.)

Canonical sources (all in the `usernode-dapp-starter` repo):

| File | Path within repo |
|---|---|
| `usernode-usernames.js` | repo root |
| `usernode-loading.js` | repo root |
| `lib/dapp-server.js` | `examples/lib/dapp-server.js` |
| `lib/tx-match.js` | `examples/lib/tx-match.js` |

Consumers today include `usernode-echo-dapp`,
`usernode-last-one-wins-dapp`, `usernode-opinion-market-dapp`,
`usernode-falling-sands-dapp`, `usernode-feedback-hub`, and
`usernode-group-chat-dapp-test`. The list grows over time; each
consumer's own `CLAUDE.md` names what it vendors and from where.

Rules:

- **Never edit a vendored copy in place** to fix a cross-cutting bug.
  The next re-vendor overwrites it. Edit the canonical source in
  `usernode-dapp-starter`, then re-vendor into each consumer.
- **When designing a cross-cutting fix, count consumers up front.**
  A "one-line" change in canonical is N+1 commits in practice
  (canonical + every consumer). Don't propose a per-app call-site
  change as cheaper than a canonical fix without making that count
  explicit. The fan-out cost is invisible from inside a single
  consumer repo and is a common source of mis-pricing.
- **One-off fixes that apply only to a single dapp** belong in that
  dapp's own non-vendored code, not in a vendored copy. Sentinel: if
  the change makes sense in every other consumer too, it goes in
  canonical.

## Dev console forwarder

Every scaffolded `public/index.html` contains a `<script>` block
tagged `// usernode-dev-console@1`. It captures `console.*` output
and uncaught errors and forwards them via `postMessage` so the
platform's developer console can surface them. Don't remove or
modify that block when editing the HTML shell.

### Helping users surface runtime errors

When a user reports a runtime problem you can't reproduce from the
source ("nothing happens when I click", "it's broken on my phone", a
blank screen), the fastest path to a fix is their actual console output
— but **do not tell them to open browser devtools or press F12.** Most
users are inside the Homeroom mobile app or a phone browser where
devtools don't exist, so that advice dead-ends the conversation (a
common failure mode: the agent asks for a console trace, the user
answers "I can't open the terminal / I don't have F12", and the loop
stalls).

Instead, point them at the platform's built-in **Dev Console** — an
in-app, mobile-friendly panel surfaced by the `usernode-dev-console@1`
forwarder above. It shows up as a console icon in the header (it
appears automatically once the app logs an error, and can be pinned on
via Settings → "always show dev console"). Ask them to open it and
paste the red error lines. It captures exactly the same `console.*`
output and uncaught errors on mobile as on desktop, so it works
regardless of device.

### Fixing a reported bug

When the user reports a specific broken *behaviour* (not a new
feature):

- **Reproduce it first.** On a build turn, use the in-loop browser
  (see "In-loop browser" below) to actually exercise the flow the user
  described — click the button, play the round, submit the form —
  instead of only reading source. Logic bugs (a counter that resets, a
  balance that doesn't update, "buy 16, take 1, it drops to 0") are
  invisible to source-reading *and* to the baseline "no console errors"
  check; you have to run the flow to see them.
- **Lock the fix in with a test.** After fixing, add or extend a
  `dapp.json` test that would have caught it (navigate the route +
  assert the corrected behaviour / element), so a later change can't
  silently regress it. The baseline check only proves the page loads
  without console errors — it does **not** prove behaviour, so
  behavioural regressions slip through unless you add a test for them.

## Starter-template notice — meant to be deleted

Freshly scaffolded apps ship `public/index.html` as a template welcome
screen — a "Starter template" hero and a "What's already working" card —
wrapped in sentinel comments:

- opens with `<!-- usernode-starter-notice@1 … -->`
- closes with `<!-- /usernode-starter-notice@1 -->`

Unlike the dev-console forwarder block above, this one is **meant to be
deleted**: the whole screen is placeholder content, not product intent.
When the user asks for their first real feature, replace the template
screen rather than building alongside it — remove the sentinel block
(both comments and everything between them), remove or repurpose the
"Try the example" card and its demo endpoints (`/api/press`,
`/api/leaderboard`, the `presses` table) as appropriate, and rewrite the
scaffolded `README.md` to describe the actual app. Keep the dev-console
forwarder `<script>` when rewriting the HTML.

## Platform-level problems & missing capabilities: escalate, don't file workarounds

You can only edit and push **this app's** repo. Some things the app
needs don't live in this repo at all — they're in the platform or
shared infrastructure. Two categories are worth escalating:

**Platform-level breakage** — something outside this repo is broken:

- the shared bridge (`usernode-bridge.js`), wallet / signing, or the
  native mobile WebView (e.g. a file picker, camera, or share sheet
  that never opens inside the Homeroom app)
- the staging / build / preview pipeline itself (the preview won't boot
  for reasons unrelated to your code)
- the merge/checks gate, or a documented platform convention that
  appears wrong or impossible to satisfy

**Missing platform capabilities** — a capability this app legitimately
needs that the platform doesn't provide: a bridge API that doesn't
exist, data the platform tracks but doesn't expose (e.g. per-app LLM
spend), a platform limit or convention that blocks a reasonable app
feature. **Feature requests are as valid as bug reports here** — don't
build a fragile app-side approximation of something the platform
should own without also drafting a report for the real capability.

When you're confident the root cause is platform-level — you've ruled
out an app-side fix, you've established the capability simply doesn't
exist, or you notice you're looping on the same failure without
progress — **stop patching this app** rather than faking a workaround
that only hides the problem. On a build turn a helper is available to
escalate it:

```
usernode-report-platform-issue "<short title>" <<'EOF'
What's broken or missing, how to reproduce / what the app needs it
for, and which app/flow hit it.
EOF
```

This does **not** file anything by itself. It posts a draft report
card into the dev chat; a user must tap **"Report to platform"** on
that card before the issue is actually filed on the platform repo
(they can also dismiss it). Draft it **once per distinct problem** —
it de-dupes against open reports and this session's earlier drafts, so
don't re-suggest the same thing. Then tell the user you've suggested a
platform report and that they can confirm it from the card in the
chat, and continue with any app-side work that isn't blocked by it.

## Rendering invariants — opt-in self-checks

The bridge (see "Bridge") exposes an **opt-in** API for registering
cheap correctness checks that run in the live preview and report
failures into the same developer console as `console.error`. It is
fully **no-op by default**: an app that registers nothing behaves
exactly as before. Use it to catch *structural* rendering bugs that a
screenshot might not make obvious — the canonical example being a
canvas that should exactly fill its window but renders at the wrong
pixel density on HiDPI screens.

A check is a function returning a truthy value when the invariant
holds, or `false` / a string reason when it's violated. Register it
once the bridge is loaded:

```js
usernode.invariants.register('canvas-fills-window', function () {
  var c = document.querySelector('canvas');
  if (!c) return true; // nothing to check yet
  var expectedW = Math.round(window.innerWidth * window.devicePixelRatio);
  var expectedH = Math.round(window.innerHeight * window.devicePixelRatio);
  if (c.width !== expectedW || c.height !== expectedH) {
    return 'canvas ' + c.width + 'x' + c.height +
           ' != window ' + expectedW + 'x' + expectedH;
  }
  return true;
});
```

Behaviour:

- Registered checks run on `resize` / `orientationchange` and once
  immediately at registration (so an already-violated invariant
  reports without waiting for a resize).
- A violation posts an `error`-level entry (kind `invariant`) to the
  dev console — it badges red like any other error. A check that
  throws is reported, never propagated.
- Failures are **debounced**: a check reports once when it starts
  failing and once when it recovers, not every tick.
- Requires the hosted bridge `<script>` (it lives in the bridge, not
  the vendored forwarder, so there's nothing to re-vendor). Add the
  bridge tag if your shell doesn't already load it.

## Issue-state snapshots — opt-in app state in filed issues

The bridge (see "Bridge") exposes an **opt-in** API for sharing a
debug snapshot of the app's internal state with the platform's
issue-submission flow. When an app registers a provider, the
platform's Send Feedback modal shows an "Include app state" checkbox
(checked by default) for issues targeting that app; at filing time the
platform asks the app for the snapshot and appends it to the GitHub
issue body in a collapsed `<details>` block, giving whoever works the
issue the app's actual runtime state. Fully **no-op by default**: an
app that registers nothing behaves exactly as before.

Register a provider once the bridge is loaded:

```js
usernode.issueState.register(function () {
  // Return a JSON-serializable object (or a Promise of one) with
  // whatever would help someone debug an issue in this app.
  return {
    view: currentView,
    settings: settings,
    itemsLoaded: items.length,
  };
});
```

`usernode.issueState.unregister()` clears the provider. Repeat
`register` calls replace it (last write wins).

Behaviour:

- The provider is called at issue-submit time and raced against a
  3-second timeout; a provider that throws, hangs, or returns
  non-serializable data simply means the issue is filed **without**
  state — it never blocks or fails the submission.
- The serialized snapshot is capped at **32 KB** (32,768 chars);
  oversized dumps are cut off and labeled truncated. Keep snapshots
  well under the cap — a compact, curated summary beats a raw dump.
- **Sanitization is the app's responsibility — snapshots land in
  PUBLIC GitHub issue bodies.** Never include credentials, tokens,
  secrets, or other users' data, and skip free-text user content
  unless it's clearly non-sensitive. Registering the provider IS the
  app's declaration that its snapshot is safe to publish.
- Requires the hosted bridge `<script>` and only works inside the
  platform shell (the app iframe); standalone pages register
  harmlessly.

## In-loop browser (build turns)

On a **build** turn (not scout/sync) both hosted Claude Code and hosted Codex
have a headless browser
available through the **Playwright MCP server** — `browser_navigate`,
`browser_console_messages`, `browser_take_screenshot`, and friends. It
lets the agent load the app it just edited and *see* the result —
catching a blank page, a JS crash on load, a broken layout, or a failing
API call that source-reading alone would miss — and fix it before
committing.

Use it before declaring a `ui` or `motion` visual evidence story. A story
must describe a checkpoint you actually reached in the local app, including
the state the evidence runner will need to reproduce. For backend-only,
refactor, or docs work, rendering may tell you nothing and the browser is
optional. Chromium only launches on the first browser tool call. Scout and
sync turns have no browser at all.

### Launch contract

The app must actually be running for the browser to load it. Boot it
locally inside the worker the same way a staging container does:

- **`USERNODE_ENV=staging`** against a **fresh, empty local database** —
  the build turn exposes `INLOOP_ENV`, `INLOOP_PORT`, and
  `INLOOP_DATABASE_URL` for exactly this. Typical launch:
  `usernode-run-inloop node server.js &`
  (or this app's declared `dapp.json` entrypoint).
- The launch command supplies the manifest's committed `staging_default` /
  `default` values, as staging does. If a required value has no committed
  fallback, it reports the missing key and stops. Never copy a production
  secret or invent a credential just to make the local check run.
- Navigate to `http://127.0.0.1:$INLOOP_PORT` at the real starting route for
  the flow you will declare. Self-app app screens stay under
  `/app/<slug>/...`; put its other SPA routes after the `#`.
- Exercise the real interaction and make the evidence intent concrete. For a
  mobile-only change, resize to the viewport you will declare (for example
  390×844). This local check helps you fix the head revision; the later paired
  evidence run independently explores and replays both revisions.
- A **blank or empty page usually means missing seed data, not a bug** —
  the local DB starts empty. Check the app's existing staging fixtures or
  `?demo=1` route first. A sign-in screen means this browser is signed out;
  use an existing documented fake staging account through the normal UI if
  possible. Do not change auth code or seed passwords solely for this check.
- Keep it tight (a couple of launch→check→fix cycles, a minute or two).
  **If the app won't boot** — no local Postgres, a missing required
  secret, a crash on start — report the blocker. You can still finish
  non-visual work, but do not submit an unverified visible story. If the
  claim needs data or a fault that the local app cannot reproduce, add a
  representative fixture exercised by the normal test route. Do not add a
  screenshot-only route or invent a state just to get a capture.

This is an agent-facing quality gate for the claimed head state. Before
finishing a user-visible build, call `record_visual_evidence_intent` only for
a flow you actually reached. The exact-revision paired replay still verifies
both sides independently, and the "Test this change" action remains a
separate manual aid.

## Writing user-facing copy: no em dashes

**Do not use an em dash (`—`) in any string a user reads.** Button
labels, headings, empty states, toasts, validation errors, push and email
bodies, `dapp.json` descriptions: all of it. A dash-heavy line is the single
strongest tell that copy was machine-written, and an app full of them feels
generated rather than made. The rule covers every encoding an em dash arrives
in (the raw character, `&mdash;`, `&#8212;`, and the `\u2014` escape), because
a sweep that only greps for the raw character misses whole files.

Reach for the punctuation the sentence actually wants:

- **Status then instruction** (`Upload failed — try again`) becomes two
  sentences: `Upload failed. Try again.` This is the default when nothing
  else fits, and on a push body or a table cell it is also the shortest fix.
- **Label and value**, or a heading and its qualifier, takes a colon:
  `Failed step: cloning the repository`.
- **A trailing qualifier**, especially `optional`, takes parentheses:
  `Display name (optional)`.
- **Cause and consequence** takes `, so` or `, because`, or a colon.
- **A mid-sentence aside** takes commas, or gets restructured. If you remove
  one dash of a bracketing pair, remove the other one too. A single leftover
  dash reads worse than the pair did.

**Never substitute a plain hyphen or a spaced hyphen.** `Upload failed - try
again` reads as a typo and keeps exactly the texture the rule exists to
remove.

Three uses are not prose punctuation and stay: a lone `—` rendered as the
placeholder for a missing value, a `— Section —` separator row in a picker,
and an en dash in a numeric range (`20–60 seconds`). Comments, README and
docs prose, and LLM prompt text are agent-facing rather than user-facing, so
they are out of scope, this document's own prose included.

## Outputting file edits

When Claude Code outputs updated file contents, use the standard
fenced-code format with a `filepath:` prefix the harness parses:

````
```filepath:path/to/file.js
// complete file contents here
```
````

Always output the **full** file contents, not diffs or partial
snippets.
