// Bundles the server into dist/, for its image (see the Dockerfile): one
// file with only the code it runs, so no node_modules, and no tsx. Run with
// `pnpm build`.
import { readFileSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { build, type Plugin } from "esbuild";
import { snapsyncBuildContract } from "./src/buildContract.ts";

/**
 * Automerge's Node build loads its WebAssembly from a file next to it; its
 * base64 build, next to that, has it inline.
 */
const automergeInline: Plugin = {
  name: "automerge-inline",
  setup(builder) {
    builder.onResolve({ filter: /^@automerge\/automerge$/ }, async (args) => {
      if (args.pluginData === "inner") return undefined;
      const node = await builder.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
        importer: args.importer,
        pluginData: "inner",
      });
      return {
        path: node.path.replace(/fullfat_node\.js$/, "fullfat_base64.js"),
      };
    });
  },
};

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // For stack traces: positions only, not the sources.
  sourcemap: true,
  sourcesContent: false,
  legalComments: "none",
  plugins: [automergeInline],
  // CommonJS dependencies require() things.
  banner: {
    js: 'import { createRequire as bundleRequire } from "node:module"; const require = bundleRequire(import.meta.url);',
  },
});
// Read at run time by snapsync's install (`../extension/` from its module,
// so from dist/main.js too).
const contract = snapsyncBuildContract({
  packageJson: readFileSync("../snapsync/package.json", "utf8"),
  control: readFileSync("../snapsync/extension/snapsync.control", "utf8"),
  server: readFileSync("../snapsync/src/server.ts", "utf8"),
  dockerfile: readFileSync("../../Dockerfile", "utf8"),
});
await cp(contract.extensionDirectory, "extension", { recursive: true });
