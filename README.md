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

## Storage-backed flags

For projects that want to flip a flag per tenant without a deploy. `subjectStore`
owns the semantics; you own the SQL — any database, any client:

```ts
const store = subjectStore({
  load: async (subject, key) => {
    const row = await db.overrideFor(subject, key);   // (subject_id, flag_key, override)
    return row && { override: row.override, optedIn: row.opted_in };
  },
  requiresOptIn: (flag) => flag.def.selfServe === true,
});

createResolver({
  flags,
  sources: [
    envOverride(),
    store.kill,           // 1. a 'disabled' row — outranks the cookie
    cookieOverride({ secret }),
    store.requireOptIn,   // 3a. veto anything the tenant hasn't switched on
    store.grant,          // 3b. an 'enabled' row
    envDefault({ env }),
  ],
});
```

Three sources, one storage read: they share a cache keyed on the `Context`
object, which is per request, so a request pays one `load` per flag no matter how
many of the three are in the chain.

`'disabled'` and `'enabled'` are one row but two sources because they belong in
**different slots** — a per-tenant kill has to outrank a visitor cookie for the
same reason the env kill switch does, while a grant sits below it. `requireOptIn`
sits ahead of `grant` because it must be able to veto an entitlement decided by a
*later* source (a plan lookup, a stage rule) — a veto that runs after the
decision it's vetoing never fires.

Project-specific policy stays yours. Hang your own fields on a flag def (`stage`,
`tier`, `owner`) and read them in your own source — the registry keeps their real
types.

> There is no `launchgate/postgres` subpath. Once the interface is a `load`
> function, nothing Postgres-specific is left to ship.

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

## Next.js

```sh
pnpm add launchgate   # `next` is an optional peer dependency
```

```ts
// app/flag-override/route.ts   ← NOT app/__flags/: see the trap below
import { createOverrideRoute } from "launchgate/next";
import { gate } from "@/flags";

export const { GET } = createOverrideRoute({
  resolver: gate,
  secret: process.env.FLAG_SECRET!,
  accessToken: process.env.FLAG_ACCESS_TOKEN!,   // presented as ?token=, never the signing secret
});
```

**If your app has an auth gate, exclude this route from it.** Inside the matcher
it redirects to your login page and the cookie is never set — the mechanic
silently does nothing. Its `?token=` is its authorization, and working logged-out
is the point.

Then `GET /flag-override?token=…&flag=newHomepage&value=on` sets the cookie,
`&value=off` flips it, omitting `value` clears that flag, and `&clear=1` drops
all of them. A wrong token gets a 404, not a 401 — an unadvertised route should
stay unadvertised.

Read a flag in a page or handler:

```ts
import { requestContext, requireFlag } from "launchgate/next";

const on = await gate.resolve("newHomepage", await requestContext());     // page
const blocked = await requireFlag(gate, "network", { subject: orgId });   // handler → 404 | null
```

### Static rendering — measured, not guessed

`requestContext()` calls `cookies()`, and that **opts the page into dynamic
rendering**. Verified against Next 16.3.1 by reading `next build`'s route table:

| Page | How it reads the flag | Build classification |
| --- | --- | --- |
| `/hidden` | `requestContext()` in the page | **ƒ Dynamic** |
| `/home` → `/variants/v1`,`/v2` | proxy reads the cookie and rewrites | **○ Static** (all three) |

- **Already-dynamic page** (anything authenticated): just call
  `requestContext()`. The dynamic cost is already paid.
- **Page that must stay static** (marketing, landing, docs): don't read the flag
  in the page. Author the variants as separate routes and rewrite in `proxy.ts`:

```ts
// proxy.ts  (Next 16's rename of middleware.ts)
import { NextResponse, type NextRequest } from "next/server";
import { readOverrides } from "launchgate";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("lg_override")?.value;
  const overrides = token ? await readOverrides(token, process.env.FLAG_SECRET!) : undefined;
  const variant = overrides?.newHomepage === true ? "v2" : "v1";
  return NextResponse.rewrite(new URL(`/variants/${variant}`, request.url));
}

export const config = { matcher: "/home" };
```

There is no third option. Resolving in the proxy and forwarding a request header
doesn't help: the page then calls `headers()`, which opts it into dynamic
rendering just the same. Forwarding moves the read, not the cost.

> **Trap.** A route handler under a `_`-prefixed directory — `app/__flags/route.ts`
> — **never registers**. `_` marks a private folder in the App Router, excluded
> from routing silently, with no build error and no 404 in the route table. Mount
> the override route at a normal path.

## Async work

Resolve at submission and **stamp the value into the job payload**. A job
enqueued Monday and run Wednesday must use Monday's value, or you get a job
that's half one behaviour and half the other — and under a deterministic workflow
engine, a replay failure. Downstream services get resolved values, not a flag
client. Records produced by gated code should carry their own provenance rather
than being re-interpreted through the current flag value.

## Install

```sh
pnpm add github:<owner>/launchgate#v0.1.0
```

`dist/` is **committed**, so consumers install nothing and build nothing.

The alternative — building on install via `prepare` — is designed for
npm-published packages and misfires badly for a git dependency: pnpm 10 blocks it
outright (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`) until each consumer allowlists
the package, and once allowed, every consumer installs this library's full
devDependencies (Next, React, tsup, vitest) to rebuild 6 KB of output. Committed
output is the cheaper trade.

**So: run `pnpm check` before you tag.** It typechecks, tests, *and* rebuilds
`dist/`, which is the only thing keeping the committed output honest. Keep
`version` in step with the tag too — pnpm reports the manifest version in errors,
so a stale one makes them read as the wrong release.

## Development

```sh
pnpm install
pnpm check     # tsc --noEmit && vitest run
```
