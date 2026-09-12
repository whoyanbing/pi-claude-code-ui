import { type Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	renderCallLine,
	renderResultBlock,
	type ClaudeToolRenderContext,
	type ToolSpinnerState,
} from "./tool-render.ts";

const PATCH = Symbol.for("claude-code-ui:mcp-tool-patch:v1");
const BUILTINS = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

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

function existingRenderers(instance: PatchedPrototype, state: PatchState): { call: unknown; result: unknown } {
	return {
		call: state.getCallRenderer.call(instance),
		result: state.getResultRenderer.call(instance),
	};
}

/** Third-party tools that already own a renderer keep it. Built-ins are restyled. */
function ownsRenderer(instance: PatchedPrototype, state: PatchState): boolean {
	if (BUILTINS.has(instance.toolName)) return false;
	const { call, result } = existingRenderers(instance, state);
	return Boolean(call || result);
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
		// Unknown/restored tool calls have no definition, but can still use our fallback.
		return ownsRenderer(this, state) ? state.hasRendererDefinition.call(this) : true;
	};

	proto.getRenderShell = function (this: PatchedPrototype) {
		return ownsRenderer(this, state) ? state.getRenderShell.call(this) : "self";
	};

	proto.getCallRenderer = function (this: PatchedPrototype) {
		if (ownsRenderer(this, state)) return existingRenderers(this, state).call;
		return callRenderer(this.toolName, this.toolDefinition, this.cwd);
	};

	proto.getResultRenderer = function (this: PatchedPrototype) {
		if (ownsRenderer(this, state)) return existingRenderers(this, state).result;
		return resultRenderer(this.toolName);
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
