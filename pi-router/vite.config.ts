import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
	readFileSync(resolve(packageRoot, "package.json"), "utf8"),
) as { version: string };

export default defineConfig({
	root: resolve(packageRoot, "web"),
	plugins: [
		react(),
		viteSingleFile({ removeViteModuleLoader: true }),
	],
	define: {
		__PI_ROUTER_UI_VERSION__: JSON.stringify(packageJson.version),
	},
	css: {
		modules: {
			localsConvention: "camelCase",
			generateScopedName: "pi_[name]__[local]___[hash:base64:5]",
		},
	},
	build: {
		target: "es2020",
		outDir: "dist",
		assetsInlineLimit: 100_000_000,
		chunkSizeWarningLimit: 100_000_000,
		cssCodeSplit: false,
		emptyOutDir: true,
		rolldownOptions: {
			output: {
				codeSplitting: false,
			},
		},
	},
});
