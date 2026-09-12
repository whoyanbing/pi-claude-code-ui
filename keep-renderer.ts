export const BUILTINS = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

/**
 * Keep a tool's own renderer.
 * Non-builtins keep whatever they shipped. Builtins restyle Pi's stock
 * renderers and keep replacements (hashline `read`). bash/powershell have
 * no stable stock identity (new factory each time) so they always restyle.
 */
export function keepOwnRenderer(toolName: string, renderer: unknown, stock: unknown): boolean {
	if (!renderer) return false;
	if (!BUILTINS.has(toolName)) return true;
	if (stock == null) return false;
	return renderer !== stock;
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** True when a renderer produced no visible lines (hashline collapsed read). */
export function resultIsVisiblyEmpty(component: { render?: (width: number) => string[] } | null | undefined): boolean {
	if (!component || typeof component.render !== "function") return true;
	return !component.render(80).some((line) => line.replace(ANSI, "").trim());
}

/** Mixed path: CC call line + third-party result. Empty result falls back to CC summary. */
export function shouldFallbackEmptyResult(keepCall: boolean, keepResult: boolean, visiblyEmpty: boolean): boolean {
	return keepResult && !keepCall && visiblyEmpty;
}
