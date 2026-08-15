import { defineConfig } from "tsup";

// Subpaths (./next, ./postgres) are added here as they land — ADR 0001 Decision 7
// keeps framework specifics out of the core entry point.
export default defineConfig({
	entry: ["src/index.ts", "src/next/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	target: "es2022",
});
