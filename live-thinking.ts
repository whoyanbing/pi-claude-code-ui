import {
	AssistantMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
	theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	isLiveThinkingMessage,
	isThinkingPlaceholderText,
	messageHasThinking,
	THINKING_ACTIVE_KEY,
	THINKING_DURATION_KEY,
	thoughtSummaryLabel,
	type ThinkingMessage,
} from "./live-thinking-logic.ts";

const PATCH = Symbol.for("claude-code-ui:live-thinking:v1");
const ANSI = /\x1b\[[0-9;]*m/g;

type AssistantProto = Record<PropertyKey, unknown> & {
	updateContent(message: unknown, isStreaming?: boolean): void;
	hideThinkingBlock?: boolean;
	hiddenThinkingLabel?: string;
	contentContainer?: { children?: unknown[] };
};

type PatchState = {
	updateContent: AssistantProto["updateContent"];
}

let thinkingStartMs = 0;
let thinkingInFlight = false;
let lastDurationMs: number | undefined;

function styledSummary(label: string): string {
	return theme.italic(theme.fg("thinkingText", label));
}

function plainText(child: unknown): string {
	return String((child as { text?: string })?.text ?? "")
		.replace(ANSI, "")
		.trim();
}

function isThinkingPlaceholder(child: unknown): child is Text {
	if (!(child instanceof Text) && (child as { constructor?: { name?: string } })?.constructor?.name !== "Text") {
		return false;
	}
	return isThinkingPlaceholderText(plainText(child));
}

function unwrapChild(child: unknown): unknown {
	return (child as { child?: unknown })?.child ?? child;
}

function replaceHiddenThinkingPlaceholders(container: { children?: unknown[] }, message: ThinkingMessage): void {
	if (!container.children) return;
	const label = styledSummary(thoughtSummaryLabel(message, lastDurationMs));
	let replaced = false;
	for (let i = 0; i < container.children.length; i++) {
		const child = container.children[i];
		const inner = unwrapChild(child);
		if (!isThinkingPlaceholder(inner)) continue;
		if (!replaced) {
			(inner as Text).setText(label);
			replaced = true;
		} else {
			container.children.splice(i, 1);
			i--;
		}
	}
}

function restoreExistingPatch(proto: AssistantProto): void {
	const existing = proto[PATCH];
	if (existing && typeof existing === "object") {
		const state = existing as Partial<PatchState>;
		if (typeof state.updateContent === "function") proto.updateContent = state.updateContent;
		delete proto[PATCH];
	}
}

function refreshUi(ctx?: ExtensionContext): void {
	try {
		ctx?.ui?.invalidate?.();
		ctx?.ui?.requestRender?.();
	} catch {
		/* noop */
	}
}

function markThinkingComplete(message: ThinkingMessage | undefined, duration?: number): void {
	thinkingInFlight = false;
	if (!message || message.role !== "assistant") return;
	delete message[THINKING_ACTIVE_KEY];
	const ms =
		typeof duration === "number"
			? duration
			: thinkingStartMs > 0
				? Math.max(0, Date.now() - thinkingStartMs)
				: undefined;
	if (typeof ms === "number") {
		lastDurationMs = ms;
		message[THINKING_DURATION_KEY] = ms;
	} else if (typeof lastDurationMs === "number" && typeof message[THINKING_DURATION_KEY] !== "number") {
		message[THINKING_DURATION_KEY] = lastDurationMs;
	}
}

function trackThinkingEvent(
	event: {
		assistantMessageEvent?: { type?: string };
		message?: ThinkingMessage;
	},
	ctx?: ExtensionContext,
): void {
	const evt = event.assistantMessageEvent;
	const message = event.message;
	if (!evt?.type) return;

	if (evt.type === "thinking_start") {
		thinkingInFlight = true;
		thinkingStartMs = Date.now();
		lastDurationMs = undefined;
		if (message?.role === "assistant") {
			message[THINKING_ACTIVE_KEY] = true;
			delete message[THINKING_DURATION_KEY];
		}
		refreshUi(ctx);
		return;
	}

	if (evt.type === "thinking_end") {
		markThinkingComplete(message, Math.max(0, Date.now() - thinkingStartMs));
		refreshUi(ctx);
		return;
	}

	if (
		(message?.[THINKING_ACTIVE_KEY] || thinkingInFlight) &&
		(evt.type === "text_start" || evt.type === "toolcall_start")
	) {
		markThinkingComplete(message);
		refreshUi(ctx);
	}
}

/** Register stream-event bookkeeping. Safe to call once per extension load. */
export function attachLiveThinking(pi: ExtensionAPI): void {
	pi.on("message_start", async (event) => {
		const message = (event as { message?: ThinkingMessage }).message;
		if (message?.role === "assistant") {
			thinkingInFlight = false;
			delete message[THINKING_ACTIVE_KEY];
		}
	});

	pi.on("message_update", async (event, ctx) => {
		trackThinkingEvent(event as { assistantMessageEvent?: { type?: string }; message?: ThinkingMessage }, ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		const message = (event as { message?: ThinkingMessage }).message;
		if (message?.role !== "assistant") return;
		if (message[THINKING_ACTIVE_KEY] || thinkingInFlight || typeof message[THINKING_DURATION_KEY] !== "number") {
			markThinkingComplete(message);
			thinkingStartMs = 0;
			refreshUi(ctx);
		}
	});
}

/** Prototype patch: live expand while streaming, collapse to Thought for Xs after. */
export function patchLiveThinking(): () => void {
	const proto = AssistantMessageComponent.prototype as unknown as AssistantProto;
	restoreExistingPatch(proto);

	const state: PatchState = {
		updateContent: proto.updateContent,
	};
	proto[PATCH] = state;

	proto.updateContent = function (this: AssistantProto, message: unknown, isStreaming?: boolean) {
		const msg = message as ThinkingMessage;
		const collapsed = !!this.hideThinkingBlock;
		const live = collapsed && isLiveThinkingMessage(msg);

		if (collapsed && messageHasThinking(msg)) {
			// Live: generic label. Done: summary so click-collapse keeps "Thought for Xs ▸".
			this.hiddenThinkingLabel = live
				? "Thinking…"
				: thoughtSummaryLabel(msg, lastDurationMs);
		}
		if (live) this.hideThinkingBlock = false;
		try {
			state.updateContent.call(this, message, isStreaming);
		} finally {
			if (live) this.hideThinkingBlock = true;
		}

		if (collapsed && !live && messageHasThinking(msg) && this.contentContainer) {
			replaceHiddenThinkingPlaceholders(this.contentContainer, msg);
		}
	};

	return () => {
		if (proto[PATCH] !== state) return;
		proto.updateContent = state.updateContent;
		delete proto[PATCH];
	};
}
