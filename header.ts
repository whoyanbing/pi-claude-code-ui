import { VERSION, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { homePath } from "./format.ts";

export const BANNER_TYPE = "claude-code-banner";

const LOGO = [" ▐▛███▜▌", "▝▜█████▛▘", "  ▘▘ ▝▝"];

type BannerData = {
	cwd?: string;
};

function bannerLines(theme: Theme, data: BannerData): string[] {
	const logoWidth = Math.max(...LOGO.map((line) => visibleWidth(line)));
	const gap = 3;
	const logo = LOGO.map((line) => theme.fg("accent", line.padEnd(logoWidth, " ")));
	const cwd = homePath(data.cwd) || data.cwd || "";
	const right = [
		`${theme.bold(theme.fg("text", "Pi"))}${theme.fg("dim", ` v${VERSION}`)}`,
		theme.fg("dim", cwd),
	];
	const lines = [""];
	for (let i = 0; i < 3; i++) {
		const left = logo[i] ?? " ".repeat(logoWidth);
		const text = right[i] ?? "";
		lines.push(`${left}${" ".repeat(gap)}${text}`);
	}
	lines.push("");
	return lines;
}

export function applyHeader(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;
	const hasBanner = ctx.sessionManager
		.getBranch()
		.some((entry) => entry.type === "custom" && entry.customType === BANNER_TYPE);
	if (!hasBanner) {
		// Keep Pi's built-in header for legacy sessions. Appending a banner to a
		// resumed transcript would put it at the bottom rather than at startup.
		ctx.ui.setHeader(undefined);
		return;
	}
	ctx.ui.setHeader(() => ({
		render: () => [],
		invalidate() {},
	}));
}

export function registerBanner(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<BannerData>(BANNER_TYPE, (entry, _options, theme) => {
		return new Text(bannerLines(theme, entry.data ?? {}).join("\n"), 0, 0);
	});
}

export function maybeShowBanner(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	reason: "startup" | "reload" | "new" | "resume" | "fork",
): void {
	// Reload/resume replay an existing transcript. Never append a startup card
	// at the current leaf, where it would appear at the bottom of the chat.
	if (reason === "reload" || reason === "resume") return;
	const branch = ctx.sessionManager.getBranch();
	const exists = branch.some((entry) => entry.type === "custom" && entry.customType === BANNER_TYPE);
	if (exists || branch.length > 0) return;
	pi.appendEntry<BannerData>(BANNER_TYPE, {
		cwd: ctx.cwd,
	});
}
