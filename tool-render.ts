import { type Theme, renderDiff } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
	asRecord,
	callArgument,
	cleanBashOutput,
	countDiffStats,
	formatResultBody,
	resultText,
	SPINNER_FRAMES as SPINNER,
	summarizeResult,
	tailLines,
	titleForTool,
} from "./format.ts";
import { setTick } from "./tick.ts";

const SPINNER_TICK = Symbol.for("claude-code-ui:tick:spinner");
// Drop entries that haven't re-rendered within this window. While a tool is
// genuinely pending, every tick invalidates it and the render re-registers
// the entry, so the touch stays fresh. Stale entries mean the invalidate is a
// no-op (HTML export passes `invalidate: () => {}` and calls renderCall with
// isPartial: true exactly once) or the component is detached; dropping them
// keeps one forgotten row from spinning the shared ticker forever. Drops are
// self-healing: the next pending render simply re-registers.
const SPINNER_STALE_MS = 2000;
const REGISTRY_KEY = Symbol.for("claude-code-ui:tool-spinner-registry:v2");

export type ToolSpinnerState = {
	frame?: number;
};

type SpinnerEntry = {
	invalidate: () => void;
	lastTouch: number;
};

type SpinnerRegistry = Map<ToolSpinnerState, SpinnerEntry>;

function registry(): SpinnerRegistry {
	const root = globalThis as typeof globalThis & { [REGISTRY_KEY]?: SpinnerRegistry };
	if (!root[REGISTRY_KEY]) root[REGISTRY_KEY] = new Map();
	return root[REGISTRY_KEY];
}

function stopTicker(): void {
	setTick(SPINNER_TICK, undefined);
}

function tickAll(): void {
	const entries = registry();
	if (entries.size === 0) {
		stopTicker();
		return;
	}
	const now = Date.now();
	for (const [state, entry] of entries) {
		if (now - entry.lastTouch > SPINNER_STALE_MS) {
			entries.delete(state);
			continue;
		}
		state.frame = (state.frame ?? 0) + 1;
		try {
			entry.invalidate();
		} catch {
			// Detached component (e.g. transcript rebuilt under us). Drop it
			// instead of throwing inside the shared timer and freezing every
			// other spinner.
			entries.delete(state);
		}
	}
	if (entries.size === 0) stopTicker();
}

function ensureTicker(): void {
	setTick(SPINNER_TICK, tickAll);
}

// ToolRenderContext is currently part of Pi's public renderer callbacks but is
// not re-exported from the package root in 0.85. Keep the structural subset we
// use here so the extension remains type-checkable without a private import.
export type ClaudeToolRenderContext<TState = Record<string, unknown>> = {
	args: unknown;
	state: TState;
	cwd?: string;
	executionStarted: boolean;
	isPartial: boolean;
	isError: boolean;
	invalidate(): void;
	lastComponent?: Component;
};

export function stopToolSpinners(repaint: boolean): void {
	const entries = registry();
	stopTicker();
	if (!repaint) {
		// Tearing down (session shutdown): old components are discarded, so
		// just forget them. Invalidating here would re-register genuinely
		// pending rows and restart the ticker against a dead UI.
		entries.clear();
		return;
	}
	// Snapshot: invalidating re-enters tickSpinner, which may mutate the map.
	const snapshot = [...entries];
	entries.clear();
	for (const [, entry] of snapshot) {
		try {
			// Final paint so rows settle on ⏺ immediately instead of keeping
			// the last spinner frame until the next unrelated render. Entries
			// are expected to be done here (agent settled); one that is still
			// pending simply re-registers itself via tickSpinner.
			entry.invalidate();
		} catch {
			// UI tearing down; ignore.
		}
	}
}

function isPending(context: ClaudeToolRenderContext): boolean {
	// NOTE: do NOT check `!context.executionStarted` here. When the transcript
	// is rebuilt from history (e.g. after /reload), Pi never calls
	// markExecutionStarted() on the restored components, so executionStarted
	// stays false forever for finished tools and the spinner would flash
	// indefinitely. isPartial alone is accurate: it is true from construction
	// until the final updateResult(), for both live and restored tools.
	return context.isPartial;
}

function tickSpinner(context: ClaudeToolRenderContext<ToolSpinnerState>): void {
	const entries = registry();
	if (isPending(context)) {
		context.state.frame ??= 0;
		// Refresh the invalidate closure on every render: Pi builds a new
		// context object per updateDisplay, and a stored closure may point at
		// a stale component after transcript rebuilds.
		entries.set(context.state, {
			invalidate: context.invalidate,
			lastTouch: Date.now(),
		});
		ensureTicker();
		return;
	}
	if (entries.delete(context.state) && entries.size === 0) stopTicker();
}

export function renderCallLine(
	toolName: string,
	definition: { label?: string } | undefined,
	args: unknown,
	theme: Theme,
	cwd: string | undefined,
	context: ClaudeToolRenderContext<ToolSpinnerState>,
): string {
	tickSpinner(context);
	const title = titleForTool(toolName, definition?.label);
	const arg = callArgument(toolName, asRecord(args), cwd ?? context.cwd);
	const pending = isPending(context);
	const frame = SPINNER[(context.state.frame ?? 0) % SPINNER.length] ?? "✶";
	const bullet = pending ? theme.fg("accent", frame) : theme.fg("text", "⏺");
	const name = theme.fg("text", title);
	if (!arg) return `${bullet} ${name}`;
	return `${bullet} ${name}${theme.fg("dim", "(")}${theme.fg("text", arg)}${theme.fg("dim", ")")}`;
}

export function renderResultBlock(
	toolName: string,
	args: unknown,
	result: { content?: Array<{ type?: string; text?: string }>; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
	context: ClaudeToolRenderContext,
): string {
	const text = resultText(result);
	const indent = "  ";
	const connector = theme.fg("dim", "⎿");

	if (options.isPartial) {
		// Live preview: Pi streams partial results via tool_execution_update.
		// Show the tail so a long-running bash isn't a blank spinner.
		const tail = tailLines(cleanBashOutput(text));
		if (!tail.length) return "";
		return tail
			.map((line, index) => `${indent}${index === 0 ? `${connector}  ` : "   "}${theme.fg("dim", line)}`)
			.join("\n");
	}

	const details = asRecord(result.details);
	const diff = typeof details?.diff === "string" ? details.diff : undefined;
	const summary = summarizeResult({
		toolName,
		args: asRecord(args),
		text,
		isError: Boolean(context.isError),
		isPartial: options.isPartial,
		details,
		hasImage: (result.content ?? []).some((block) => block?.type === "image"),
	});

	const color = context.isError ? "error" : "muted";

	if (toolName === "edit" && options.expanded && !context.isError && diff) {
		const rendered = renderDiff(diff);
		const lines = rendered.split("\n").filter((line, index, all) => !(index === all.length - 1 && line === ""));
		if (lines.length) {
			return lines
				.map((line, index) => `${indent}${index === 0 ? `${connector}  ` : "   "}${line}`)
				.join("\n");
		}
	}

	if ((toolName === "bash" || toolName === "powershell") && !context.isError) {
		const body = formatResultBody(summary, options.expanded);
		if (!body.length) {
			return `${indent}${connector}  ${theme.fg("dim", "(No output)")}`;
		}
		return body
			.map((line, index) => `${indent}${index === 0 ? `${connector}  ` : "   "}${theme.fg(color, line)}`)
			.join("\n");
	}

	if (toolName === "edit" && !options.expanded && !context.isError) {
		const stats = countDiffStats(diff);
		if (stats) {
			const bits = [
				stats.added ? theme.fg("success", `+${stats.added}`) : "",
				stats.removed ? theme.fg("error", `-${stats.removed}`) : "",
			].filter(Boolean);
			if (bits.length) {
				return `${indent}${connector}  ${theme.fg("muted", summary)} ${theme.fg("dim", "(")}${bits.join(" ")}${theme.fg("dim", ")")}`;
			}
		}
	}

	const body = formatResultBody(summary, options.expanded);
	if (!body.length) return `${indent}${connector}  ${theme.fg("dim", "Done")}`;
	return body
		.map((line, index) => `${indent}${index === 0 ? `${connector}  ` : "   "}${theme.fg(color, line)}`)
		.join("\n");
}
