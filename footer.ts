import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { cacheHitSignature, latestCacheHitPercent, type CacheHitEntry } from "./format.ts";

function formatTokens(tokens: number): string {
	if (tokens < 1000) return `${tokens}`;
	if (tokens < 999_500) {
		const k = tokens / 1000;
		return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
	}
	if (tokens < 99_950_000) {
		const m = tokens / 1_000_000;
		return m < 10 ? `${m.toFixed(2)}M` : `${m.toFixed(1)}M`;
	}
	return `${Math.round(tokens / 1_000_000)}M`;
}

export function applyFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsub = footerData.onBranchChange(() => tui.requestRender());
		let cacheSig = "";
		let cacheHit: number | undefined;
		return {
			dispose() {
				unsub();
			},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model?.name || ctx.model?.id || "model";
				const thinking = pi.getThinkingLevel();
				const thinkingLabel = thinking && thinking !== "off" ? thinking : "";
				const usage = ctx.getContextUsage();
				const usageNumbers =
					usage?.tokens != null
						? `${formatTokens(usage.tokens)}/${formatTokens(usage.contextWindow)}`
						: "";
				const ctxLabel =
					usage?.percent != null
						? usageNumbers
							? `${Math.round(usage.percent)}% (${usageNumbers})`
							: `${Math.round(usage.percent)}%`
						: usageNumbers;
				const sig = cacheHitSignature(ctx.sessionManager.getLeafEntry() as CacheHitEntry | undefined);
				if (sig !== cacheSig) {
					cacheSig = sig;
					cacheHit = latestCacheHitPercent(ctx.sessionManager.getBranch());
				}
				const cacheSegment =
					cacheHit == null ? "" : theme.fg("muted", `CH${Math.round(cacheHit)}%`);
				const folder = path.basename(ctx.cwd) || ctx.cwd;
				const branch = footerData.getGitBranch();
				const branchSegment = !branch
					? ""
					: branch === "detached"
						? theme.fg("dim", "detached")
						: theme.fg("accent", branch);
				// Context usage color escalates as the window fills up.
				const ctxColor =
					usage?.percent != null && usage.percent >= 95
						? "error"
						: usage?.percent != null && usage.percent >= 80
							? "warning"
							: "muted";
				const sep = theme.fg("dim", " · ");
				const line = [
						theme.fg("text", model),
						thinkingLabel ? theme.fg("accent", thinkingLabel) : "",
						ctxLabel ? theme.fg(ctxColor, ctxLabel) : "",
						cacheSegment,
						folder ? theme.fg("muted", folder) : "",
						branchSegment,
					]
						.filter(Boolean)
						.join(sep);
				return [truncateToWidth(`  ${line}${" ".repeat(Math.max(0, width - visibleWidth(line) - 2))}`, width)];
			},
		};
	});
}
