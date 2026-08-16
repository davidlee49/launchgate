# ADR 0001 — launchgate: a launch-gate library, not a flag platform

**Date:** 2026-08-15
**Status:** Accepted (phase 1 — core package)

> Several projects need to hide work-in-progress from the public while remaining
> visible to their author, and to kill a shipped feature without a redeploy. This
> ADR defines a small, storage-optional, framework-agnostic library that does
> exactly that: a typed registry in the consuming repo, an **ordered list of
> sources** resolved first-definite-wins, and an evaluation call that cannot
> throw. It deliberately excludes experimentation, entitlements, and
> health-driven routing, and says why each would be a mistake to fold in.

---

## Context

"Feature flag" names five different things with incompatible requirements:

| Archetype | Lifespan | Flipped by | Needs |
| --- | --- | --- | --- |
| **Release toggle** | Days–weeks, then deleted | Engineer | env / per-visitor targeting; easy deletion |
| **Kill switch / ops** | Permanent | Engineer, on-call | Fast propagation; must work when things are broken |
| **Experiment** | Weeks | PM / analyst | Sticky assignment + exposure logging + metrics |
| **Entitlement** | Permanent | Sales / billing | Contract as source of truth; quotas; audit; upsell path |
| **Dynamic config** | Permanent | Engineer | Returns *values*, not booleans |

Products differ on whether to unify them. LaunchDarkly makes everything a flag
with variants; Statsig keeps feature gates, dynamic configs, and experiments as
distinct products. Statsig's split is the better *teaching*; LaunchDarkly's
unification is the better *commercial product* — one UI, one SDK, one bill.

This library is not a commercial product, and unifying costs more than it saves:

- **Experiments** need an analytics pipeline. At tens of tenants, statistical
  inference is noise with a dashboard.
- **Entitlements** derive from a *contract*. Putting billing truth in a flag
  store gives it no transactional relationship to the subscription record, so a
  downgrade and a flag flip can disagree — and an engineer sweeping stale flags
  deletes revenue logic that looked like dead state. This is why Stripe
  Entitlements, Schematic, and Salable exist as separate billing-native products.
- **Health-driven routing** (fail over to a backup provider during an outage) is
  a machine decision made in seconds from observed health. Implemented as a flag,
  a human must notice the outage, and MTTR becomes human-paced.

The demand is real and narrow: **release toggles and kill switches**, across
projects that range from a fully authenticated multi-tenant app to an anonymous
public marketing site.

### Prior art consulted

- **OpenFeature** (CNCF) — Evaluation API / Provider / Evaluation Context /
  Hooks. Its load-bearing interface decision is that evaluation takes a default
  and **cannot throw**; it degrades. Its `targetingKey` is an *optional* subject.
  Both are adopted here. Its provider abstraction is over-general for this scope
  (it exists so vendors can be swapped); the equivalent seam here is `Source`.
- **Vercel Flags SDK** — flags-as-code (`flag({ key, decide })`), server-only
  evaluation, and the precompute pattern that keeps pages static. The
  flags-as-code position and the server-only constraint are adopted; precompute
  is not (see Decision 7).
- **Unleash / LaunchDarkly server SDKs** — in-memory ruleset with background
  refresh. Not adopted (see Decision 5).

## Decision

### 1. Scope: release toggles and kill switches, value-typed

A flag resolves to a **value**, not necessarily a boolean. Boolean is the common
case; `'v1' | 'v2'` is a legitimate one (which pipeline a submitted job uses).
Making the core value-typed costs almost nothing now and is a breaking change
later.

Out of scope, permanently: experimentation. Out of scope, by delegation:
entitlements and routing — an entitlement is an **input** to resolution (a
`Source` the consuming project supplies), and a flag may say whether an
alternative code path is *permitted to exist* but never *chooses* it.

### 2. The engine: an ordered list of sources, first definite answer wins

```text
resolve(key, ctx):
  for source of sources:
    d = source(flagMeta, ctx)
    if d !== undefined: return d          // decided
  return flagMeta.fallback                // terminal, always present
```

`undefined` means *undecided — ask the next source*. Any other value, **including
`false`**, is a decision. This three-valued fall-through is the whole mechanic.

The recommended ordering, and what each slot is for:

| # | Source | Purpose |
| --- | --- | --- |
| 1 | `envOverride` | Operator override. Primary use: the kill switch. |
| 2 | `cookieOverride` | Signed per-visitor override — how the author sees hidden work. |
| 3 | *(project-supplied)* | Allowlist / grant / opt-in / entitlement, usually DB-backed. |
| 4 | `envDefault` | The registry's per-environment value. |
| — | `fallback` | Terminal. Not a source, so it cannot be forgotten. |

Two invariants:

- **`envOverride` outranks `cookieOverride`.** Otherwise a flag forced on by a
  cookie survives the attempt to kill it — the exact scenario a kill switch
  exists for.
- **`cookieOverride` honours only flags declaring `overridable: true`.** A
  visitor must never be able to force a flag with real consequences. Today most
  are cosmetic; the day a project puts an entitlement source in slot 3, it stops
  being cosmetic.

**It is a chain, not a graph.** No flag consults another flag; there is no
traversal, no derived relation, no arrow. That constraint is what keeps
resolution readable and is the difference between this and a rules engine. (It is
also the structural difference from a ReBAC authorization system like SpiceDB,
where the answer is *derived* by walking edges and there is no "undecided". Same
choke-point discipline, different engine — and feature gating stays out of the
authorization schema, because product packaging churns on pricing cadence and
authorization schema on domain-model cadence.)

Conjunctions ("entitled **and** opted in") are expressed as a *requirement*
source that returns a definite off-value or stays undecided. The chain itself
stays first-wins.

### 3. Evaluation cannot throw; the fail-safe value is per flag

Every source call is wrapped. A throwing source **aborts the chain and returns
`fallback`**, reporting through `onError`. It does not fall through to the next
source: predictability beats availability here — there is exactly one degraded
answer per flag and it is declared in the registry next to the flag.

The fail-safe value is per flag because polarity differs by archetype:

- A WIP gate's safe state is **off**. Fail-closed is correct.
- A kill switch on a year-old GA feature's safe state is **on**. Failing to "off"
  would take down working functionality because a database blipped.

A global fail-closed policy gets the second case wrong, so there isn't one.

### 4. Registry in code, in the consuming repo; state (if any) in data

The **list** of flags is a typed const in the project that reads them, not a
table and not library configuration. Flags ship with the code they gate:
deletion is a PR, keys are greppable, and a flag with no reader is visibly dead.
A flag key created at runtime through an admin UI becomes invisible dead state —
the failure this avoids.

Only **state** goes in storage, and only for projects that want runtime flipping
without a deploy: that is slot 3, an optional adapter. The core requires no
storage at all, so slots 1, 2, 4 and the fallback are enough for a static
marketing site.

The storage seam is `subjectStore({ load })`, which returns three sources —
`kill`, `requireOptIn`, `grant` — sharing one read per request via a cache keyed
on the `Context` object. They are three rather than one because they belong in
different slots: a per-subject kill must outrank a visitor cookie for the same
reason the environment kill switch does, a grant sits below it, and an opt-in
requirement must sit *ahead* of whatever it vetoes, since a veto evaluated after
the decision it vetoes never fires.

`load` is a project-supplied function, so this is database-agnostic and there is
no `launchgate/postgres` package: once the interface is a function returning
`{ override, value, optedIn }`, nothing Postgres-specific remains to ship. A row
shape of `(subject_id, flag_key, override)` satisfies it.

### 5. Resolution is per call, uncached, server-side

**No in-memory ruleset with background refresh.** That model (Unleash,
LaunchDarkly server SDKs) exists to avoid a network hop to a *separate* flag
service. When slot 3 reads the same database the request already depends on,
caching buys nothing: if that store is down, the request was already dead. It
costs a staleness window and a bootstrap story, on a runtime (Workers isolates)
where cold starts are frequent. Revisit above roughly a few hundred gated
requests per second, measured.

**No client-side evaluation.** Flags are read on the server during render, as in
the Vercel Flags SDK, which avoids flag-driven layout shift and keeps hidden work
out of the client bundle. A flag whose value reaches the browser must be one the
public may know exists.

### 6. Async work resolves at submission and stamps the value into the payload

A job enqueued Monday and executed Wednesday must use **Monday's** value, written
into the job payload. Re-reading at execution time gives a job that is half one
behaviour and half the other, and — under a deterministic workflow engine such as
Temporal — breaks replay outright.

The corollary is that downstream services get **resolved values, not a flag
client**. A service that executes resolved instructions must not re-decide what
the control plane already decided. Consequently this library ships no
non-JavaScript client, and needs none.

Records produced by gated code must carry their own provenance ("this artifact
was produced by pipeline v2"), not be re-interpreted through the current flag
value.

### 7. Framework specifics live in adapters, and one question is deferred

The core imports no framework and no Node built-ins — signing uses Web Crypto
(`crypto.subtle`), which is present in both Workers and Node 18+, so the same
build runs on the edge.

**Resolved 2026-08-15: the cookie override versus static rendering.** Measured
against Next.js 16.3.1 with a throwaway app, reading `next build`'s route table.

| Page | How it reads the flag | Build classification |
| --- | --- | --- |
| `/hidden` | `requestContext()` in the page | **ƒ Dynamic** |
| `/home` → `/variants/v1`, `/variants/v2` | proxy reads the cookie, rewrites | **○ Static** (all three) |

So: **reading the cookie in the page opts that page into dynamic rendering** —
there is no trick that avoids it, because `cookies()` is the opt-in signal
itself. The rejected candidate was "resolve in middleware and forward a request
header": the page must then call `headers()`, which opts it into dynamic
rendering just the same. Forwarding moves the read, not the cost.

The mechanism that *does* preserve static rendering is a rewrite: the proxy
(`proxy.ts` — Next 16's rename of `middleware.ts`) reads the cookie and rewrites
to one of several prebuilt variant routes, each of which stays statically
prerendered. This is the Flags SDK's precompute pattern arrived at from first
principles, and it is the only shape that works.

The guidance is therefore:

- **Already-dynamic page** (anything authenticated — most of a product app):
  call `requestContext()` and read the flag directly. The dynamic cost is
  already paid; nothing is lost.
- **Page that must stay static** (marketing, landing, docs): do not read the flag
  in the page at all. Author the variants as separate routes and rewrite in
  `proxy.ts`. Costs one prebuilt route per variant, which is why this is reserved
  for pages that genuinely need it rather than made the default.

**Trap, found the same way:** a route handler under a `_`-prefixed directory
(`app/__flags/route.ts`) never registers — `_` marks a *private folder* in the
App Router and is excluded from routing, silently and with no build error. Mount
the override route at a normal path (`app/flag-override/route.ts`).

### 8. Registry types at the call site, `unknown` inside

`defineFlags` infers each flag's value type, so `resolve('newHomepage')` is typed.
Sources, however, operate over a heterogeneous registry and are typed against
`unknown`; the resolver casts at its boundary. This is a deliberate trade: full
generic propagation through a source list buys type safety in the place least
likely to be wrong (four built-in sources, each a few lines) at the cost of
signatures no one can read.

### 9. OpenFeature's vocabulary, not its call signature (0.3.0)

The evaluation context is `EvaluationContext` and its subject field is
`targetingKey` — OpenFeature's names, because it is the CNCF vendor-neutral spec
every major SDK implements, and a familiar dialect costs nothing while a private
one costs every reader. `Context` remains a deprecated alias.

What is **not** adopted is the per-call default —
`getBooleanValue(key, default, ctx)`. That signature exists because an
OpenFeature SDK doesn't own the registry and cannot know a flag's type; ours
does. One `fallback` declared beside the flag beats N call sites free to
disagree about what "off" means (Decision 3 depends on there being exactly one
degraded answer per flag).

Also not adopted: **prerequisite flags**. LaunchDarkly models "the page must be
on before the component can be" as a flag depending on another flag — a DAG.
Prerequisites earn their complexity when many teams create flags ad hoc in a
UI; a typed registry owned by one team gets the same expressiveness by composing
sources, and keeps the property that resolution is a *chain nobody has to
trace*. Consumers wanting a two-level version (a release gate over an
entitlement gate, as impartire has) compose two resolvers and `&&` them —
explicit at the call site, no graph in the library.

### 10. `resolveAll` and `loadAll` (0.3.0)

`resolver.resolveAll(ctx)` evaluates the whole registry — LaunchDarkly's
`allFlagsState()`. It exists because a client needs the full set at once
(bootstrapping a provider so the UI never flickers), and a loop over `resolve`
at the call site would hide the batching opportunity: every flag shares the one
context object, which *is* the cache key `subjectStore` uses.

`subjectStore({ loadAll })` is the other half — one read per subject per
request instead of one per flag. Without it, `resolveAll` over an 18-flag
registry is 18 queries, which is enough to make the client-provider pattern not
worth having. `load` stays for the case where a batch query is awkward;
supplying neither now throws at construction.

## Consequences

- A project with no database, no auth, and no tenants can hide work in progress
  with a registry, an environment variable, and a signed cookie.
- A multi-tenant project composes its own policy — stages, grants, opt-in,
  entitlement — as sources. The library never learns what a "stage" is; that
  vocabulary stays in the project that has it.
- There is deliberately no way to run a statistically valid experiment, and no
  way for an admin UI to create a flag that no code reads.
- Every gated request pays one read per storage-backed source, uncached.
- Two adapters must exist per framework family (route handler + guard); today
  only Next.js is planned.
- Flag debt is the dominant long-run cost and the library does not solve it. The
  registry's `description` field and the fact that keys are greppable are the
  whole mitigation.

## References

- OpenFeature specification — evaluation API, provider, evaluation context
  (<https://openfeature.dev/specification/>). Adopted: cannot-throw evaluation,
  optional subject key, and (0.3.0) the `EvaluationContext` / `targetingKey`
  vocabulary. Not adopted: the per-call default (Decision 9). Shipping
  launchgate *as* an OpenFeature Provider is a ~40-line adapter and the obvious
  interop seam, deferred until a second consumer or a vendor makes it earn its
  keep.
- LaunchDarkly — `allFlagsState()` (the shape `resolveAll` copies), flag
  prerequisites (considered and rejected, Decision 9), and stale-flag rules
  (temporary + 30 days old + 7 days inactive) as prior art for flag debt, which
  this library still leaves to its consumers.
- Unleash flag types (<https://docs.getunleash.io/reference/feature-toggles>) —
  *Release* (temporary, ~40-day expected lifetime), *Permission* (permanent,
  entitlement), *Kill switch*, *Sunset*. Consumers should name their flags with
  these; the library models none of them, by Decision 4.
- Vercel Flags SDK (<https://flags-sdk.dev/>) — flags-as-code, server-only
  evaluation, precompute (not adopted; see Decision 7).
- Statsig vs LaunchDarkly on flag/config/experiment separation — the taxonomy in
  Context.
- impartire ADR 0040 (org feature entitlements, staged rollout) — the
  implementation this library is extracted from; its stage vocabulary and
  org-as-unit decision remain that project's composition, not library semantics.
