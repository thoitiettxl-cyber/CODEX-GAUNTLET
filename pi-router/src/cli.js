#!/data/data/com.termux/files/usr/bin/node

import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { RouterError } from "./errors.js";
import { createManagementService } from "./management/index.js";
import { PiRuntime } from "./pi-runtime.js";
import { ensureStatePaths, statePaths } from "./paths.js";
import { createPiRouterServer, listenPiRouter } from "./server.js";
import { GithubUpdateManager } from "./update.js";
import { BINARY_BUILD, VERSION } from "./version.js";

const HELP = `pi-router - local OpenAI Responses gateway backed by Pi providers

Pi Router Management Center: providers, auth, quota, logs, config, and verified releases.

Usage:
  pi-router serve [--host 127.0.0.1] [--port 8318] [--account NAME] [--state-dir PATH]
  pi-router login PROVIDER [--type api_key|oauth] [--account NAME] [--state-dir PATH]
  pi-router logout PROVIDER [--account NAME] [--state-dir PATH]
  pi-router models [--account NAME] [--state-dir PATH]
  pi-router status [--account NAME] [--state-dir PATH]
  pi-router update check
  pi-router update install VERSION
  pi-router update rollback
  pi-router --version
  pi-router help

Environment:
  PI_ROUTER_API_KEY        Required by serve; clients send it as a Bearer token.
  PI_ROUTER_STATE_DIR      Overrides the default ~/.local/state/pi-router state directory.
  PI_ROUTER_MODEL_NETWORK  Set to 1 to allow Pi remote model-catalog refreshes.
  PI_ROUTER_AUTO_UPDATE    Set to 1 for verified background install in the packaged binary.
`;

function takeValue(argv, index, name) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new RouterError(`${name} requires a value.`, {
			status: 400,
			code: "missing_argument",
			type: "invalid_request_error",
		});
	}
	return value;
}

export function parseArgs(argv) {
	const args = [...argv];
	const requestedCommand = args.shift() ?? "help";
	const command = ["--version", "-V"].includes(requestedCommand) ? "version" : requestedCommand;
	const parsed = {
		command,
		host: "127.0.0.1",
		port: 8318,
		account: "default",
		stateDir: undefined,
		authType: "api_key",
		provider: undefined,
		updateAction: undefined,
		updateVersion: undefined,
	};

	if (["login", "logout"].includes(command) && args[0] && !args[0].startsWith("--")) {
		parsed.provider = args.shift();
	}
	if (command === "update" && args[0] && !args[0].startsWith("--")) {
		parsed.updateAction = args.shift();
		if (parsed.updateAction === "install" && args[0] && !args[0].startsWith("--")) {
			parsed.updateVersion = args.shift();
		}
	}

	for (let index = 0; index < args.length; index += 1) {
		const name = args[index];
		switch (name) {
			case "--host":
				parsed.host = takeValue(args, index, name);
				index += 1;
				break;
			case "--port": {
				const value = takeValue(args, index, name);
				parsed.port = Number(value);
				index += 1;
				break;
			}
			case "--account":
				parsed.account = takeValue(args, index, name);
				index += 1;
				break;
			case "--state-dir":
				parsed.stateDir = takeValue(args, index, name);
				index += 1;
				break;
			case "--type":
				parsed.authType = takeValue(args, index, name);
				index += 1;
				break;
			case "--help":
			case "-h":
				parsed.command = "help";
				break;
			default:
				throw new RouterError(`Unknown argument '${name}'.`, {
					status: 400,
					code: "unknown_argument",
					type: "invalid_request_error",
				});
		}
	}

	if (["login", "logout"].includes(command) && !parsed.provider) {
		throw new RouterError(`${command} requires a provider id.`, {
			status: 400,
			code: "missing_provider",
			type: "invalid_request_error",
		});
	}
	if (!["api_key", "oauth"].includes(parsed.authType)) {
		throw new RouterError("--type must be api_key or oauth.", {
			status: 400,
			code: "invalid_auth_type",
			type: "invalid_request_error",
		});
	}
	if (command === "update" && !["check", "install", "rollback"].includes(parsed.updateAction)) {
		throw new RouterError("update requires check, install VERSION, or rollback.", {
			status: 400,
			code: "invalid_update_action",
			type: "invalid_request_error",
		});
	}
	if (command === "update" && parsed.updateAction === "install" && !parsed.updateVersion) {
		throw new RouterError("update install requires a version.", {
			status: 400,
			code: "missing_update_version",
			type: "invalid_request_error",
		});
	}
	return parsed;
}

async function promptSecret(message, prompt, input, output) {
	if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
		throw new Error("Secret prompts require an interactive TTY.");
	}
	if (prompt.signal?.aborted) {
		throw new Error("Login cancelled");
	}
	output.write(`${message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `);
	input.setRawMode(true);
	input.resume();
	let value = "";
	const onAbort = () => input.emit("data", Buffer.from([3]));
	prompt.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		for (;;) {
			const [chunk] = await once(input, "data");
			const text = chunk.toString("utf8");
			for (const character of text) {
				if (character === "\u0003") {
					throw new Error("Login cancelled");
				}
				if (character === "\r" || character === "\n") {
					output.write("\n");
					return value;
				}
				if (character === "\u007f" || character === "\b") {
					value = value.slice(0, -1);
				} else {
					value += character;
				}
			}
		}
	} finally {
		prompt.signal?.removeEventListener("abort", onAbort);
		input.setRawMode(false);
		input.pause();
	}
}

export function createAuthInteraction({
	input = process.stdin,
	output = process.stdout,
	createReadline = (options) => createInterface(options),
} = {}) {
	return {
		async prompt(prompt) {
			if (prompt.type === "secret") {
				return promptSecret(prompt.message, prompt, input, output);
			}
			const readline = createReadline({ input, output });
			try {
				if (prompt.type === "select") {
					for (const option of prompt.options) {
						output.write(`  ${option.id}: ${option.label}\n`);
					}
				}
				const suffix = prompt.placeholder ? ` (${prompt.placeholder})` : "";
				return await readline.question(`${prompt.message}${suffix}: `, {
					signal: prompt.signal,
				});
			} finally {
				readline.close();
			}
		},
		notify(event) {
			if (event.type === "auth_url") {
				output.write(`${event.instructions ?? "Open this URL to authenticate:"}\n${event.url}\n`);
			} else if (event.type === "device_code") {
				output.write(`Open ${event.verificationUri} and enter code ${event.userCode}\n`);
			} else if (event.type === "info") {
				output.write(`${event.message}\n`);
				for (const link of event.links ?? []) {
					output.write(`${link.label ?? "More information"}: ${link.url}\n`);
				}
			} else {
				output.write(`${event.message}\n`);
			}
		},
	};
}

function runtimeOptions(parsed, env) {
	const paths = statePaths({
		stateDir: parsed.stateDir ?? env.PI_ROUTER_STATE_DIR,
		accountId: parsed.account,
	});
	const allowModelNetwork = env.PI_ROUTER_MODEL_NETWORK === "1";
	if (!allowModelNetwork && env.PI_OFFLINE === undefined) {
		env.PI_OFFLINE = "1";
	}
	return {
		paths,
		options: {
			authPath: paths.authPath,
			modelsPath: paths.modelsPath,
			allowModelNetwork,
		},
	};
}

export async function runCli(
	argv,
	{
		env = process.env,
		input = process.stdin,
		output = process.stdout,
		createRuntime = (options) => PiRuntime.create(options),
		createUpdater = (options) => new GithubUpdateManager(options),
		createServer = createPiRouterServer,
		listen = listenPiRouter,
	} = {},
) {
	const parsed = parseArgs(argv);
	if (parsed.command === "help") {
		output.write(HELP);
		return { command: "help" };
	}
	if (parsed.command === "version") {
		output.write(`pi-router ${VERSION}\n`);
		return { command: "version", version: VERSION };
	}
	if (!["serve", "login", "logout", "models", "status", "update"].includes(parsed.command)) {
		throw new RouterError(`Unknown command '${parsed.command}'.`, {
			status: 400,
			code: "unknown_command",
			type: "invalid_request_error",
		});
	}
	if (
		parsed.command === "serve"
		&& (typeof env.PI_ROUTER_API_KEY !== "string" || env.PI_ROUTER_API_KEY.trim().length === 0)
	) {
		throw new RouterError("PI_ROUTER_API_KEY is required by the serve command.", {
			status: 400,
			code: "missing_api_key",
			type: "authentication_error",
		});
	}

	const updater = createUpdater({
		automatic: env.PI_ROUTER_AUTO_UPDATE === "1",
		binaryPath: BINARY_BUILD ? process.execPath : null,
	});
	if (parsed.command === "update") {
		let result;
		if (parsed.updateAction === "check") {
			result = await updater.check();
		} else if (parsed.updateAction === "install") {
			result = await updater.install(parsed.updateVersion);
		} else {
			result = await updater.rollback();
		}
		output.write(`${JSON.stringify(result, null, 2)}\n`);
		return { command: "update", action: parsed.updateAction, result };
	}

	const { paths, options } = runtimeOptions(parsed, env);
	await ensureStatePaths(paths);
	const runtime = await createRuntime(options);

	if (parsed.command === "login") {
		const interaction = createAuthInteraction({ input, output });
		await runtime.login(parsed.provider, parsed.authType, interaction);
		output.write(`Authentication saved for provider '${parsed.provider}' in account '${paths.account}'.\n`);
		return { command: "login", account: paths.account };
	}
	if (parsed.command === "logout") {
		await runtime.logout(parsed.provider);
		output.write(`Authentication removed for provider '${parsed.provider}' in account '${paths.account}'.\n`);
		return { command: "logout", account: paths.account };
	}
	if (parsed.command === "models") {
		const models = await runtime.listModels();
		for (const model of models) {
			output.write(`${model.provider}/${model.id}\n`);
		}
		return { command: "models", count: models.length };
	}
	if (parsed.command === "status") {
		const management = createManagementService({
			runtime,
			account: paths.account,
			updater,
			modelsPath: paths.modelsPath,
		});
		const result = await management.status();
		output.write(`${JSON.stringify(result, null, 2)}\n`);
		return { command: "status", result };
	}

	const apiKey = env.PI_ROUTER_API_KEY;
	const server = createServer({
		runtime,
		apiKey,
		account: paths.account,
		updater,
		modelsPath: paths.modelsPath,
	});
	const address = await listen(server, { host: parsed.host, port: parsed.port });
	const displayHost = typeof address === "object" && address?.family === "IPv6"
		? `[${address.address}]`
		: address.address;
	const baseUrl = `http://${displayHost}:${address.port}`;
	output.write(`pi-router listening on ${baseUrl}\n`);
	output.write(`pi-router management center: ${baseUrl}/management.html\n`);
	if (updater.automatic && updater.binaryPath) {
		void updater.autoInstall().then((result) => {
			if (result.status === "installed") {
				output.write(`pi-router update ${result.version} installed; restart to activate it.\n`);
			}
		}).catch((error) => {
			const message = error instanceof Error ? error.message : "Update check failed.";
			output.write(`pi-router automatic update skipped: ${message}\n`);
		});
	}
	return { command: "serve", server, address, updater };
}

async function main() {
	try {
		await runCli(process.argv.slice(2));
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		process.stderr.write(`pi-router: ${message}\n`);
		process.exitCode = 1;
	}
}

if (
	BINARY_BUILD
	|| (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
) {
	void main();
}
