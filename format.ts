import { homedir } from "node:os";
import path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

const HOME = homedir();

export const SPINNER_FRAMES = ["✶", "✻", "✽", "✹", "✺", "✹", "✽", "✻"];

interface SummaryInput {
	args: Record<string, unknown> | undefined;
	text: string;
	details?: Record<string, unknown>;
}

interface ToolSpec {
	title: string;
	arg: (args: Record<string, unknown>, cwd?: string) => string;
	summary: (input: SummaryInput) => string;
}

function countNonEmptyLines(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split("\n").filter(Boolean).length : 0;
}

const bashSpec: ToolSpec = {
	title: "Bash",
	arg: (args) => clip(args.command),
	summary: ({ text }) => {
		const cleaned = cleanBashOutput(text);
		return cleaned || "(No output)";
	},
};

function matchSummary(single: string, plural: string, none: string, noMatch?: RegExp) {
	return ({ text }: SummaryInput): string => {
		const lines = countNonEmptyLines(text);
		if (!lines || (noMatch && noMatch.test(text))) return none;
		return `Found ${lines} ${lines === 1 ? single : plural}`;
	};
}

const TOOLS: Record<string, ToolSpec> = {
	bash: bashSpec,
	powershell: bashSpec,
	read: {
		title: "Read",
		arg: (args, cwd) => clip(shortPath(String(args.path ?? args.file_path ?? ""), cwd)),
		summary: ({ text, details }) => {
			const lines = text ? text.split("\n").length : 0;
			const truncated = details?.truncation && typeof details.truncation === "object";
			return truncated ? `Read ${lines} lines (truncated)` : `Read ${lines} lines`;
		},
	},
	edit: {
		title: "Update",
		arg: (args, cwd) => clip(shortPath(String(args.path ?? args.file_path ?? ""), cwd)),
		summary: ({ details }) => {
			const stats = countDiffStats(typeof details?.diff === "string" ? details.diff : undefined);
			if (stats) {
				const parts = [];
				if (stats.added) parts.push(`Added ${stats.added} ${stats.added === 1 ? "line" : "lines"}`);
				if (stats.removed) parts.push(`removed ${stats.removed}`);
				return parts.join(", ") || "No changes";
			}
			return "Updated file";
		},
	},
	write: {
		title: "Write",
		arg: (args, cwd) => clip(shortPath(String(args.path ?? args.file_path ?? ""), cwd)),
		summary: ({ args }) => {
			const content = typeof args?.content === "string" ? args.content : "";
			const lines = content ? content.split("\n").length : 0;
			return lines ? `Wrote ${lines} ${lines === 1 ? "line" : "lines"}` : "Wrote file";
		},
	},
	grep: {
		title: "Grep",
		arg: (args, cwd) => {
			const pattern = clip(args.pattern, 48);
			const quoted = JSON.stringify(pattern);
			const inPath = args.path ? ` in ${clip(shortPath(String(args.path), cwd), 32)}` : "";
			return `${quoted}${inPath}`;
		},
		summary: matchSummary("line", "lines", "No matches found", /^no matches/i),
	},
	find: {
		title: "Glob",
		arg: (args, cwd) => {
			const pattern = clip(args.pattern, 48);
			const inPath = args.path ? ` in ${clip(shortPath(String(args.path), cwd), 32)}` : "";
			return `${pattern}${inPath}`;
		},
		summary: matchSummary("file", "files", "No files found", /^no (files|matches)/i),
	},
	ls: {
		title: "LS",
		arg: (args, cwd) => clip(shortPath(String(args.path ?? "."), cwd)),
		summary: ({ text }) => {
			const lines = countNonEmptyLines(text);
			return lines ? `${lines} ${lines === 1 ? "item" : "items"}` : "Empty";
		},
	},
};

const MAX_ARG = 72;
const EXPANDED_RESULT_LINES = 40;
export const LIVE_PREVIEW_LINES = 5;

/** Last `max` non-empty lines of streaming output, for the live preview under a running tool. */
export function tailLines(text: string, max = LIVE_PREVIEW_LINES): string[] {
	// Single split, walk back: no filter()/slice() copies on long outputs.
	const lines = text.split("\n");
	const tail: string[] = [];
	let nonEmpty = 0;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i] ?? "";
		if (!line.trim()) continue;
		nonEmpty++;
		if (tail.length < max) tail.push(line);
	}
	tail.reverse();
	if (nonEmpty <= max) return tail;
	return [`… +${nonEmpty - max} lines`, ...tail];
}

export function homePath(input: string | undefined): string {
	if (!input) return "";
	if (HOME && (input === HOME || input.startsWith(`${HOME}/`) || input.startsWith(`${HOME}\\`))) {
		return `~${input.slice(HOME.length).replaceAll("\\", "/")}`;
	}
	return input.replaceAll("\\", "/");
}

export function shortPath(input: string | undefined, cwd?: string): string {
	if (!input) return "";
	const normalized = input.replaceAll("\\", "/");
	if (cwd) {
		const rel = path.relative(cwd.replaceAll("\\", "/"), normalized).replaceAll(path.sep, "/");
		if (rel === "" || rel === ".") return ".";
		if (rel !== ".." && !rel.startsWith("../") && !path.isAbsolute(rel)) return rel;
	}
	return homePath(normalized);
}

export function clip(value: unknown, max = MAX_ARG): string {
	const text = oneLine(value);
	if (visibleWidth(text) <= max) return text;
	// Width-based truncation without SGR round-trip: clip() deals in plain
	// text, so slice by display width and append the ellipsis directly.
	const keep = Math.max(1, max) - visibleWidth("…");
	let width = 0;
	let end = 0;
	for (const ch of text) {
		// ponytail: ASCII fast path, visibleWidth() only for wide chars
		const w = ch.length === 1 && ch.charCodeAt(0) < 128 ? 1 : visibleWidth(ch);
		if (width + w > keep) break;
		width += w;
		end += ch.length;
	}
	return `${text.slice(0, end)}…`;
}

export function oneLine(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

// ponytail: no eviction, keys are distinct (name,label) pairs which stay session-bounded
const titleCache = new Map<string, string>();

export function titleForTool(name: string, label?: string): string {
	const key = label === undefined ? name : `${name} ${label}`;
	const hit = titleCache.get(key);
	if (hit !== undefined) return hit;
	const mapped = TOOLS[name]?.title;
	let resolved: string;
	if (mapped) resolved = mapped;
	else if (label && label !== name && !/^MCP(?::|$)/i.test(label)) resolved = label;
	else
		resolved =
			name
				.replace(/^mcp[_:-]+/i, "")
				.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
				.replace(/[_:-]+/g, " ")
				.replace(/\b\w/g, (ch) => ch.toUpperCase())
				.trim() || "Tool";
	titleCache.set(key, resolved);
	return resolved;
}


export function callArgument(toolName: string, args: Record<string, unknown> | undefined, cwd?: string): string {
	if (!args || typeof args !== "object") return "";
	const spec = TOOLS[toolName];
	if (spec) return spec.arg(args, cwd);
	const preferred =
		args.path ??
		args.file_path ??
		args.command ??
		args.query ??
		args.pattern ??
		args.url ??
		args.name ??
		args.prompt ??
		args.message;
	if (preferred == null || typeof preferred === "object") return "";
	return clip(typeof preferred === "string" ? shortPath(preferred, cwd) || preferred : preferred);
}

export function countDiffStats(diff: string | undefined): { added: number; removed: number } | undefined {
	if (!diff) return undefined;
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

export function resultText(result: { content?: Array<{ type?: string; text?: string }> } | undefined): string {
	if (!result?.content) return "";
	return result.content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text ?? "")
		.join("\n");
}

export function cleanBashOutput(text: string): string {
	return text
		.replace(/\n?exit code: \d+\s*$/i, "")
		.replace(/^\s+|\s+$/g, "");
}

export function summarizeResult(options: {
	toolName: string;
	args: Record<string, unknown> | undefined;
	text: string;
	isError: boolean;
	isPartial: boolean;
	details?: Record<string, unknown>;
	hasImage?: boolean;
}): string {
	const { toolName, args, text, isError, isPartial, details, hasImage } = options;
	if (isPartial && !text.trim()) return "Running…";
	if (isError) {
		const first = text.trim().split("\n").find((line) => line.trim()) ?? "Error";
		return first.replace(/^Error:\s*/i, "Error: ");
	}
	// resultText() drops non-text blocks; without this an image read is "Read 0 lines".
	if (toolName === "read" && (hasImage || text.startsWith("Image"))) return "Read image";

	const spec = TOOLS[toolName];
	if (spec) return spec.summary({ args, text, details: asRecord(details) });
	return text.trim() || "Done";
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

export function formatResultBody(text: string, expanded: boolean): string[] {
	const cleaned = text.replace(/\s+$/g, "");
	if (!cleaned) return [];
	const lines = cleaned.split("\n");
	if (!expanded) {
		if (lines.length === 1) return lines;
		return [`${lines[0]} … +${lines.length - 1} lines`];
	}
	const visible = lines.slice(0, EXPANDED_RESULT_LINES);
	const extra = lines.length - visible.length;
	if (extra > 0) visible.push(`… +${extra} lines`);
	return visible;
}

/** clock: working indicator. thought: "Thought for Xs" (min 1s, always show seconds). */
export function formatDuration(ms: number, mode: "clock" | "thought" = "clock"): string {
	const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
	if (mode === "thought") {
		if (safe < 60_000) return `${Math.max(1, Math.round(safe / 1000))}s`;
		const totalSec = Math.floor(safe / 1000);
		const sec = totalSec % 60;
		const totalMin = Math.floor(totalSec / 60);
		const min = totalMin % 60;
		const hours = Math.floor(totalMin / 60);
		if (hours > 0) return `${hours}h ${min}m ${sec}s`;
		return `${min}m ${sec}s`;
	}
	const seconds = Math.floor(safe / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const minRest = minutes % 60;
	return minRest ? `${hours}h ${minRest}m` : `${hours}h`;
}

export function formatModelDisplayName(raw: string): string {
	if (!raw) return "model";
	// Strip parenthetical details e.g. "Claude 3.7 Sonnet (thought: high)" -> "Claude 3.7 Sonnet"
	let cleaned = raw.replace(/\s*\(.*?\)\s*/g, " ").trim();
	// Strip provider namespace prefix if present e.g. "antigravity/gemini-3.8-flash" -> "gemini-3.8-flash"
	if (cleaned.includes("/")) {
		cleaned = cleaned.split("/").pop() || cleaned;
	}
	// Strip date stamps at the end e.g. "-20250219"
	cleaned = cleaned.replace(/-\d{8}$/, "");

	// Normalize well-known model identifiers to human-readable names
	const lower = cleaned.toLowerCase();
	if (lower === "performance") return "Performance";
	if (lower.includes("sonnet")) {
		if (lower.includes("3-7") || lower.includes("3.7")) return "Claude 3.7 Sonnet";
		if (lower.includes("3-5") || lower.includes("3.5")) return "Claude 3.5 Sonnet";
		return "Claude Sonnet";
	}
	if (lower.includes("opus")) {
		if (lower.includes("3-5") || lower.includes("3.5")) return "Claude 3.5 Opus";
		if (lower.includes("3-7") || lower.includes("3.7")) return "Claude 3.7 Opus";
		return "Claude Opus";
	}
	if (lower.includes("haiku")) return "Claude Haiku";
	if (lower.includes("gemini")) {
		if (lower.includes("3.8") || lower.includes("3-8")) return "Gemini 3.8 Flash";
		if (lower.includes("2.5") || lower.includes("2-5")) return "Gemini 2.5 Flash";
		if (lower.includes("pro")) return "Gemini Pro";
		if (lower.includes("flash")) return "Gemini Flash";
		return "Gemini";
	}
	if (lower.includes("gpt-4o")) return "GPT-4o";
	if (lower.includes("o3-mini")) return "o3-mini";
	if (lower.includes("o1")) return "o1";

	return cleaned;
}

type UsageLike = { input?: number; cacheRead?: number; cacheWrite?: number };

export type CacheHitEntry = {
	id?: string;
	type?: string;
	usage?: UsageLike;
	message?: { role?: string; usage?: UsageLike };
};

export function cacheHitSignature(leaf: CacheHitEntry | undefined): string {
	const u = leaf?.type === "message" ? leaf.message?.usage : leaf?.usage;
	return `${leaf?.id ?? ""}:${u?.input ?? ""}:${u?.cacheRead ?? ""}:${u?.cacheWrite ?? ""}`;
}

/** Latest-turn cache hit %, matching Pi's built-in footer `CH`. Hidden when the session never reported cache. */
export function latestCacheHitPercent(entries: Iterable<CacheHitEntry>): number | undefined {
	let latest: number | undefined;
	let sawCache = false;
	for (const entry of entries) {
		const assistant =
			entry.type === "message" && entry.message?.role === "assistant" ? entry.message.usage : undefined;
		const extra =
			entry.type === "message" && entry.message?.role === "toolResult"
				? entry.message.usage
				: entry.type === "compaction" || entry.type === "branch_summary"
					? entry.usage
					: undefined;
		if (assistant) {
			const cacheRead = assistant.cacheRead ?? 0;
			const cacheWrite = assistant.cacheWrite ?? 0;
			if (cacheRead || cacheWrite) sawCache = true;
			const prompt = (assistant.input ?? 0) + cacheRead + cacheWrite;
			if (prompt > 0) latest = (cacheRead / prompt) * 100;
		}
		if (extra && ((extra.cacheRead ?? 0) || (extra.cacheWrite ?? 0))) sawCache = true;
	}
	return sawCache ? latest : undefined;
}
