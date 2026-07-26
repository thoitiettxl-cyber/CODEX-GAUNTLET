import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type ConnectionPhase = "checking" | "disconnected" | "ready" | "rejected" | "offline";
type RunPhase = "idle" | "running" | "completed" | "failed" | "cancelled";
type EditorMode = "compose" | "raw";
type OutputMode = "result" | "events" | "json";
type TemplateId = "text" | "reasoning" | "tool";
type WorkspaceView = "overview" | "probe" | "updates";
type UpdatePhase = "idle" | "checking" | "installing" | "rolling-back" | "completed" | "failed";

interface Health {
	status: string;
	service: string;
	version: string;
}

interface Model {
	id: string;
	object: string;
	created: number;
	owned_by: string;
}

interface SseEvent extends Record<string, unknown> {
	type: string;
	sequence_number?: number;
	response?: unknown;
	delta?: string;
}

interface RunState {
	phase: RunPhase;
	startedAt: number | null;
	durationMs: number | null;
	httpStatus: number | null;
	contentType: string;
	request: Record<string, unknown> | null;
	response: unknown;
	events: SseEvent[];
	outputText: string;
	error: string;
}

interface RequestDraft {
	model: string;
	input: string;
	instructions: string;
	maxOutputTokens: string;
	reasoningEffort: string;
	stream: boolean;
	toolsJson: string;
}

interface ManagementStatus {
	object: "pi_router.management_status";
	service: {
		name: string;
		version: string;
		status: string;
		uptime_seconds: number;
	};
	runtime: {
		mode: "source" | "termux-binary";
		node: string;
		platform: string;
		arch: string;
	};
	account: {
		id: string;
		available_models: number;
	};
	update: {
		repository: string;
		channel: string;
		automatic: boolean;
		install_supported: boolean;
		rollback_available: boolean;
		restart_required: boolean;
		pending_version: string | null;
	};
}

interface UpdateCandidate {
	status: "available" | "current";
	current_version: string;
	latest_version: string;
	published_at: string | null;
	release_url: string;
	asset: {
		name: string;
		size: number;
	};
}

interface UpdateRun {
	phase: UpdatePhase;
	message: string;
}

const EMPTY_RUN: RunState = {
	phase: "idle",
	startedAt: null,
	durationMs: null,
	httpStatus: null,
	contentType: "",
	request: null,
	response: null,
	events: [],
	outputText: "",
	error: "",
};

const DEFAULT_TOOLS = JSON.stringify(
	[
		{
			type: "function",
			name: "lookup_weather",
			description: "Look up current weather for one city.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					city: { type: "string", description: "City name" },
				},
				required: ["city"],
				additionalProperties: false,
			},
		},
	],
	null,
	2,
);

const INITIAL_DRAFT: RequestDraft = {
	model: "",
	input: "Reply with one short sentence that confirms the route is working.",
	instructions: "",
	maxOutputTokens: "256",
	reasoningEffort: "",
	stream: true,
	toolsJson: "",
};

const EMPTY_UPDATE_RUN: UpdateRun = {
	phase: "idle",
	message: "Release checks run only when you ask.",
};

const TEMPLATE_LABELS: Record<TemplateId, { label: string; description: string }> = {
	text: {
		label: "Text probe",
		description: "A small streaming response",
	},
	reasoning: {
		label: "Reasoning",
		description: "Reasoning effort and token cap",
	},
	tool: {
		label: "Function call",
		description: "Strict JSON Schema tool",
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagementStatus(value: unknown): value is ManagementStatus {
	return (
		isRecord(value)
		&& value.object === "pi_router.management_status"
		&& isRecord(value.service)
		&& typeof value.service.name === "string"
		&& typeof value.service.version === "string"
		&& typeof value.service.status === "string"
		&& typeof value.service.uptime_seconds === "number"
		&& isRecord(value.runtime)
		&& ["source", "termux-binary"].includes(String(value.runtime.mode))
		&& typeof value.runtime.node === "string"
		&& typeof value.runtime.platform === "string"
		&& typeof value.runtime.arch === "string"
		&& isRecord(value.account)
		&& typeof value.account.id === "string"
		&& typeof value.account.available_models === "number"
		&& isRecord(value.update)
		&& typeof value.update.repository === "string"
		&& typeof value.update.channel === "string"
		&& typeof value.update.automatic === "boolean"
		&& typeof value.update.install_supported === "boolean"
		&& typeof value.update.rollback_available === "boolean"
		&& typeof value.update.restart_required === "boolean"
		&& (value.update.pending_version === null || typeof value.update.pending_version === "string")
	);
}

function isUpdateCandidate(value: unknown): value is UpdateCandidate {
	return (
		isRecord(value)
		&& ["available", "current"].includes(String(value.status))
		&& typeof value.current_version === "string"
		&& typeof value.latest_version === "string"
		&& (value.published_at === null || typeof value.published_at === "string")
		&& typeof value.release_url === "string"
		&& isRecord(value.asset)
		&& typeof value.asset.name === "string"
		&& typeof value.asset.size === "number"
	);
}

function errorMessage(payload: unknown, fallback: string): string {
	if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
		return payload.error.message;
	}
	if (isRecord(payload) && typeof payload.message === "string") {
		return payload.message;
	}
	if (typeof payload === "string" && payload.trim()) {
		return payload;
	}
	return fallback;
}

function responseStatus(payload: unknown): string {
	return isRecord(payload) && typeof payload.status === "string" ? payload.status : "";
}

function responseUsage(payload: unknown): Record<string, unknown> | null {
	return isRecord(payload) && isRecord(payload.usage) ? payload.usage : null;
}

function outputItems(payload: unknown): Record<string, unknown>[] {
	if (!isRecord(payload) || !Array.isArray(payload.output)) {
		return [];
	}
	return payload.output.filter(isRecord);
}

function textFromResponse(payload: unknown): string {
	const text: string[] = [];
	for (const item of outputItems(payload)) {
		if (!Array.isArray(item.content)) {
			continue;
		}
		for (const part of item.content) {
			if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
				text.push(part.text);
			}
		}
	}
	return text.join("\n");
}

function functionCalls(payload: unknown): Record<string, unknown>[] {
	return outputItems(payload).filter((item) => item.type === "function_call");
}

function formatJson(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function formatDuration(durationMs: number | null): string {
	if (durationMs === null) {
		return "—";
	}
	if (durationMs < 1000) {
		return `${durationMs} ms`;
	}
	return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 2 : 1)} s`;
}

function formatUptime(seconds: number): string {
	if (seconds < 60) {
		return `${Math.floor(seconds)} sec`;
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)} min`;
	}
	if (seconds < 86_400) {
		return `${Math.floor(seconds / 3600)} hr ${Math.floor((seconds % 3600) / 60)} min`;
	}
	return `${Math.floor(seconds / 86_400)} d ${Math.floor((seconds % 86_400) / 3600)} hr`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) {
		return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildCurl(origin: string, body: Record<string, unknown>): string {
	return [
		`curl -sS ${shellQuote(`${origin}/v1/responses`)} \\`,
		"  -H 'Authorization: Bearer '\"$PI_ROUTER_API_KEY\" \\",
		"  -H 'Content-Type: application/json' \\",
		`  --data-binary ${shellQuote(JSON.stringify(body))}`,
	].join("\n");
}

async function readPayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function parseSseFrame(frame: string): SseEvent | null {
	let eventName = "";
	const data: string[] = [];
	for (const line of frame.split("\n")) {
		if (line.startsWith("event:")) {
			eventName = line.slice("event:".length).trim();
		} else if (line.startsWith("data:")) {
			data.push(line.slice("data:".length).trimStart());
		}
	}
	const rawData = data.join("\n");
	if (!rawData || rawData === "[DONE]") {
		return null;
	}
	const parsed: unknown = JSON.parse(rawData);
	if (!isRecord(parsed)) {
		throw new Error("SSE data was not a JSON object.");
	}
	return {
		...parsed,
		type: typeof parsed.type === "string" ? parsed.type : eventName || "message",
	};
}

async function consumeSse(
	response: Response,
	onEvent: (event: SseEvent) => void,
): Promise<void> {
	if (!response.body) {
		throw new Error("The browser did not expose the response stream.");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const consumeFrames = (flush: boolean) => {
		buffer = buffer.replaceAll("\r\n", "\n");
		for (;;) {
			const boundary = buffer.indexOf("\n\n");
			if (boundary < 0) {
				break;
			}
			const frame = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			const event = parseSseFrame(frame);
			if (event) {
				onEvent(event);
			}
		}
		if (flush && buffer.trim()) {
			const event = parseSseFrame(buffer);
			if (event) {
				onEvent(event);
			}
			buffer = "";
		}
	};

	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			buffer += decoder.decode();
			consumeFrames(true);
			return;
		}
		buffer += decoder.decode(value, { stream: true });
		consumeFrames(false);
	}
}

async function copyText(value: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}
	const field = document.createElement("textarea");
	field.value = value;
	field.setAttribute("readonly", "");
	field.className = "clipboard-proxy";
	document.body.append(field);
	field.select();
	const copied = document.execCommand("copy");
	field.remove();
	if (!copied) {
		throw new Error("Clipboard access is unavailable.");
	}
}

function Icon({
	name,
	size = 18,
}: {
	name: "arrow" | "check" | "copy" | "eye" | "eyeOff" | "play" | "refresh" | "stop";
	size?: number;
}) {
	const paths: Record<typeof name, React.ReactNode> = {
		arrow: <path d="m5 12 5-5 5 5M10 7v10" />,
		check: <path d="m4.5 10 3.25 3.25L15.5 5.5" />,
		copy: <><rect x="6.5" y="6.5" width="9" height="9" rx="1.5" /><path d="M4 13.5V5.25C4 4.56 4.56 4 5.25 4h8.25" /></>,
		eye: <><path d="M2.5 10s2.7-4.25 7.5-4.25S17.5 10 17.5 10 14.8 14.25 10 14.25 2.5 10 2.5 10Z" /><circle cx="10" cy="10" r="2" /></>,
		eyeOff: <><path d="m3 3 14 14M8.7 5.86A8.2 8.2 0 0 1 10 5.75c4.8 0 7.5 4.25 7.5 4.25a12.3 12.3 0 0 1-2.1 2.55M11.7 14.08c-.54.11-1.1.17-1.7.17C5.2 14.25 2.5 10 2.5 10a12 12 0 0 1 2.18-2.61" /></>,
		play: <path d="m7 5 8 5-8 5V5Z" />,
		refresh: <><path d="M15.4 7A6 6 0 1 0 16 11" /><path d="M12.5 7H16V3.5" /></>,
		stop: <rect x="6" y="6" width="8" height="8" rx="1" />,
	};
	return (
		<svg
			aria-hidden="true"
			className="icon"
			fill="none"
			height={size}
			viewBox="0 0 20 20"
			width={size}
		>
			<g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6">
				{paths[name]}
			</g>
		</svg>
	);
}

function App() {
	const origin = window.location.origin;
	const [apiKey, setApiKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [connection, setConnection] = useState<ConnectionPhase>("checking");
	const [health, setHealth] = useState<Health | null>(null);
	const [models, setModels] = useState<Model[]>([]);
	const [connectionMessage, setConnectionMessage] = useState("Checking the local route…");
	const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("overview");
	const [management, setManagement] = useState<ManagementStatus | null>(null);
	const [updateCandidate, setUpdateCandidate] = useState<UpdateCandidate | null>(null);
	const [updateRun, setUpdateRun] = useState<UpdateRun>(EMPTY_UPDATE_RUN);
	const [installConfirmation, setInstallConfirmation] = useState("");
	const [draft, setDraft] = useState<RequestDraft>(INITIAL_DRAFT);
	const [activeTemplate, setActiveTemplate] = useState<TemplateId>("text");
	const [editorMode, setEditorMode] = useState<EditorMode>("compose");
	const [rawRequest, setRawRequest] = useState("");
	const [outputMode, setOutputMode] = useState<OutputMode>("result");
	const [run, setRun] = useState<RunState>(EMPTY_RUN);
	const [notice, setNotice] = useState("");
	const abortRef = useRef<AbortController | null>(null);

	const updateDraft = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => {
		setDraft((current) => ({ ...current, [key]: value }));
	};

	const createRequest = useCallback((): Record<string, unknown> => {
		const body: Record<string, unknown> = {
			model: draft.model,
			input: draft.input,
			stream: draft.stream,
		};
		if (draft.instructions.trim()) {
			body.instructions = draft.instructions.trim();
		}
		if (draft.maxOutputTokens.trim()) {
			const value = Number(draft.maxOutputTokens);
			if (!Number.isSafeInteger(value) || value <= 0) {
				throw new Error("Max output tokens must be a positive integer.");
			}
			body.max_output_tokens = value;
		}
		if (draft.reasoningEffort) {
			body.reasoning = { effort: draft.reasoningEffort };
		}
		if (draft.toolsJson.trim()) {
			const tools: unknown = JSON.parse(draft.toolsJson);
			if (!Array.isArray(tools)) {
				throw new Error("Tools JSON must be an array.");
			}
			body.tools = tools;
		}
		return body;
	}, [draft]);

	const checkHealth = useCallback(async () => {
		setConnection("checking");
		setConnectionMessage("Checking the local route…");
		try {
			const response = await fetch("/health", {
				cache: "no-store",
				credentials: "omit",
				headers: { accept: "application/json" },
			});
			const payload = await readPayload(response);
			if (!response.ok || !isRecord(payload)) {
				throw new Error(errorMessage(payload, `Health check returned HTTP ${response.status}.`));
			}
			const nextHealth: Health = {
				status: typeof payload.status === "string" ? payload.status : "unknown",
				service: typeof payload.service === "string" ? payload.service : "pi-router",
				version: typeof payload.version === "string" ? payload.version : "unknown",
			};
			setHealth(nextHealth);
			setConnection("disconnected");
			setConnectionMessage("Route found. Enter the local bearer to load models.");
		} catch (error) {
			setHealth(null);
			setConnection("offline");
			setConnectionMessage(error instanceof Error ? error.message : "Pi Router is unreachable.");
		}
	}, []);

	useEffect(() => {
		void checkHealth();
	}, [checkHealth]);

	const authenticatedRequest = useCallback(async (
		path: string,
		method = "GET",
		body?: Record<string, unknown>,
	): Promise<unknown> => {
		const response = await fetch(path, {
			method,
			cache: "no-store",
			credentials: "omit",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${apiKey}`,
				...(body ? { "content-type": "application/json" } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		const payload = await readPayload(response);
		if (!response.ok) {
			throw new Error(errorMessage(payload, `${path} returned HTTP ${response.status}.`));
		}
		return payload;
	}, [apiKey]);

	const connect = useCallback(async () => {
		if (!apiKey.trim()) {
			setConnection("rejected");
			setConnectionMessage("Enter PI_ROUTER_API_KEY to authenticate.");
			return;
		}
		setConnection("checking");
		setConnectionMessage("Authenticating and reading local runtime state…");
		try {
			const [modelsPayload, managementPayload] = await Promise.all([
				authenticatedRequest("/v1/models"),
				authenticatedRequest("/management/api/status"),
			]);
			if (!isRecord(modelsPayload) || !Array.isArray(modelsPayload.data)) {
				throw new Error("Model discovery returned an unexpected payload.");
			}
			if (!isManagementStatus(managementPayload)) {
				throw new Error("Management status returned an unexpected payload.");
			}
			const nextModels = modelsPayload.data.filter((model): model is Model => (
				isRecord(model)
				&& typeof model.id === "string"
				&& typeof model.owned_by === "string"
				&& typeof model.object === "string"
				&& typeof model.created === "number"
			));
			setModels(nextModels);
			setManagement(managementPayload);
			setDraft((current) => ({
				...current,
				model: nextModels.some((model) => model.id === current.model)
					? current.model
					: nextModels[0]?.id ?? "",
			}));
			setConnection("ready");
			setConnectionMessage(
				nextModels.length
					? `${nextModels.length} model${nextModels.length === 1 ? "" : "s"} ready in account ${managementPayload.account.id}.`
					: "Authenticated, but this account has no available models.",
			);
		} catch (error) {
			setModels([]);
			setManagement(null);
			setUpdateCandidate(null);
			setConnection("rejected");
			setConnectionMessage(error instanceof Error ? error.message : "Authentication failed.");
		}
	}, [apiKey, authenticatedRequest]);

	const refreshManagement = useCallback(async (announce = true) => {
		if (!apiKey.trim()) {
			setConnection("rejected");
			setConnectionMessage("Connect with PI_ROUTER_API_KEY before reading management state.");
			return;
		}
		if (announce) {
			setUpdateRun({ phase: "checking", message: "Refreshing local runtime state…" });
		}
		try {
			const payload = await authenticatedRequest("/management/api/status");
			if (!isManagementStatus(payload)) {
				throw new Error("Management status returned an unexpected payload.");
			}
			setManagement(payload);
			if (announce) {
				setUpdateRun({ phase: "completed", message: "Local runtime state refreshed." });
			}
		} catch (error) {
			setUpdateRun({
				phase: "failed",
				message: error instanceof Error ? error.message : "Management status failed.",
			});
		}
	}, [apiKey, authenticatedRequest]);

	const checkForUpdates = useCallback(async () => {
		if (connection !== "ready") {
			setConnectionMessage("Connect before checking GitHub releases.");
			return;
		}
		setWorkspaceView("updates");
		setInstallConfirmation("");
		setUpdateRun({ phase: "checking", message: "Checking stable GitHub releases…" });
		try {
			const payload = await authenticatedRequest("/management/api/updates/check", "POST");
			if (!isUpdateCandidate(payload)) {
				throw new Error("Release check returned an unexpected payload.");
			}
			setUpdateCandidate(payload);
			setUpdateRun({
				phase: "completed",
				message: payload.status === "available"
					? `Version ${payload.latest_version} is ready for review.`
					: `Version ${payload.current_version} is current.`,
			});
		} catch (error) {
			setUpdateCandidate(null);
			setUpdateRun({
				phase: "failed",
				message: error instanceof Error ? error.message : "Release check failed.",
			});
		}
	}, [authenticatedRequest, connection]);

	const installUpdate = useCallback(async () => {
		if (!updateCandidate || updateCandidate.status !== "available") {
			return;
		}
		if (installConfirmation !== updateCandidate.latest_version) {
			setInstallConfirmation(updateCandidate.latest_version);
			setUpdateRun({
				phase: "idle",
				message: `Confirm installation of ${updateCandidate.latest_version}. The process must restart afterward.`,
			});
			return;
		}
		setUpdateRun({ phase: "installing", message: "Downloading and verifying the Termux binary…" });
		try {
			const payload = await authenticatedRequest(
				"/management/api/updates/install",
				"POST",
				{ version: updateCandidate.latest_version },
			);
			if (!isRecord(payload) || payload.status !== "installed") {
				throw new Error("Install returned an unexpected payload.");
			}
			setInstallConfirmation("");
			setUpdateRun({
				phase: "completed",
				message: `Version ${String(payload.version)} installed. Restart Pi Router to activate it.`,
			});
			await refreshManagement(false);
		} catch (error) {
			setInstallConfirmation("");
			setUpdateRun({
				phase: "failed",
				message: error instanceof Error ? error.message : "Update installation failed.",
			});
		}
	}, [authenticatedRequest, installConfirmation, refreshManagement, updateCandidate]);

	const rollbackUpdate = useCallback(async () => {
		setUpdateRun({ phase: "rolling-back", message: "Restoring the retained previous binary…" });
		try {
			const payload = await authenticatedRequest("/management/api/updates/rollback", "POST");
			if (!isRecord(payload) || payload.status !== "rolled_back") {
				throw new Error("Rollback returned an unexpected payload.");
			}
			setUpdateRun({
				phase: "completed",
				message: "Previous binary restored. Restart Pi Router to activate it.",
			});
			await refreshManagement(false);
		} catch (error) {
			setUpdateRun({
				phase: "failed",
				message: error instanceof Error ? error.message : "Rollback failed.",
			});
		}
	}, [authenticatedRequest, refreshManagement]);

	const applyTemplate = (template: TemplateId) => {
		setActiveTemplate(template);
		setEditorMode("compose");
		setRun(EMPTY_RUN);
		setDraft((current) => {
			if (template === "tool") {
				return {
					...current,
					input: "What is the weather in Huế? Use the available function.",
					instructions: "Call the function instead of inventing weather data.",
					maxOutputTokens: "512",
					reasoningEffort: "",
					stream: true,
					toolsJson: DEFAULT_TOOLS,
				};
			}
			if (template === "reasoning") {
				return {
					...current,
					input: "Which is larger: 9.11 or 9.9? Answer with a short explanation.",
					instructions: "",
					maxOutputTokens: "512",
					reasoningEffort: "medium",
					stream: true,
					toolsJson: "",
				};
			}
			return {
				...current,
				input: "Reply with one short sentence that confirms the route is working.",
				instructions: "",
				maxOutputTokens: "256",
				reasoningEffort: "",
				stream: true,
				toolsJson: "",
			};
		});
	};

	const changeEditorMode = (mode: EditorMode) => {
		if (mode === "raw" && editorMode !== "raw") {
			try {
				setRawRequest(formatJson(createRequest()));
			} catch (error) {
				setNotice(error instanceof Error ? error.message : "The request draft is invalid.");
				return;
			}
		}
		setEditorMode(mode);
	};

	const cancelRun = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	const sendRequest = useCallback(async () => {
		if (workspaceView !== "probe") {
			return;
		}
		if (run.phase === "running") {
			return;
		}
		if (!apiKey.trim()) {
			setConnection("rejected");
			setConnectionMessage("Connect with PI_ROUTER_API_KEY before sending a request.");
			return;
		}

		let requestBody: Record<string, unknown>;
		try {
			const candidate: unknown = editorMode === "raw" ? JSON.parse(rawRequest) : createRequest();
			if (!isRecord(candidate)) {
				throw new Error("Request JSON must be an object.");
			}
			if (typeof candidate.model !== "string" || !candidate.model.trim()) {
				throw new Error("Choose a model before sending.");
			}
			requestBody = candidate;
		} catch (error) {
			setRun({
				...EMPTY_RUN,
				phase: "failed",
				error: error instanceof Error ? error.message : "The request body is invalid.",
			});
			setOutputMode("result");
			return;
		}

		const controller = new AbortController();
		abortRef.current = controller;
		const startedAt = performance.now();
		setRun({
			...EMPTY_RUN,
			phase: "running",
			startedAt,
			request: requestBody,
		});
		setOutputMode("result");
		setNotice("");

		try {
			const response = await fetch("/v1/responses", {
				method: "POST",
				cache: "no-store",
				credentials: "omit",
				headers: {
					accept: requestBody.stream === true ? "text/event-stream" : "application/json",
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(requestBody),
				signal: controller.signal,
			});
			const contentType = response.headers.get("content-type") ?? "";
			setRun((current) => ({
				...current,
				httpStatus: response.status,
				contentType,
			}));

			if (!response.ok) {
				const payload = await readPayload(response);
				throw new Error(errorMessage(payload, `Request returned HTTP ${response.status}.`));
			}

			if (contentType.startsWith("text/event-stream")) {
				let terminalResponse: unknown = null;
				let streamedText = "";
				await consumeSse(response, (event) => {
					if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
						streamedText += event.delta;
					}
					if (
						["response.completed", "response.failed", "response.incomplete"].includes(event.type)
						&& event.response !== undefined
					) {
						terminalResponse = event.response;
					}
					setRun((current) => ({
						...current,
						events: [...current.events, event],
						outputText: streamedText,
						response: terminalResponse,
					}));
				});
				if (terminalResponse === null) {
					throw new Error("The SSE stream ended without a terminal response.");
				}
				const terminalStatus = responseStatus(terminalResponse);
				setRun((current) => ({
					...current,
					phase: terminalStatus === "failed" ? "failed" : "completed",
					durationMs: Math.round(performance.now() - startedAt),
					response: terminalResponse,
					outputText: streamedText || textFromResponse(terminalResponse),
					error: terminalStatus === "failed"
						? errorMessage(terminalResponse, "The provider request failed.")
						: "",
				}));
			} else {
				const payload = await readPayload(response);
				setRun((current) => ({
					...current,
					phase: responseStatus(payload) === "failed" ? "failed" : "completed",
					durationMs: Math.round(performance.now() - startedAt),
					response: payload,
					outputText: textFromResponse(payload),
					error: responseStatus(payload) === "failed"
						? errorMessage(payload, "The provider request failed.")
						: "",
				}));
			}
		} catch (error) {
			const cancelled = controller.signal.aborted;
			setRun((current) => ({
				...current,
				phase: cancelled ? "cancelled" : "failed",
				durationMs: Math.round(performance.now() - startedAt),
				error: cancelled
					? "Request cancelled. Pi Router received the browser disconnect."
					: error instanceof Error ? error.message : "The request failed.",
			}));
		} finally {
			if (abortRef.current === controller) {
				abortRef.current = null;
			}
		}
	}, [apiKey, createRequest, editorMode, rawRequest, run.phase, workspaceView]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
				event.preventDefault();
				void sendRequest();
			}
			if (event.key === "Escape" && abortRef.current) {
				cancelRun();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [cancelRun, sendRequest]);

	useEffect(() => {
		if (!notice) {
			return;
		}
		const timeout = window.setTimeout(() => setNotice(""), 2600);
		return () => window.clearTimeout(timeout);
	}, [notice]);

	const copy = async (value: string, label: string) => {
		try {
			await copyText(value);
			setNotice(`${label} copied.`);
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "Copy failed.");
		}
	};

	const calls = useMemo(() => functionCalls(run.response), [run.response]);
	const usage = useMemo(() => responseUsage(run.response), [run.response]);
	const selectedModel = models.find((model) => model.id === draft.model);
	const routeModel = selectedModel?.id ?? (draft.model || "model pending");
	const routeTarget = workspaceView === "probe"
		? routeModel
		: workspaceView === "updates"
			? updateCandidate ? `stable / ${updateCandidate.latest_version}` : "GitHub stable"
			: management ? `${management.account.id} / ${management.account.available_models} models` : "runtime pending";
	const routeTargetLabel = workspaceView === "probe"
		? "Provider / model"
		: workspaceView === "updates" ? "Release channel" : "Account / inventory";
	const routeActive = run.phase === "running"
		|| ["checking", "installing", "rolling-back"].includes(updateRun.phase);
	const routePhase = workspaceView === "probe"
		? (run.phase === "running" ? "LIVE" : run.phase.toUpperCase())
		: workspaceView === "updates"
			? updateRun.phase.toUpperCase()
			: connection === "ready" ? "READY" : connection.toUpperCase();
	const routeMetric = workspaceView === "probe"
		? (run.durationMs === null ? "— ms" : formatDuration(run.durationMs))
		: workspaceView === "updates"
			? (management?.update.restart_required ? "RESTART" : management?.update.channel.toUpperCase() ?? "STABLE")
			: management ? formatUptime(management.service.uptime_seconds) : "—";

	return (
		<div className="app-shell" data-pi-router-ui="management-center">
			<header className="masthead">
				<div className="brand-lockup">
					<div className="brand-mark" aria-hidden="true">
						<span>π</span>
					</div>
					<div>
						<p className="eyebrow">Local provider gateway</p>
						<h1>Pi Router <span>management center</span></h1>
					</div>
				</div>
				<div className="header-status">
					<span className={`status-lamp status-${connection}`} />
					<div>
						<span className="status-label">
							{connection === "ready" ? "Route ready" : connection === "checking" ? "Checking" : "Route not ready"}
						</span>
						<span className="mono">{health ? `v${health.version}` : "health unknown"}</span>
					</div>
				</div>
				</header>

				<nav className="workspace-tabs" aria-label="Management Center sections">
					{([
						["overview", "Overview", "Runtime and account"],
						["probe", "Probe", "Responses workbench"],
						["updates", "Updates", "Release and recovery"],
					] as [WorkspaceView, string, string][]).map(([view, label, description]) => (
						<button
							aria-current={workspaceView === view ? "page" : undefined}
							className={workspaceView === view ? "active" : ""}
							key={view}
							onClick={() => setWorkspaceView(view)}
							type="button"
						>
							<strong>{label}</strong>
							<span>{description}</span>
						</button>
					))}
				</nav>

				<section className={`route-rail ${routeActive ? "is-active" : ""}`} aria-label="Active request route">
				<div className="route-node">
						<span className="node-index">A</span>
						<div>
							<span className="route-kicker">Origin</span>
							<strong>Management center</strong>
					</div>
				</div>
				<div className="route-wire"><span /></div>
				<div className="route-node gateway-node">
					<span className="node-index">B</span>
					<div>
						<span className="route-kicker">Loopback</span>
						<strong>Pi Router</strong>
					</div>
				</div>
				<div className="route-wire"><span /></div>
				<div className="route-node model-node">
						<span className="node-index">C</span>
						<div>
							<span className="route-kicker">{routeTargetLabel}</span>
							<strong title={routeTarget}>{routeTarget}</strong>
						</div>
					</div>
					<div className="route-readout mono">
						<span>{routePhase}</span>
						<span>{routeMetric}</span>
					</div>
				</section>

				<main className={`workbench view-${workspaceView}`}>
				<aside className="connection-panel panel">
					<div className="panel-heading">
						<div>
							<p className="panel-index">Connection</p>
							<h2>Local route</h2>
						</div>
						<button className="icon-button" type="button" onClick={() => void checkHealth()} aria-label="Check health">
							<Icon name="refresh" />
						</button>
					</div>

					<div className="endpoint-card">
						<span className="field-label">API origin</span>
						<code>{origin}</code>
						<span className={`mini-state mini-${connection}`}>
							<span />
							{health?.status ?? "unavailable"}
						</span>
					</div>

					<label className="field-group">
						<span className="field-label">PI_ROUTER_API_KEY</span>
						<span className="secret-field">
							<input
								autoComplete="off"
								onChange={(event) => {
									setApiKey(event.target.value);
									if (connection === "ready" || connection === "rejected") {
										setConnection("disconnected");
										setModels([]);
										setManagement(null);
										setUpdateCandidate(null);
										setInstallConfirmation("");
										setUpdateRun(EMPTY_UPDATE_RUN);
										setConnectionMessage("Key changed. Connect again to load models.");
									}
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										void connect();
									}
								}}
								placeholder="Local bearer token"
								spellCheck={false}
								type={showKey ? "text" : "password"}
								value={apiKey}
							/>
							<button
								aria-label={showKey ? "Hide API key" : "Show API key"}
								className="reveal-button"
								onClick={() => setShowKey((current) => !current)}
								type="button"
							>
								<Icon name={showKey ? "eyeOff" : "eye"} />
							</button>
						</span>
					</label>
					<button
						className="button button-connect"
						disabled={connection === "checking"}
						onClick={() => void connect()}
						type="button"
					>
						{connection === "checking" ? "Checking…" : connection === "ready" ? "Reload models" : "Connect"}
						<Icon name={connection === "ready" ? "refresh" : "arrow"} />
					</button>
					<p className={`connection-note note-${connection}`} aria-live="polite">
						{connectionMessage}
					</p>
					<p className="privacy-note">
						The bearer stays in memory for this tab. It is never placed in history, storage, or copied into generated commands.
					</p>

					<div className="model-inventory">
						<div className="subheading">
							<span>Available models</span>
							<span className="count-badge">{models.length.toString().padStart(2, "0")}</span>
						</div>
						{models.length ? (
							<ul className="model-list">
								{models.map((model) => (
									<li key={model.id} className={model.id === draft.model ? "selected" : ""}>
										<button type="button" onClick={() => updateDraft("model", model.id)}>
											<span className="model-provider">{model.owned_by}</span>
											<span className="model-name">{model.id.includes("/") ? model.id.split("/").slice(1).join("/") : model.id}</span>
										</button>
									</li>
								))}
							</ul>
						) : (
							<div className="empty-models">
								<span className="empty-glyph">∅</span>
								<p>{connection === "ready" ? "No authenticated models." : "Connect to inspect the active account."}</p>
							</div>
						)}
					</div>
				</aside>

				{workspaceView === "probe" ? (
					<>
				<section className="composer-panel panel">
					<div className="panel-heading composer-heading">
						<div>
							<p className="panel-index">Request</p>
							<h2>Compose a probe</h2>
						</div>
						<div className="keyboard-hint"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd></div>
					</div>

					<div className="template-strip" aria-label="Request templates">
						{(Object.keys(TEMPLATE_LABELS) as TemplateId[]).map((template) => (
							<button
								className={activeTemplate === template ? "active" : ""}
								key={template}
								onClick={() => applyTemplate(template)}
								type="button"
							>
								<strong>{TEMPLATE_LABELS[template].label}</strong>
								<span>{TEMPLATE_LABELS[template].description}</span>
							</button>
						))}
					</div>

					<div className="segmented-control" role="tablist" aria-label="Request editor mode">
						<button
							aria-selected={editorMode === "compose"}
							className={editorMode === "compose" ? "active" : ""}
							onClick={() => changeEditorMode("compose")}
							role="tab"
							type="button"
						>
							Builder
						</button>
						<button
							aria-selected={editorMode === "raw"}
							className={editorMode === "raw" ? "active" : ""}
							onClick={() => changeEditorMode("raw")}
							role="tab"
							type="button"
						>
							Raw JSON
						</button>
					</div>

					{editorMode === "compose" ? (
						<div className="compose-form" role="tabpanel">
							<label className="field-group">
								<span className="field-label">Model</span>
								<select
									disabled={!models.length}
									onChange={(event) => updateDraft("model", event.target.value)}
									value={draft.model}
								>
									<option value="">{models.length ? "Choose a model" : "Connect to load models"}</option>
									{models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
								</select>
							</label>

							<label className="field-group prompt-field">
								<span className="field-label">
									Input
									<span>{draft.input.length} chars</span>
								</span>
								<textarea
									onChange={(event) => updateDraft("input", event.target.value)}
									placeholder="What should the provider answer?"
									rows={5}
									value={draft.input}
								/>
							</label>

							<label className="field-group">
								<span className="field-label">Instructions <span>optional</span></span>
								<input
									onChange={(event) => updateDraft("instructions", event.target.value)}
									placeholder="System-level guidance"
									type="text"
									value={draft.instructions}
								/>
							</label>

							<div className="field-grid">
								<label className="field-group">
									<span className="field-label">Reasoning effort</span>
									<select
										onChange={(event) => updateDraft("reasoningEffort", event.target.value)}
										value={draft.reasoningEffort}
									>
										<option value="">Provider default</option>
										<option value="minimal">minimal</option>
										<option value="low">low</option>
										<option value="medium">medium</option>
										<option value="high">high</option>
										<option value="xhigh">xhigh</option>
									</select>
								</label>
								<label className="field-group">
									<span className="field-label">Max output tokens</span>
									<input
										inputMode="numeric"
										min="1"
										onChange={(event) => updateDraft("maxOutputTokens", event.target.value)}
										type="number"
										value={draft.maxOutputTokens}
									/>
								</label>
							</div>

							<label className="toggle-row">
								<span>
									<strong>Stream SSE events</strong>
									<small>Inspect sequence and live text deltas</small>
								</span>
								<input
									checked={draft.stream}
									onChange={(event) => updateDraft("stream", event.target.checked)}
									type="checkbox"
								/>
								<span className="toggle-control" aria-hidden="true"><span /></span>
							</label>

							<label className="field-group tools-field">
								<span className="field-label">
									Function tools JSON
									<span>optional array</span>
								</span>
								<textarea
									className="code-input"
									onChange={(event) => updateDraft("toolsJson", event.target.value)}
									placeholder={'[{"type":"function","name":"…","parameters":{…}}]'}
									rows={draft.toolsJson ? 10 : 3}
									spellCheck={false}
									value={draft.toolsJson}
								/>
							</label>
						</div>
					) : (
						<div className="raw-editor" role="tabpanel">
							<div className="raw-editor-head">
								<span>POST /v1/responses</span>
								<button type="button" onClick={() => void copy(rawRequest, "Request JSON")}>
									<Icon name="copy" size={15} /> Copy
								</button>
							</div>
							<textarea
								aria-label="Raw request JSON"
								onChange={(event) => setRawRequest(event.target.value)}
								spellCheck={false}
								value={rawRequest}
							/>
						</div>
					)}

					<div className="send-bar">
						<div className="send-target">
							<span>POST</span>
							<code>/v1/responses</code>
						</div>
						{run.phase === "running" ? (
							<button className="button button-stop" onClick={cancelRun} type="button">
								<Icon name="stop" /> Cancel
							</button>
						) : (
							<button
								className="button button-send"
								disabled={connection !== "ready" || !draft.model}
								onClick={() => void sendRequest()}
								type="button"
							>
								<Icon name="play" /> Send probe
							</button>
						)}
					</div>
				</section>

				<section className="output-panel panel">
					<div className="panel-heading output-heading">
						<div>
							<p className="panel-index">Response</p>
							<h2>Inspect the wire</h2>
						</div>
						<span className={`run-badge run-${run.phase}`}>{run.phase}</span>
					</div>

					<div className="response-metrics">
						<div><span>HTTP</span><strong>{run.httpStatus ?? "—"}</strong></div>
						<div><span>Elapsed</span><strong>{formatDuration(run.durationMs)}</strong></div>
						<div><span>Events</span><strong>{run.events.length}</strong></div>
					</div>

					<div className="segmented-control output-tabs" role="tablist" aria-label="Response view">
						{([
							["result", "Result"],
							["events", `Events ${run.events.length ? `· ${run.events.length}` : ""}`],
							["json", "JSON"],
						] as [OutputMode, string][]).map(([mode, label]) => (
							<button
								aria-selected={outputMode === mode}
								className={outputMode === mode ? "active" : ""}
								key={mode}
								onClick={() => setOutputMode(mode)}
								role="tab"
								type="button"
							>
								{label}
							</button>
						))}
					</div>

					<div className="output-viewport" aria-live="polite">
						{outputMode === "result" && (
							<div className="result-view" role="tabpanel">
								{run.phase === "idle" ? (
									<div className="output-empty">
										<div className="pulse-diagram" aria-hidden="true">
											<span /><span /><span />
										</div>
										<h3>No probe on the wire</h3>
										<p>Connect, choose a model, then send a text or function-call request.</p>
									</div>
								) : run.phase === "running" && !run.outputText && !calls.length ? (
									<div className="output-empty running-empty">
										<div className="spinner" />
										<h3>Waiting for provider output</h3>
										<p>SSE lifecycle events will appear as they arrive.</p>
									</div>
								) : (
									<>
										{run.error && (
											<div className="error-block">
												<span>Error</span>
												<p>{run.error}</p>
											</div>
										)}
										{run.outputText && (
											<article className="text-output">
												<div className="result-label">
													<span>Assistant text</span>
													<button type="button" onClick={() => void copy(run.outputText, "Output text")}>
														<Icon name="copy" size={14} /> Copy
													</button>
												</div>
												<pre>{run.outputText}<span className={run.phase === "running" ? "stream-caret" : "hidden"} /></pre>
											</article>
										)}
										{calls.map((call, index) => (
											<article className="tool-call" key={`${String(call.call_id)}-${index}`}>
												<div className="result-label">
													<span>Function call</span>
													<code>{typeof call.call_id === "string" ? call.call_id : "call id unavailable"}</code>
												</div>
												<h3>{typeof call.name === "string" ? call.name : "unnamed_function"}</h3>
												<pre>{typeof call.arguments === "string" ? call.arguments : formatJson(call.arguments)}</pre>
											</article>
										))}
										{usage && (
											<div className="usage-strip">
												<div><span>Input</span><strong>{String(usage.input_tokens ?? "—")}</strong></div>
												<div><span>Output</span><strong>{String(usage.output_tokens ?? "—")}</strong></div>
												<div><span>Reasoning</span><strong>{String(isRecord(usage.output_tokens_details) ? usage.output_tokens_details.reasoning_tokens ?? "—" : "—")}</strong></div>
												<div><span>Total</span><strong>{String(usage.total_tokens ?? "—")}</strong></div>
											</div>
										)}
										{!run.error && !run.outputText && !calls.length && run.phase !== "running" && (
											<div className="output-empty compact-empty">
												<h3>Response completed without text output</h3>
												<p>Inspect JSON for the complete response object.</p>
											</div>
										)}
									</>
								)}
							</div>
						)}

						{outputMode === "events" && (
							<div className="events-view" role="tabpanel">
								{run.events.length ? (
									<ol className="event-list">
										{run.events.map((event, index) => (
											<li key={`${event.sequence_number ?? index}-${event.type}`}>
												<span className="event-sequence">
													{String(event.sequence_number ?? index).padStart(2, "0")}
												</span>
												<div>
													<strong>{event.type}</strong>
													{typeof event.delta === "string" && event.delta && <code>{event.delta}</code>}
												</div>
												<details>
													<summary>JSON</summary>
													<pre>{formatJson(event)}</pre>
												</details>
											</li>
										))}
									</ol>
								) : (
									<div className="output-empty compact-empty">
										<h3>No SSE events captured</h3>
										<p>Enable streaming in the request builder to inspect event order.</p>
									</div>
								)}
							</div>
						)}

						{outputMode === "json" && (
							<div className="json-view" role="tabpanel">
								<div className="raw-editor-head">
									<span>{run.contentType || "Response payload"}</span>
									<button
										disabled={run.response === null}
										onClick={() => void copy(formatJson(run.response), "Response JSON")}
										type="button"
									>
										<Icon name="copy" size={15} /> Copy
									</button>
								</div>
								<pre>{formatJson(run.response) || "No response payload yet."}</pre>
							</div>
						)}
					</div>

					<div className="output-actions">
						<button
							disabled={!run.request}
							onClick={() => run.request && void copy(buildCurl(origin, run.request), "Sanitized curl")}
							type="button"
						>
							<Icon name="copy" size={15} />
							Copy curl
						</button>
						<span>Uses <code>$PI_ROUTER_API_KEY</code>, never the entered bearer.</span>
						</div>
					</section>
					</>
				) : workspaceView === "overview" ? (
					<section className="management-surface overview-surface panel">
						<div className="surface-heading">
							<div>
								<p className="panel-index">Overview</p>
								<h2>Local control plane</h2>
							</div>
							<span className={`run-badge ${management ? "run-completed" : "run-idle"}`}>
								{management ? "authenticated" : "locked"}
							</span>
						</div>

						{management ? (
							<>
								<div className="overview-hero">
									<div className="version-stamp">
										<span>Running release</span>
										<strong>v{management.service.version}</strong>
										<code>{management.runtime.mode}</code>
									</div>
									<div className="overview-thesis">
										<p className="eyebrow">One loopback · one operator boundary</p>
										<h3>The route is ready where its state lives.</h3>
										<p>
											Inspect the embedded runtime, exercise a provider, and move between
											verified releases without sending control data beyond this listener.
										</p>
										<div className="overview-actions">
											<button className="button button-primary" onClick={() => setWorkspaceView("probe")} type="button">
												<Icon name="play" /> Open probe
											</button>
											<button className="button button-secondary" onClick={() => void checkForUpdates()} type="button">
												<Icon name="refresh" /> Check releases
											</button>
										</div>
									</div>
									<div className="uptime-dial" aria-label={`Uptime ${formatUptime(management.service.uptime_seconds)}`}>
										<span>Uptime</span>
										<strong>{formatUptime(management.service.uptime_seconds)}</strong>
										<small>{management.service.status}</small>
									</div>
								</div>

								<div className="status-cards">
									<article>
										<span className="status-card-label">Runtime</span>
										<strong>Node {management.runtime.node}</strong>
										<code>{management.runtime.platform} / {management.runtime.arch}</code>
									</article>
									<article>
										<span className="status-card-label">Account</span>
										<strong>{management.account.id}</strong>
										<code>explicit local store</code>
									</article>
									<article>
										<span className="status-card-label">Models ready</span>
										<strong>{management.account.available_models.toString().padStart(2, "0")}</strong>
										<code>authenticated inventory</code>
									</article>
									<article>
										<span className="status-card-label">Update posture</span>
										<strong>{management.update.automatic ? "Automatic" : "Manual"}</strong>
										<code>{management.update.install_supported ? "verified install ready" : "source check-only"}</code>
									</article>
								</div>

								<section className="runtime-map" aria-label="Pi Router runtime path">
									<div className="runtime-map-head">
										<div>
											<p className="panel-index">Live topology</p>
											<h3>What this process owns</h3>
										</div>
										<button className="icon-button" onClick={() => void refreshManagement()} type="button" aria-label="Refresh management status">
											<Icon name="refresh" />
										</button>
									</div>
									<div className="runtime-map-track">
										<div className="runtime-map-node">
											<span>01</span>
											<strong>Browser</strong>
											<small>bearer stays in memory</small>
										</div>
										<i />
										<div className="runtime-map-node active">
											<span>02</span>
											<strong>Pi Router</strong>
											<small>loopback HTTP boundary</small>
										</div>
										<i />
										<div className="runtime-map-node">
											<span>03</span>
											<strong>Pi runtime</strong>
											<small>provider + OAuth refresh</small>
										</div>
										<i />
										<div className="runtime-map-node signal">
											<span>04</span>
											<strong>{management.account.available_models} models</strong>
											<small>account {management.account.id}</small>
										</div>
									</div>
								</section>

								<div className="overview-lower">
									<section className="ledger-card">
										<div className="surface-subheading">
											<p className="panel-index">Boundary ledger</p>
											<h3>Deliberately local</h3>
										</div>
										<ul>
											<li><span>Listener</span><strong>Loopback only</strong></li>
											<li><span>Control API</span><strong>Bearer required</strong></li>
											<li><span>Browser data</span><strong>Memory only</strong></li>
											<li><span>Release write</span><strong>Own binary only</strong></li>
										</ul>
									</section>
									<section className="next-action-card">
										<p className="panel-index">Next useful action</p>
										<h3>{management.account.available_models ? "Run a provider probe" : "Configure a provider"}</h3>
										<p>
											{management.account.available_models
												? "Send a small streaming request and inspect the exact Responses lifecycle."
												: "Use the CLI login flow, then reconnect this page to refresh the inventory."}
										</p>
										<button
											className="button button-send"
											disabled={!management.account.available_models}
											onClick={() => setWorkspaceView("probe")}
											type="button"
										>
											<Icon name="arrow" /> Go to probe
										</button>
									</section>
								</div>
							</>
						) : (
							<div className="surface-locked">
								<div className="locked-mark">π</div>
								<h3>Authenticate the local control plane</h3>
								<p>
									Enter the serving process&apos;s <code>PI_ROUTER_API_KEY</code>. Status,
									models, and update capability load only after the bearer is accepted.
								</p>
							</div>
						)}
					</section>
				) : (
					<section className="management-surface updates-surface panel">
						<div className="surface-heading">
							<div>
								<p className="panel-index">Updates</p>
								<h2>Release handoff</h2>
							</div>
							<span className={`run-badge update-${updateRun.phase}`}>{updateRun.phase}</span>
						</div>

						{management ? (
							<>
								{management.update.restart_required && (
									<div className="restart-banner">
										<span>Restart required</span>
										<strong>
											{management.update.pending_version
												? `A ${management.update.pending_version} handoff is staged.`
												: "A binary handoff is staged."}
										</strong>
										<p>The running process stays untouched until your supervisor or shell restarts it.</p>
									</div>
								)}

								<div className="release-hero">
									<div className="release-version current">
										<span>Running</span>
										<strong>v{management.service.version}</strong>
										<code>{management.runtime.mode}</code>
									</div>
									<div className={`release-transfer ${updateCandidate?.status === "available" ? "available" : ""}`}>
										<span />
										<small>{updateCandidate?.status === "available" ? "verified handoff available" : "stable channel"}</small>
									</div>
									<div className="release-version candidate">
										<span>Latest checked</span>
										<strong>{updateCandidate ? `v${updateCandidate.latest_version}` : "—"}</strong>
										<code>{updateCandidate?.status ?? "not checked"}</code>
									</div>
								</div>

								<div className={`update-message message-${updateRun.phase}`} aria-live="polite">
									<span className="message-pulse" />
									<div>
										<strong>{updateRun.phase === "failed" ? "Update action stopped" : "Release channel"}</strong>
										<p>{updateRun.message}</p>
									</div>
								</div>

								<div className="release-actions">
									<button
										className="button button-secondary"
										disabled={["checking", "installing", "rolling-back"].includes(updateRun.phase)}
										onClick={() => void checkForUpdates()}
										type="button"
									>
										<Icon name="refresh" /> {updateRun.phase === "checking" ? "Checking…" : "Check stable release"}
									</button>
									<button
										className={`button button-install ${installConfirmation ? "confirm" : ""}`}
										disabled={
											updateCandidate?.status !== "available"
											|| !management.update.install_supported
											|| ["checking", "installing", "rolling-back"].includes(updateRun.phase)
										}
										onClick={() => void installUpdate()}
										type="button"
									>
										<Icon name="arrow" />
										{updateRun.phase === "installing"
											? "Verifying…"
											: installConfirmation
												? `Confirm ${installConfirmation}`
												: `Install ${updateCandidate?.latest_version ?? "update"}`}
									</button>
									<button
										className="button button-rollback"
										disabled={
											!management.update.rollback_available
											|| ["checking", "installing", "rolling-back"].includes(updateRun.phase)
										}
										onClick={() => void rollbackUpdate()}
										type="button"
									>
										<Icon name="refresh" /> {updateRun.phase === "rolling-back" ? "Restoring…" : "Restore previous"}
									</button>
								</div>

								{installConfirmation && (
									<div className="confirmation-strip">
										<strong>Second step required.</strong>
										<span>
											The checked version must still be latest; checksum and Android ELF validation run before replacement.
										</span>
										<button onClick={() => setInstallConfirmation("")} type="button">Cancel</button>
									</div>
								)}

								<div className="update-details">
									<section className="artifact-card">
										<div className="surface-subheading">
											<p className="panel-index">Fixed artifact</p>
											<h3>{updateCandidate?.asset.name ?? "pi-router-android-aarch64"}</h3>
										</div>
										<div className="artifact-readout">
											<div><span>Size</span><strong>{updateCandidate ? formatBytes(updateCandidate.asset.size) : "bounded ≤ 128 MiB"}</strong></div>
											<div><span>Target</span><strong>ELF64 · AArch64</strong></div>
											<div><span>Linker</span><strong>/system/bin/linker64</strong></div>
											<div><span>Integrity</span><strong>SHA-256 required</strong></div>
										</div>
										{updateCandidate && (
											<div className="release-meta">
												<span>
													Published {updateCandidate.published_at
														? new Date(updateCandidate.published_at).toLocaleString()
														: "date unavailable"}
												</span>
												<button onClick={() => void copy(updateCandidate.release_url, "Release URL")} type="button">
													<Icon name="copy" size={14} /> Copy release URL
												</button>
											</div>
										)}
									</section>

									<section className="policy-card">
										<div className="surface-subheading">
											<p className="panel-index">Installation policy</p>
											<h3>{management.update.install_supported ? "Packaged binary" : "Source check-only"}</h3>
										</div>
										<ul>
											<li><span>Repository</span><code>{management.update.repository}</code></li>
											<li><span>Channel</span><strong>{management.update.channel}</strong></li>
											<li><span>Automatic install</span><strong>{management.update.automatic ? "opted in" : "off"}</strong></li>
											<li><span>Rollback copy</span><strong>{management.update.rollback_available ? "available" : "not staged"}</strong></li>
										</ul>
										<p>
											{management.update.install_supported
												? "Replacement is limited to this executable. Router account and credential state are outside the update path."
												: "Run the committed Termux binary to enable install and rollback. Source mode never overwrites Node."}
										</p>
									</section>
								</div>
							</>
						) : (
							<div className="surface-locked">
								<div className="locked-mark">↻</div>
								<h3>Connect before touching releases</h3>
								<p>
									Release checks and every binary mutation require the same local bearer as
									the Responses API. No check runs when this page merely loads.
								</p>
							</div>
						)}
					</section>
				)}
			</main>

			<footer className="footer">
				<span>Loopback only · no request history · no browser credential storage</span>
				<span className="mono">/v1/* · /management/api/* · bearer required</span>
			</footer>

			{notice && <div className="toast" role="status"><Icon name="check" />{notice}</div>}
		</div>
	);
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Pi Router UI root element is missing.");
}
createRoot(root).render(<App />);
