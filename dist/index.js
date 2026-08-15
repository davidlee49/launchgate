import {
  DEFAULT_OVERRIDE_COOKIE,
  cookieOverride,
  readOverrides,
  signOverrides
} from "./chunk-34MIJ7KP.js";

// src/resolver.ts
function defineFlags(flags) {
  return flags;
}
function createResolver(options) {
  const { flags, sources, onError } = options;
  async function resolve(key, ctx = {}) {
    const def = flags[key];
    if (!def) throw new Error(`launchgate: unknown flag "${key}"`);
    const meta = { key, def };
    for (const source of sources) {
      let decision;
      try {
        decision = await source.decide(meta, ctx);
      } catch (error) {
        onError?.(error, { flag: key, source: source.name });
        return def.fallback;
      }
      if (decision === void 0) continue;
      if (typeof decision !== typeof def.fallback) {
        onError?.(
          new TypeError(
            `launchgate: source "${source.name}" answered ${typeof decision} for flag "${key}", which is ${typeof def.fallback}`
          ),
          { flag: key, source: source.name }
        );
        return def.fallback;
      }
      return decision;
    }
    return def.fallback;
  }
  return { flags, resolve };
}

// src/sources/env.ts
function envName(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_").toUpperCase();
}
function parseAs(raw, fallback, variable) {
  const trimmed = raw.trim();
  if (typeof fallback === "boolean") {
    const v = trimmed.toLowerCase();
    if (v === "on" || v === "true" || v === "1" || v === "yes") return true;
    if (v === "off" || v === "false" || v === "0" || v === "no") return false;
    throw new Error(
      `launchgate: ${variable}="${raw}" is not on/off for a boolean flag`
    );
  }
  if (typeof fallback === "number") {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      throw new Error(`launchgate: ${variable}="${raw}" is not a number`);
    }
    return n;
  }
  return trimmed;
}
function defaultRead(name) {
  const proc = globalThis.process;
  return proc?.env?.[name];
}
function envOverride(options = {}) {
  const read = options.read ?? defaultRead;
  const prefix = options.prefix ?? "FLAG_";
  return {
    name: "envOverride",
    decide({ key, def }) {
      const variable = prefix + envName(key);
      const raw = read(variable);
      if (raw === void 0 || raw === "") return void 0;
      return parseAs(raw, def.fallback, variable);
    }
  };
}
function envDefault(options) {
  const { env } = options;
  return {
    name: "envDefault",
    decide({ def }) {
      const current = typeof env === "function" ? env() : env;
      return def.byEnv?.[current];
    }
  };
}

// src/sources/subject.ts
function offValue(flag) {
  return typeof flag.def.fallback === "boolean" ? false : flag.def.fallback;
}
function subjectStore(options) {
  const { load, requiresOptIn } = options;
  const caches = /* @__PURE__ */ new WeakMap();
  function read(flag, ctx, subject) {
    let cache = caches.get(ctx);
    if (!cache) {
      cache = /* @__PURE__ */ new Map();
      caches.set(ctx, cache);
    }
    const cacheKey = `${subject}\0${flag.key}`;
    let pending = cache.get(cacheKey);
    if (!pending) {
      pending = Promise.resolve(load(subject, flag.key, flag));
      cache.set(cacheKey, pending);
    }
    return pending;
  }
  function source(name, decide, applies = () => true) {
    return {
      name,
      async decide(flag, ctx) {
        if (!ctx.subject || !applies(flag)) return void 0;
        const state = await read(flag, ctx, ctx.subject);
        return state ? decide(state, flag) : decide({}, flag);
      }
    };
  }
  return {
    state: async (flag, ctx) => ctx.subject ? read(flag, ctx, ctx.subject) : void 0,
    kill: source(
      "subjectKill",
      (state, flag) => state.override === "disabled" ? offValue(flag) : void 0
    ),
    requireOptIn: source(
      "subjectOptIn",
      (state, flag) => state.optedIn ? void 0 : offValue(flag),
      (flag) => requiresOptIn?.(flag) === true
    ),
    grant: source("subjectGrant", (state, flag) => {
      if (state.override !== "enabled") return void 0;
      if (state.value !== void 0) return state.value;
      return typeof flag.def.fallback === "boolean" ? true : void 0;
    })
  };
}

// src/testing.ts
function withFlags(flags, values = {}) {
  return createResolver({
    flags,
    sources: [
      {
        name: "withFlags",
        decide: ({ key }) => values[key]
      }
    ]
  });
}
export {
  DEFAULT_OVERRIDE_COOKIE,
  cookieOverride,
  createResolver,
  defineFlags,
  envDefault,
  envOverride,
  readOverrides,
  signOverrides,
  subjectStore,
  withFlags
};
