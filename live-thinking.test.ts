import assert from "node:assert/strict";
import test from "node:test";
import {
	formatThoughtDuration,
	isAssistantThinkingComplete,
	isLiveThinkingMessage,
	isThinkingPlaceholderText,
	THINKING_ACTIVE_KEY,
	thoughtSummaryLabel,
} from "./live-thinking-logic.ts";

test("formatThoughtDuration", () => {
	assert.equal(formatThoughtDuration(0), "1s");
	assert.equal(formatThoughtDuration(1200), "1s");
	assert.equal(formatThoughtDuration(12_400), "12s");
	assert.equal(formatThoughtDuration(65_000), "1m 5s");
	assert.equal(formatThoughtDuration(3_661_000), "1h 1m 1s");
});

test("isAssistantThinkingComplete", () => {
	assert.equal(isAssistantThinkingComplete(undefined), false);
	assert.equal(
		isAssistantThinkingComplete({
			role: "assistant",
			stopReason: "pending",
			content: [{ type: "thinking", thinking: "hmm" }],
		}),
		false,
	);
	// Still pending: content heuristic does not override; event tracking stamps duration.
	assert.equal(
		isAssistantThinkingComplete({
			role: "assistant",
			stopReason: "pending",
			content: [
				{ type: "thinking", thinking: "hmm" },
				{ type: "text", text: "done" },
			],
		}),
		false,
	);
	assert.equal(
		isAssistantThinkingComplete({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "hmm" },
				{ type: "text", text: "done" },
			],
		}),
		true,
	);
	assert.equal(
		isAssistantThinkingComplete({
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "thinking", thinking: "hmm" }],
		}),
		true,
	);
	assert.equal(
		isAssistantThinkingComplete({
			role: "assistant",
			[THINKING_ACTIVE_KEY]: true,
			content: [{ type: "thinking", thinking: "hmm" }],
		}),
		false,
	);
});

test("isLiveThinkingMessage + summary", () => {
	const live = {
		role: "assistant",
		stopReason: "pending",
		content: [{ type: "thinking", thinking: "planning" }],
	};
	assert.equal(isLiveThinkingMessage(live), true);
	assert.equal(thoughtSummaryLabel({ role: "assistant", content: [{ type: "thinking", thinking: "x".repeat(300) }] }), "Thought for 2s ▸");
	assert.equal(isThinkingPlaceholderText("Thinking…"), true);
	assert.equal(isThinkingPlaceholderText("Thought for 3s"), true);
	assert.equal(isThinkingPlaceholderText("hello"), false);
});
