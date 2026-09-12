import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth } from "@earendil-works/pi-tui";
import { asRecord, callArgument, groupHeader } from "./format.ts";

type Styler = { fg: (color: string, text: string) => string };

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

/**
 * Live theme lookup. `@earendil-works/pi-coding-agent` does not re-export its
 * `theme` singleton from the package root (only `Theme`, `initTheme`, …), so
 * `import { theme }` binds `undefined` and `theme.fg()` throws
 * "Cannot read properties of undefined (reading 'fg')" the first time a
 * tool group renders collapsed. Read the same globalThis slot pi's own Proxy
 * reads, so /theme switches are picked up; fall back to unstyled text rather
 * than crashing when no theme is initialized yet.
 */
function theme(): Styler {
	const g = globalThis as Record<symbol, unknown>;
	const t = (g[THEME_KEY] ?? g[THEME_KEY_OLD]) as Styler | undefined;
	if (t && typeof t.fg === "function") return t;
	return { fg: (_color: string, text: string) => text };
}

const PATCH = Symbol.for("claude-code-ui:tool-group:v1");

type ToolLike = ToolExecutionComponent & {
	toolName: string;
	toolDefinition?: { label?: string };
	args: unknown;
	cwd?: string;
	isPartial: boolean;
	expanded: boolean;
	result?: { isError?: boolean };
};

/**
 * Consecutive same-tool calls collapse into one row once they all settle:
 *   ⏺ Read 3 files
 *     ⎿  a.ts, b.ts, c.ts
 * While any member is still running, or when expanded (Ctrl+O), children
 * render as-is so spinners, live previews and diffs keep working untouched.
 */
export class ToolGroupComponent extends Container {
	private expanded = false;

	get tools(): ToolLike[] {
		return this.children as ToolLike[];
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		for (const tool of this.tools) tool.setExpanded(expanded);
	}

	private collapsed(): boolean {
		return !this.expanded && this.tools.every((tool) => !tool.isPartial);
	}

	override handleMouse(event: Parameters<Container["handleMouse"]>[0]) {
		return this.collapsed() ? undefined : super.handleMouse(event);
	}

	override render(width: number): string[] {
		if (!this.collapsed()) return super.render(width);
		const tools = this.tools;
		const first = tools[0];
		const failed = tools.filter((tool) => tool.result?.isError).length;
		const t = theme();
		const bullet = failed ? t.fg("error", "⏺") : t.fg("text", "⏺");
		const header = `${bullet} ${t.fg("text", groupHeader(first.toolName, first.toolDefinition?.label, tools.length))}`;
		const args = tools
			.map((tool) => callArgument(tool.toolName, asRecord(tool.args), tool.cwd))
			.filter(Boolean)
			.join(", ");
		const detail = failed ? `${args ? `${args} · ` : ""}${failed} failed` : args || "Done";
		const connector = t.fg("dim", "⎿");
		const body = truncateToWidth(t.fg(failed ? "error" : "muted", detail), Math.max(1, width - 5), "…");
		return ["", header, `  ${connector}  ${body}`];
	}
}

type ContainerProto = Container & { [PATCH]?: { addChild: Container["addChild"] } };

function isTool(value: unknown): value is ToolLike {
	return value instanceof ToolExecutionComponent;
}

function isSeparator(value: unknown): boolean {
	const name = (value as { constructor?: { name?: string } })?.constructor?.name;
	if (name === "Spacer") return true;
	if (name === "AssistantMessageComponent") {
		// Empty assistant framing (tool-call-only turns) must not split a group;
		// any visible content (text, live thinking, Thought for Xs) does.
		const kids = (value as { contentContainer?: { children?: unknown[] } }).contentContainer?.children ?? [];
		return kids.every((kid) => (kid as { constructor?: { name?: string } })?.constructor?.name === "Spacer");
	}
	return false;
}

function maybeGroup(parent: Container, component: unknown): void {
	if (!isTool(component) || parent instanceof ToolGroupComponent || parent instanceof ToolExecutionComponent) return;
	const children = parent.children;
	const index = children.lastIndexOf(component);
	let prevIndex = index - 1;
	while (prevIndex >= 0 && isSeparator(children[prevIndex])) prevIndex--;
	if (prevIndex < 0) return;
	const previous = children[prevIndex];

	if (previous instanceof ToolGroupComponent) {
		if (previous.tools[0]?.toolName !== component.toolName) return;
		children.splice(index, 1);
		previous.children.push(component);
		return;
	}
	if (isTool(previous) && previous.toolName === component.toolName) {
		const group = new ToolGroupComponent();
		group.children.push(previous, component);
		group.setExpanded(Boolean(previous.expanded));
		children.splice(index, 1);
		children[prevIndex] = group;
	}
}

/** Patch Container.addChild so adjacent same-tool rows fold into a ToolGroupComponent. */
export function installToolGrouping(): () => void {
	const proto = Container.prototype as ContainerProto;
	if (proto[PATCH]) proto.addChild = proto[PATCH].addChild;
	const original = proto.addChild;
	proto[PATCH] = { addChild: original };
	proto.addChild = function (this: Container, component: Parameters<Container["addChild"]>[0]) {
		original.call(this, component);
		maybeGroup(this, component);
	};
	return () => {
		if (proto[PATCH]?.addChild !== original) return;
		proto.addChild = original;
		delete proto[PATCH];
	};
}
