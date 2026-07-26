import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = resolve(packageRoot, "web/shell.html");
const outputPath = resolve(packageRoot, "web/dist/index.html");

const result = await build({
	entryPoints: [resolve(packageRoot, "web/src/main.tsx")],
	bundle: true,
	format: "iife",
	jsx: "automatic",
	legalComments: "inline",
	minify: true,
	outdir: resolve(packageRoot, "web/.build"),
	platform: "browser",
	target: ["es2022"],
	write: false,
});

const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"));
const stylesheet = result.outputFiles.find((file) => file.path.endsWith(".css"));
if (!javascript || !stylesheet) {
	throw new Error("Web build did not produce both JavaScript and CSS.");
}

const template = await readFile(templatePath, "utf8");
const html = template
	.replace("/*__PI_ROUTER_CSS__*/", () => stylesheet.text)
	.replace(
		"/*__PI_ROUTER_JS__*/",
		() => javascript.text.replaceAll(/<\/script/gi, "<\\/script"),
	);
if (
	html === template
	|| html.includes("/*__PI_ROUTER_CSS__*/")
	|| html.includes("/*__PI_ROUTER_JS__*/")
) {
	throw new Error(
		`Web shell placeholders were not replaced (unchanged=${html === template}, css=${
			html.includes("/*__PI_ROUTER_CSS__*/")
		}, js=${html.includes("/*__PI_ROUTER_JS__*/")}).`,
	);
}

if (process.argv.includes("--check")) {
	let current;
	try {
		current = await readFile(outputPath, "utf8");
	} catch {
		throw new Error("Management HTML is missing. Run npm --prefix pi-router run build:web.");
	}
	if (current !== html) {
		throw new Error("Management HTML is stale. Run npm --prefix pi-router run build:web.");
	}
	process.stdout.write(`Checked ${outputPath}\n`);
} else {
	await mkdir(dirname(outputPath), { recursive: true });
	const temporaryPath = `${outputPath}.tmp`;
	await writeFile(temporaryPath, html, { encoding: "utf8", mode: 0o644 });
	await rename(temporaryPath, outputPath);
	process.stdout.write(`Built ${outputPath}\n`);
}
