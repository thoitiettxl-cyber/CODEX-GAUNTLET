const groups = {
	unit: [
		"paths.test.js",
		"responses.test.js",
		"pi-runtime.test.js",
		"management.test.js",
		"cli.test.js",
		"update.test.js",
		"agentrouter-config.test.js",
	],
	integration: ["server.test.js"],
	acceptance: ["acceptance.test.js", "runtime-load.test.js"],
	mutation: ["server.test.js", "cli.test.js", "update.test.js"],
	all: [
		"paths.test.js",
		"responses.test.js",
		"pi-runtime.test.js",
		"management.test.js",
		"cli.test.js",
		"update.test.js",
		"agentrouter-config.test.js",
		"server.test.js",
		"acceptance.test.js",
		"runtime-load.test.js",
	],
};

const selected = process.argv[2] ?? "all";
const files = groups[selected];
if (!files) {
	throw new Error(`Unknown test group '${selected}'.`);
}
await Promise.all(files.map((file) => import(`./${file}`)));
