import { formatDuration } from "./format.ts";

export const THINKING_DURATION_KEY = "_ccuiThinkingDurationMs";
export const THINKING_ACTIVE_KEY = "_ccuiThinkingActive";

export type ThinkingMessage = {
	role?: string;
	stopReason?: string;
	content?: Array<{ type?: string; thinking?: string; text?: string }>;
	[THINKING_DURATION_KEY]?: number;
	[THINKING_ACTIVE_KEY]?: boolean;
};

export function formatThoughtDuration(ms: number): string {
	return formatDuration(ms, "thought");
}

export function isAssistantThinkingComplete(message: ThinkingMessage | undefined): boolean {
	if (!message || message.role !== "assistant") return false;
	if (typeof message[THINKING_DURATION_KEY] === "number") return true;
	if (message[THINKING_ACTIVE_KEY]) return false;
	if (message.stopReason === "pending" || message.stopReason === "deferred") return false;
	if (typeof message.stopReason === "string" && message.stopReason.length > 0) return true;
	if (Array.isArray(message.content)) {
		let sawThinking = false;
		for (const block of message.content) {
			if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
				sawThinking = true;
			} else if (
				sawThinking &&
				((block?.type === "text" && typeof block.text === "string" && block.text.trim()) ||
					block?.type === "toolCall")
			) {
				return true;
			}
		}
		if (sawThinking) return false;
	}
	return true;
}

export function messageHasThinking(message: ThinkingMessage | undefined): boolean {
	return !!message?.content?.some(
		(block) => block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim(),
	);
}

export function isLiveThinkingMessage(message: ThinkingMessage | undefined): boolean {
	if (!message || message.role !== "assistant") return false;
	if (isAssistantThinkingComplete(message)) return false;
	if (message[THINKING_ACTIVE_KEY]) return true;
	return messageHasThinking(message);
}

export function estimateThinkingDurationMs(
	message: ThinkingMessage | undefined,
	lastDurationMs?: number,
): number {
	const stored = message?.[THINKING_DURATION_KEY];
	if (typeof stored === "number" && stored > 0) return stored;
	if (typeof lastDurationMs === "number" && lastDurationMs > 0) return lastDurationMs;
	let chars = 0;
	for (const block of message?.content ?? []) {
		if (block?.type === "thinking" && typeof block.thinking === "string") chars += block.thinking.length;
	}
	return Math.max(1000, Math.round((chars / 150) * 1000));
}

export function thoughtSummaryLabel(
	message: ThinkingMessage | undefined,
	lastDurationMs?: number,
): string {
	const ms = estimateThinkingDurationMs(message, lastDurationMs);
	if (message) message[THINKING_DURATION_KEY] = ms;
	return `Thought for ${formatThoughtDuration(ms)} ▸`;
}

export function isThinkingPlaceholderText(plain: string): boolean {
	return (
		/^[✻∴]?\s*Thinking/i.test(plain) ||
		/^Thought for\b/i.test(plain) ||
		/^Thinking…$/i.test(plain) ||
		/^Thinking\.\.\.$/i.test(plain)
	);
}
