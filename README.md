# launchgate

Hide work in progress from the public while you keep seeing it. Kill a shipped
feature without a redeploy. No platform, no service, no database required.

Design of record: [adr/0001-launch-gate-design.md](adr/0001-launch-gate-design.md).

```ts
import { defineFlags, createResolver, envOverride, cookieOverride, envDefault } from "launchgate";

export const flags = defineFlags({
  newPricingPage: {
    fallback: false,
    description: "Rebuilt pricing page — hidden until launch",
    overridable: true,
    byEnv: { development: true },
  },
});

export const gate = createResolver({
  flags,
  sources: [
    envOverride(),                                  // 1. kill switch
    cookieOverride({ secret: process.env.FLAG_SECRET! }), // 2. you, on the live site
    envDefault({ env: process.env.NODE_ENV! }),     // 4. per-environment default
  ],
  onError: (error, { flag, source }) => console.error("launchgate", flag, source, error),
});

if (await gate.resolve("newPricingPage", { cookie })) { /* … */ }
```

## How resolution works

An **ordered list of sources**; each answers with a value or `undefined`
(*undecided — ask the next one*); the first definite answer wins. The flag's
`fallback` is terminal, so it can't be forgotten.

| # | Source | Purpose |
| --- | --- | --- |
| 1 | `envOverride()` | `FLAG_NEW_PRICING_PAGE=off`. The kill switch. |
| 2 | `cookieOverride({ secret })` | Signed per-visitor token — how you see hidden work in production. |
| 3 | *yours* | Allowlist, grant, opt-in, entitlement. Usually a database read. |
| 4 | `envDefault({ env })` | The registry's `byEnv` value. Preview deployments are just a different `env`. |
| — | `fallback` | Terminal, always present. |

`false` is a decision. `undefined` is not. That three-valued fall-through is the
whole mechanic — and there is no traversal: no flag ever consults another flag.

### Two invariants

- **`envOverride` sits above `cookieOverride`.** A flag forced on by a cookie
  must not survive the attempt to kill it.
- **`cookieOverride` honours only `overridable: true` flags.** A visitor must
  never force a flag with real consequences.

### Failure is per flag, not global

Every source call is wrapped. A source that throws **aborts to that flag's
`fallback`** and reports through `onError` — it does not fall through, so there
is exactly one degraded answer per flag and it's declared next to the flag.

That value is per flag because polarity differs: a WIP gate's safe state is
`false`, but a kill switch on a year-old feature's safe state is `true` — failing
*that* one closed would take down working functionality because a database
blipped.

## Flags aren't only booleans

```ts
renderPipeline: {
  fallback: "v1" as "v1" | "v2",
  description: "Which render pipeline a submitted job uses",
}
```

`FLAG_RENDER_PIPELINE=v2` and cookie overrides carry the value. Booleans are the
common case, not the only one.

> **Typing note.** `fallback: false` is widened back to `boolean` for you.
> Strings and numbers keep what you declare, which is why the `as "v1" | "v2"`
> above gives you a checked union.

## Custom sources

A source is `{ name, decide(flag, ctx) }`. Return a value to decide, `undefined`
to pass:

```ts
const orgGrant: Source = {
  name: "orgGrant",
  async decide({ key }, ctx) {
    if (!ctx.subject) return undefined;
    const row = await db.grantFor(ctx.subject, key);
    return row?.enabled;         // undefined when there's no row — undecided
  },
};
```

Conjunctions ("entitled **and** opted in") are a *requirement* source: return the
off-value, or `undefined` to stay out of the way. The chain stays first-wins.

## Testing

```ts
import { withFlags } from "launchgate";

const gate = withFlags(flags, { newPricingPage: true });
```

Answers from a fixed map, falls back for anything unset. Use it instead of
standing up real sources — flags multiply a test matrix, and that's only
tolerable if pinning a value is one line.

## Minting an override token

```ts
import { signOverrides } from "launchgate";

const token = await signOverrides({ newPricingPage: true }, secret);
// set it as the `lg_override` cookie
```

HMAC-SHA256 over Web Crypto, so the same build runs on Cloudflare Workers and
Node 18+. Tampered or foreign-signed tokens are silently *undecided* — hostile
input falls through the normal chain rather than pushing the flag anywhere.

## What this deliberately isn't

- **Not experimentation.** No assignment, no exposure logging, no metrics. At the
  scale this is built for, statistical inference is noise with a dashboard.
- **Not entitlements.** Those derive from a *contract*. Put billing truth in a
  flag store and it has no transactional relationship to the subscription, so a
  downgrade and a flag flip can disagree — and a stale-flag sweep deletes revenue
  logic that looked like dead state. Supply an entitlement source instead.
- **Not a circuit breaker.** Failing over to a backup provider is a machine
  decision made in seconds from observed health; as a flag, a human has to notice
  the outage first. A flag may say whether the alternative path is *permitted to
  exist* — it must never *choose* it.

> A flag records a decision a person made. A circuit breaker records a fact the
> system observed.

## Async work

Resolve at submission and **stamp the value into the job payload**. A job
enqueued Monday and run Wednesday must use Monday's value, or you get a job
that's half one behaviour and half the other — and under a deterministic workflow
engine, a replay failure. Downstream services get resolved values, not a flag
client. Records produced by gated code should carry their own provenance rather
than being re-interpreted through the current flag value.

## Install

```
pnpm add github:<owner>/launchgate#v0.1.0
```

The package builds on install via `prepare`, so a git dependency needs no
committed `dist/`.

## Development

```
pnpm install
pnpm check     # tsc --noEmit && vitest run
```
