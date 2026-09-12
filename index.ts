import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyEditor, stopEditorClock } from "./editor.ts";
import { applyFooter } from "./footer.ts";
import { applyHeader, maybeShowBanner, registerBanner } from "./header.ts";
import { attachLiveThinking, patchLiveThinking } from "./live-thinking.ts";
import { installToolGrouping } from "./tool-group.ts";
import { stopToolSpinners } from "./tool-render.ts";
import { patchUserMessages } from "./user-message.ts";
import { attachWorking } from "./working.ts";
import { installMcpWrap } from "./wrap-tools.ts";

// Renderer strategy: this extension patches ToolExecutionComponent.prototype
// (see wrap-tools.ts) instead of re-registering the built-in tools via
// pi.registerTool(). That is deliberate: createXTool(cwd, options) bakes the
// load-time cwd and operations into the replacement, which would freeze
// relative-path resolution, bypass sandbox/SSH extensions that inject
// operations at session creation, and require us to faithfully forward
// promptSnippet / constrainedSampling / prepareArguments / executionMode to
// avoid behavior drift. The prototype patch is execution-transparent and only
// changes display; tools that own their own renderers are left alone.
const THEME_PAIR = "claude-code-light/claude-code-dark";

// Theme + thinking label are global UI state: apply them once per extension
// load, not on every session_start, so a user who switches themes mid-process
// (/theme, another extension) isn't fought on every /new or /resume. A /reload
// resets this flag (fresh module instance) and re-applies, which is the
// least surprising behavior for "re-apply my extension".
let themeApplied = false;

function applyThemeOnce(ctx: ExtensionContext): void {
	if (themeApplied) return;
	themeApplied = true;
	ctx.ui.setHiddenThinkingLabel("Thinking…");
	const current = ctx.ui.theme?.name ?? "";
	if (!current.startsWith("claude-code-")) {
		ctx.ui.setTheme(THEME_PAIR);
	}
}

function applyChrome(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;
	applyHeader(ctx);
	applyEditor(pi, ctx);
	applyFooter(pi, ctx);
}

export default function (pi: ExtensionAPI) {
	registerBanner(pi);
	attachLiveThinking(pi);

	const ctxHolder: { current?: ExtensionContext } = {};
	const working = attachWorking(ctxHolder, pi);
	let chromeTimer: ReturnType<typeof setTimeout> | undefined;
	let uninstallToolWrap: (() => void) | undefined;
	let unpatchUserMessages: (() => void) | undefined;
	let unpatchLiveThinking: (() => void) | undefined;
	let uninstallGrouping: (() => void) | undefined;

	pi.on("session_start", async (event, ctx) => {
		ctxHolder.current = ctx;
		// Uninstall before the mode check so patches left by a previous TUI
		// session never leak into a non-TUI one. Installation below stays
		// TUI-only.
		uninstallToolWrap?.();
		uninstallToolWrap = undefined;
		unpatchUserMessages?.();
		unpatchUserMessages = undefined;
		unpatchLiveThinking?.();
		unpatchLiveThinking = undefined;
		uninstallGrouping?.();
		uninstallGrouping = undefined;
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		uninstallToolWrap = installMcpWrap();
		unpatchUserMessages = patchUserMessages();
		unpatchLiveThinking = patchLiveThinking();
		uninstallGrouping = installToolGrouping();
		maybeShowBanner(pi, ctx, event.reason);
		applyChrome(pi, ctx);
		applyThemeOnce(ctx);
		// Deferred second pass: other extensions also set chrome in their own
		// session_start, and load order decides who wins. Re-applying on the
		// next tick lets this theme keep its look without a load-order lottery.
		// Guarded by ctx identity so a rapid session switch doesn't paint a
		// stale session's chrome.
		if (chromeTimer) clearTimeout(chromeTimer);
		chromeTimer = setTimeout(() => {
			chromeTimer = undefined;
			if (ctxHolder.current === ctx) applyChrome(pi, ctx);
		}, 0);
		chromeTimer.unref?.();
	});

	pi.on("agent_start", async (_event, ctx) => {
		ctxHolder.current = ctx;
		working.start(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		working.stop(ctx);
		// repaint=true: force one final paint so rows settle on ⏺ now
		// instead of keeping the last spinner frame (see tool-render.ts).
		stopToolSpinners(true);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (chromeTimer) {
			clearTimeout(chromeTimer);
			chromeTimer = undefined;
		}
		working.stop(ctx);
		working.dispose();
		// repaint=false: components are being discarded; just forget them.
		// Invalidating here would re-register rows against a dead UI.
		stopToolSpinners(false);
		stopEditorClock();
		unpatchUserMessages?.();
		unpatchUserMessages = undefined;
		unpatchLiveThinking?.();
		unpatchLiveThinking = undefined;
		uninstallGrouping?.();
		uninstallGrouping = undefined;
		uninstallToolWrap?.();
		uninstallToolWrap = undefined;
		ctxHolder.current = undefined;
	});
}
