import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type Theme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { keepOwnRenderer, resultIsVisiblyEmpty, shouldFallbackEmptyResult } from "./keep-renderer.ts";
import {
	renderCallLine,
	renderResultBlock,
	type ClaudeToolRenderContext,
	type ToolSpinnerState,
} from "./tool-render.ts";

const PATCH = Symbol.for("claude-code-ui:mcp-tool-patch:v1");

type ToolDefinitionLike = {
	label?: string;
	renderCall?: unknown;
	renderResult?: unknown;
	renderShell?: string;
};

type PatchedPrototype = Record<PropertyKey, unknown> & {
	toolName: string;
	toolDefinition?: ToolDefinitionLike;
	cwd?: string;
	getCallRenderer: () => unknown;
	getResultRenderer: () => unknown;
	getRenderShell: () => string;
	hasRendererDefinition: () => boolean;
};

type OriginalMethods = Pick<
	PatchedPrototype,
	"getCallRenderer" | "getResultRenderer" | "getRenderShell" | "hasRendererDefinition"
>;

type PatchState = OriginalMethods;

type StockPair = { call?: unknown; result?: unknown };

let stockCache: Record<string, StockPair> | undefined;

function pickStock(definition: { renderCall?: unknown; renderResult?: unknown }): StockPair {
	return { call: definition.renderCall, result: definition.renderResult };
}

function stockRenderers(): Record<string, StockPair> {
	if (stockCache) return stockCache;
	try {
		stockCache = {
			read: pickStock(createReadToolDefinition(".")),
			edit: pickStock(createEditToolDefinition(".")),
			write: pickStock(createWriteToolDefinition(".")),
			grep: pickStock(createGrepToolDefinition(".")),
			find: pickStock(createFindToolDefinition(".")),
			ls: pickStock(createLsToolDefinition(".")),
		};
	} catch {
		// ponytail: if Pi's definition factories change, restyle every builtin
		stockCache = {};
	}
	return stockCache;
}

function stockFor(toolName: string, which: "call" | "result"): unknown {
	return stockRenderers()[toolName]?.[which];
}

function existingRenderers(instance: PatchedPrototype, state: PatchState): { call: unknown; result: unknown } {
	return {
		call: state.getCallRenderer.call(instance),
		result: state.getResultRenderer.call(instance),
	};
}

function keepers(instance: PatchedPrototype, state: PatchState) {
	const { call, result } = existingRenderers(instance, state);
	return {
		call,
		result,
		keepCall: keepOwnRenderer(instance.toolName, call, stockFor(instance.toolName, "call")),
		keepResult: keepOwnRenderer(instance.toolName, result, stockFor(instance.toolName, "result")),
	};
}

function restoreExistingPatch(proto: PatchedPrototype): void {
	const existing = proto[PATCH];
	if (!existing || typeof existing !== "object") return;
	const original = existing as Partial<OriginalMethods>;
	if (typeof original.getCallRenderer === "function") proto.getCallRenderer = original.getCallRenderer;
	if (typeof original.getResultRenderer === "function") proto.getResultRenderer = original.getResultRenderer;
	if (typeof original.getRenderShell === "function") proto.getRenderShell = original.getRenderShell;
	if (typeof original.hasRendererDefinition === "function") {
		proto.hasRendererDefinition = original.hasRendererDefinition;
	}
	delete proto[PATCH];
}

function callRenderer(toolName: string, definition: ToolDefinitionLike | undefined, cwd: string | undefined) {
	return (args: unknown, theme: Theme, context: ClaudeToolRenderContext<ToolSpinnerState>) =>
		new Text(renderCallLine(toolName, definition, args, theme, cwd, context), 0, 0);
}

function resultRenderer(toolName: string) {
	return (
		result: { content?: Array<{ type?: string; text?: string }>; details?: unknown },
		options: { expanded: boolean; isPartial: boolean },
		theme: Theme,
		context: ClaudeToolRenderContext,
	) => new Text(renderResultBlock(toolName, context.args, result, options, theme, context), 0, 0);
}

type ResultRenderer = (
	result: { content?: Array<{ type?: string; text?: string }>; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
	context: ClaudeToolRenderContext,
) => { render?: (width: number) => string[] };

function withEmptyResultFallback(toolName: string, keepCall: boolean, keepResult: boolean, own: unknown) {
	if (typeof own !== "function") return resultRenderer(toolName);
	const fallback = resultRenderer(toolName);
	return (result: Parameters<ResultRenderer>[0], options: Parameters<ResultRenderer>[1], theme: Theme, context: ClaudeToolRenderContext) => {
		const rendered = (own as ResultRenderer)(result, options, theme, context);
		if (shouldFallbackEmptyResult(keepCall, keepResult, resultIsVisiblyEmpty(rendered))) {
			return fallback(result, options, theme, context);
		}
		return rendered;
	};
}

/**
 * Install display-only render fallbacks. This deliberately does not register or
 * replace tools, so sandbox/SSH/permission extensions keep control of execution.
 */
export function installMcpWrap(): () => void {
	const proto = ToolExecutionComponent.prototype as unknown as PatchedPrototype;

	// Recover from the pre-uninstall implementation during the first hot reload,
	// and replace an older live copy with this module's latest implementation.
	restoreExistingPatch(proto);

	const state: PatchState = {
		getCallRenderer: proto.getCallRenderer,
		getResultRenderer: proto.getResultRenderer,
		getRenderShell: proto.getRenderShell,
		hasRendererDefinition: proto.hasRendererDefinition,
	};
	proto[PATCH] = state;

	proto.hasRendererDefinition = function (this: PatchedPrototype) {
		const { keepCall, keepResult } = keepers(this, state);
		return keepCall && keepResult ? state.hasRendererDefinition.call(this) : true;
	};

	proto.getRenderShell = function (this: PatchedPrototype) {
		const { keepCall, keepResult } = keepers(this, state);
		return keepCall && keepResult ? state.getRenderShell.call(this) : "self";
	};

	proto.getCallRenderer = function (this: PatchedPrototype) {
		const { call, keepCall } = keepers(this, state);
		return keepCall ? call : callRenderer(this.toolName, this.toolDefinition, this.cwd);
	};

proto.getResultRenderer = function (this: PatchedPrototype) {
	const { result, keepCall, keepResult } = keepers(this, state);
	if (!keepResult) return resultRenderer(this.toolName);
	return withEmptyResultFallback(this.toolName, keepCall, keepResult, result);
};

	return () => {
		if (proto[PATCH] !== state) return;
		proto.getCallRenderer = state.getCallRenderer;
		proto.getResultRenderer = state.getResultRenderer;
		proto.getRenderShell = state.getRenderShell;
		proto.hasRendererDefinition = state.hasRendererDefinition;
		delete proto[PATCH];
	};
}
