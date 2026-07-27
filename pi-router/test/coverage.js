import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePrefix = `${pathToFileURL(join(packageRoot, "src")).href}/`;
const coverageDir = await mkdtemp(join(tmpdir(), "pi-router-coverage-"));
const MINIMUM_COVERAGE = 82.8;

try {
	const exitCode = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(packageRoot, "test", "runner.js"), "all"], {
			cwd: packageRoot,
			env: { ...process.env, NODE_V8_COVERAGE: coverageDir },
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			resolve(signal ? 1 : (code ?? 1));
		});
	});
	if (exitCode !== 0) {
		process.exitCode = exitCode;
	} else {
		const scripts = new Map();
		for (const name of await readdir(coverageDir)) {
			if (!name.endsWith(".json")) {
				continue;
			}
			const report = JSON.parse(await readFile(join(coverageDir, name), "utf8"));
			for (const script of report.result ?? []) {
				if (script.url.startsWith(sourcePrefix)) {
					scripts.set(script.url, script);
				}
			}
		}

		let covered = 0;
		let total = 0;
		for (const [url, script] of scripts) {
			let fileCovered = 0;
			let fileTotal = 0;
			const source = await readFile(fileURLToPath(url), "utf8");
			let offset = 0;
			for (const line of source.split("\n")) {
				const firstCode = line.search(/\S/u);
				const executable = firstCode >= 0
					&& !line.trimStart().startsWith("//")
					&& !["}", "};", "];"].includes(line.trim());
				if (executable) {
					const point = offset + firstCode;
					const ranges = script.functions
						.flatMap((entry) => entry.ranges)
						.filter((range) => range.startOffset <= point && range.endOffset > point)
						.sort((left, right) =>
							(left.endOffset - left.startOffset) - (right.endOffset - right.startOffset),
						);
					total += 1;
					fileTotal += 1;
					if (ranges[0]?.count > 0) {
						covered += 1;
						fileCovered += 1;
					}
				}
				offset += line.length + 1;
			}
			const filePercentage = fileTotal === 0 ? 0 : (fileCovered / fileTotal) * 100;
			process.stdout.write(
				`${fileURLToPath(url).slice(packageRoot.length + 1)}: ${fileCovered}/${fileTotal} (${filePercentage.toFixed(1)}%)\n`,
			);
		}
		const percentage = total === 0 ? 0 : (covered / total) * 100;
		process.stdout.write(
			`pi-router source line coverage: ${covered}/${total} (${percentage.toFixed(1)}%)\n`,
		);
		if (percentage < MINIMUM_COVERAGE) {
			process.stderr.write(
				`pi-router source line coverage is below ${MINIMUM_COVERAGE}%.\n`,
			);
			process.exitCode = 1;
		}
	}
} finally {
	await rm(coverageDir, { recursive: true, force: true });
}
