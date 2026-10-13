import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { asRecord, callArgument, formatDuration, SPINNER_FRAMES as SPINNER, titleForTool } from "./format.ts";
import { setTick } from "./tick.ts";

const WORKING_TICK = Symbol.for("claude-code-ui:tick:working");

const VERBS = ["Thinking", "Working", "Pondering", "Cooking", "Crafting"];

const ORANGE = [217, 119, 87] as const;
const RESET = "\x1b[39m";

function rgb(r: number, g: number, b: number): string {
	return `\x1b[38;2;${r};${g};${b}m`;
}

function mix(factor: number): string {
	return rgb(
		Math.round(ORANGE[0] + (255 - ORANGE[0]) * factor),
		Math.round(ORANGE[1] + (255 - ORANGE[1]) * factor),
		Math.round(ORANGE[2] + (255 - ORANGE[2]) * factor),
	);
}

// Precomputed once: shine() runs every 90ms, no per-frame Math.round/rgb().
const SHINE_BASE = mix(0);
const SHINE_NEAR = mix(0.3);
const SHINE_PEAK = mix(0.65);

function shine(text: string, pos: number): string {
	let out = "";
	let index = 0;
	for (const ch of text) {
		const dist = Math.abs(index - pos);
		out += `${dist === 0 ? SHINE_PEAK : dist === 1 ? SHINE_NEAR : SHINE_BASE}${ch}`;
		index++;
	}
	return out + RESET;
}

function toolActivity(toolName: string, args: unknown, cwd?: string): string {
	const title = titleForTool(toolName);
	const arg = callArgument(toolName, asRecord(args), cwd);
	return arg ? `${title} ${arg}` : title;
}

export function attachWorking(
	ctxHolder: { current?: ExtensionContext },
	pi: ExtensionAPI,
): {
	start(ctx: ExtensionContext): void;
	stop(ctx: ExtensionContext): void;
	dispose(): void;
} {
	let startedAt = 0;
	let verbIndex = 0;
	let frame = 0;
	let verbStarted = 0;
	let activity = "";
	let active = false;
	let lastLabel = "";
	let lastLabelLen = 0;

	const paint = (ctx: ExtensionContext) => {
		if (!ctx.hasUI || !active) return;
		const now = Date.now();
		if (!activity && now - verbStarted > 3000) {
			verbIndex = (verbIndex + 1) % VERBS.length;
			verbStarted = now;
			frame = 0;
		}
		const label = activity || `${VERBS[verbIndex] ?? "Working"}…`;
		if (label !== lastLabel) {
			lastLabel = label;
		lastLabelLen = [...label].length;
		}
		const shinePos = frame % (Math.max(1, lastLabelLen) + 6);
		const word = shine(label, shinePos);
		const spinner = rgb(...ORANGE) + (SPINNER[frame % SPINNER.length] ?? "✶") + RESET;
		const elapsed = now - startedAt;
		const time = elapsed >= 1000 ? ctx.ui.theme.fg("dim", ` · ${formatDuration(elapsed)}`) : "";
		const hint = ctx.ui.theme.fg("dim", " (esc)");
		ctx.ui.setWorkingMessage(`${word}${time}${hint}`);
		ctx.ui.setWorkingIndicator({ frames: [spinner] });
		frame++;
	};

	pi.on("tool_execution_start", async (event, ctx) => {
		ctxHolder.current = ctx;
		if (!active) return;
		activity = toolActivity(event.toolName, event.args, ctx.cwd);
		frame = 0;
		if (ctx.hasUI) paint(ctx);
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		ctxHolder.current = ctx;
		if (!active) return;
		activity = "";
		verbStarted = Date.now();
		if (ctx.hasUI) paint(ctx);
	});

	return {
		start(ctx) {
			ctxHolder.current = ctx;
			if (ctx.mode !== "tui" || !ctx.hasUI) return;
			active = true;
			activity = "";
			startedAt = Date.now();
			verbStarted = startedAt;
			verbIndex = Math.floor(Math.random() * VERBS.length);
			frame = 0;
			paint(ctx);
			setTick(WORKING_TICK, () => {
				const current = ctxHolder.current;
				if (current) paint(current);
			});
		},
		stop(ctx) {
			active = false;
			activity = "";
			setTick(WORKING_TICK, undefined);
			if (!ctx.hasUI) return;
			ctx.ui.setWorkingMessage();
			ctx.ui.setWorkingIndicator();
		},
		dispose() {
			active = false;
			setTick(WORKING_TICK, undefined);
		},
	};
}
