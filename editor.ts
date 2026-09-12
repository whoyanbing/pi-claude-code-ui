import {
	CustomEditor,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PROMPT_COLS = 2;
const SIDE_COLS = 2;

let clockTimer: ReturnType<typeof setTimeout> | undefined;

function formatClock(date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function msUntilNextMinute(date = new Date()): number {
	return Math.max(50, 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds()));
}

function scheduleClock(tui: TUI): void {
	if (clockTimer) clearTimeout(clockTimer);
	clockTimer = setTimeout(() => {
		tui.requestRender();
		scheduleClock(tui);
	}, msUntilNextMinute());
	clockTimer.unref?.();
}

function padVisible(line: string, width: number): string {
	const current = visibleWidth(line);
	if (current === width) return line;
	if (current > width) return truncateToWidth(line, width);
	return `${line}${" ".repeat(width - current)}`;
}

function emptyBorder(leftCap: string, rightCap: string, width: number, paint: (text: string) => string): string {
	if (width <= 0) return "";
	if (width === 1) return paint(leftCap);
	return `${paint(leftCap)}${paint("─".repeat(width - 2))}${paint(rightCap)}`;
}

function topBorder(
	width: number,
	bashMode: boolean,
	theme: { fg: (color: "accent", text: string) => string },
	paint: (text: string) => string,
): string {
	if (!bashMode) return emptyBorder("╭", "╮", width, paint);
	// Mirrors bottomBorder: mode tag right-aligned before the cap so a `!`
	// prefix is visible before submit. Same predicate as Pi's own bash-mode
	// detection (text.trimStart().startsWith("!")) so they never disagree.
	const label = " ! ";
	const labelWidth = 3;
	if (width < labelWidth + 2) return emptyBorder("╭", "╮", width, paint);
	const fill = Math.max(0, width - 2 - labelWidth);
	return `${paint("╭")}${paint("─".repeat(fill))}${theme.fg("accent", label)}${paint("╮")}`;
}

function bottomBorder(
	width: number,
	clock: string,
	theme: { fg: (color: "dim", text: string) => string },
	paint: (text: string) => string,
): string {
	const label = ` ${clock} `;
	const labelWidth = visibleWidth(label);
	if (width < labelWidth + 2) return emptyBorder("╰", "╯", width, paint);
	const fill = Math.max(0, width - 2 - labelWidth);
	return `${paint("╰")}${paint("─".repeat(fill))}${theme.fg("dim", label)}${paint("╯")}`;
}

export function applyEditor(_pi: unknown, ctx: ExtensionContext): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;

	class ClaudePromptEditor extends CustomEditor {
		constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
			super(tui, theme, keybindings, { paddingX: 0 });
			scheduleClock(tui);
		}

		private innerWidth(width: number): number {
			return Math.max(1, width - SIDE_COLS - PROMPT_COLS);
		}

		render(width: number): string[] {
			// There is not enough room for two borders, the prompt and a cursor.
			// Fall back to Pi's compact editor rather than emitting over-wide lines.
			if (width < SIDE_COLS + PROMPT_COLS + 1) return super.render(Math.max(1, width));
			const innerWidth = this.innerWidth(width);
			const inner = super.render(innerWidth);
			// renderedVisibleLineCount / renderedAutocompleteHeight are Pi
			// internals, not public API. Validate the assumed inner layout of
			// [top border, ...content, bottom border, ...autocomplete] before
			// slicing; fall back to the native render if a Pi update changes it.
			const internals = this as unknown as {
				renderedVisibleLineCount?: unknown;
				renderedAutocompleteHeight?: unknown;
			};
			const rawCount = internals.renderedVisibleLineCount;
			const contentCount =
				typeof rawCount === "number" &&
				Number.isInteger(rawCount) &&
				rawCount >= 1 &&
				rawCount + 2 <= inner.length
					? rawCount
					: 0;
			if (contentCount < 1) return super.render(width);
			const theme = ctx.ui.theme;
			const paint = (text: string) => this.borderColor(text);
			const bottomIndex = 1 + contentCount;
			const rawAuto = internals.renderedAutocompleteHeight;
			const autoHeight =
				typeof rawAuto === "number" && Number.isInteger(rawAuto) && rawAuto > 0
					? Math.min(rawAuto, Math.max(0, inner.length - bottomIndex - 1))
					: 0;
			const prompt = theme.fg("accent", "❯");

			const bashMode = this.getText().trimStart().startsWith("!");
			const out: string[] = [];
			out.push(topBorder(width, bashMode, theme, paint));

			for (let i = 0; i < contentCount; i++) {
				const content = padVisible(inner[1 + i] ?? "", innerWidth);
				const prefix = i === 0 ? `${prompt} ` : "  ";
				out.push(`${paint("│")}${prefix}${content}${paint("│")}`);
			}

			out.push(bottomBorder(width, formatClock(), theme, paint));

			for (let i = 0; i < autoHeight; i++) {
				const line = inner[bottomIndex + 1 + i] ?? "";
				// Match the text area's x origin: border + two-column prompt.
				out.push(padVisible(`${" ".repeat(SIDE_COLS / 2 + PROMPT_COLS)}${line}`, width));
			}

			return out;
		}

		handleMouse(event: TuiMouseEvent) {
			if (event.width < SIDE_COLS + PROMPT_COLS + 1) return super.handleMouse(event);
			const innerWidth = this.innerWidth(event.width);
			return super.handleMouse({
				...event,
				x: event.x - (SIDE_COLS / 2 + PROMPT_COLS),
				width: innerWidth,
			});
		}
	}

	ctx.ui.setEditorComponent((tui, theme, keybindings) => new ClaudePromptEditor(tui, theme, keybindings));
}

export function stopEditorClock(): void {
	if (clockTimer) {
		clearTimeout(clockTimer);
		clockTimer = undefined;
	}
}
