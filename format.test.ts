import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import {
	callArgument,
	cleanBashOutput,
	groupHeader,
	tailLines,
	clip,
	countDiffStats,
	formatDuration,
	formatResultBody,
	homePath,
	cacheHitSignature,
	latestCacheHitPercent,
	oneLine,
	resultText,
	shortPath,
	summarizeResult,
	titleForTool,
} from "./format.ts";

describe("clip", () => {
	it("truncates ascii with ellipsis", () => {
		assert.equal(clip("a".repeat(100)), `${"a".repeat(71)}…`);
	});
	it("keeps cjk within width", () => {
		assert.equal(clip("中文测试".repeat(9)), "中文测试".repeat(9));
	});
	it("truncates emoji by width", () => {
		assert.equal(clip("🎉".repeat(40)), `${"🎉".repeat(35)}…`);
	});
	it("leaves short text alone", () => {
		assert.equal(clip("hi"), "hi");
	});
});

describe("paths", () => {
	const home = homedir();
	it("homePath shortens home", () => {
		assert.equal(homePath(`${home}/x.ts`), "~/x.ts");
		assert.equal(homePath("/tmp/x"), "/tmp/x");
	});
	it("shortPath prefers cwd then home", () => {
		assert.equal(shortPath("/a/work/x.ts", "/a/work"), "x.ts");
		assert.equal(shortPath(`${home}/x.ts`), "~/x.ts");
	});
	it("formatDuration", () => {
		assert.equal(formatDuration(5000), "5s");
		assert.equal(formatDuration(65_000), "1m 5s");
		assert.equal(formatDuration(0, "thought"), "1s");
		assert.equal(formatDuration(3_661_000, "thought"), "1h 1m 1s");
	});
});

describe("titles and args", () => {
	it("titleForTool", () => {
		assert.equal(titleForTool("bash"), "Bash");
		assert.equal(titleForTool("webFetch"), "Web Fetch");
		assert.equal(titleForTool("foo", "mcp__ Tavily Search"), "mcp__ Tavily Search");
	});
	it("callArgument", () => {
		assert.equal(callArgument("bash", { command: "ls -la /tmp" }), "ls -la /tmp");
		assert.equal(callArgument("read", { path: "/a/work/x.ts" }, "/a/work"), "x.ts");
		assert.equal(callArgument("grep", { pattern: "foo.*bar", path: "/tmp" }), '"foo.*bar" in /tmp');
		assert.equal(callArgument("find", { pattern: "*.ts", path: "/tmp" }), "*.ts in /tmp");
		assert.equal(callArgument("tavily_search", { query: "hello world", max_results: 5 }), "hello world");
	});
	it("oneLine", () => {
		assert.equal(oneLine({ a: 1 }), '{"a":1}');
		assert.equal(oneLine(null), "");
	});
});

describe("results", () => {
	it("summarizeResult", () => {
		const diff = "--- a\n+++ b\n@@\n-1\n+2\n+3\n";
		assert.equal(
			summarizeResult({ toolName: "edit", args: {}, text: "", isError: false, isPartial: false, details: { diff } }),
			"Added 2 lines, removed 1",
		);
		assert.equal(
			summarizeResult({ toolName: "grep", args: {}, text: "No matches found", isError: false, isPartial: false }),
			"No matches found",
		);
		assert.equal(
			summarizeResult({ toolName: "bash", args: {}, text: "ok\nexit code: 0", isError: false, isPartial: false }),
			"ok",
		);
		assert.equal(
			summarizeResult({ toolName: "bash", args: {}, text: "Error: boom\nline2", isError: true, isPartial: false }),
			"Error: boom",
		);
		assert.equal(
			summarizeResult({ toolName: "read", args: {}, text: "", isError: false, isPartial: false, hasImage: true }),
			"Read image",
		);
	});
	it("formatResultBody", () => {
		assert.deepEqual(formatResultBody("l1\nl2\nl3", false), ["l1 … +2 lines"]);
		assert.deepEqual(formatResultBody("l1\nl2\nl3", true), ["l1", "l2", "l3"]);
	});
	it("countDiffStats/resultText/cleanBashOutput", () => {
		assert.deepEqual(countDiffStats("--- a\n+++ b\n+1\n-2\n context"), { added: 1, removed: 1 });
		assert.equal(resultText({ content: [{ type: "text", text: "hi" }, { type: "image" }] }), "hi");
		assert.equal(cleanBashOutput("out\nexit code: 1  "), "out");
	});
	it("groupHeader pluralizes per tool", () => {
		assert.equal(groupHeader("read", undefined, 3), "Read 3 files");
		assert.equal(groupHeader("grep", undefined, 1), "Grep 1 pattern");
		assert.equal(groupHeader("mcp_foo_bar", undefined, 2), "Foo Bar 2 calls");
	});
	it("tailLines keeps last N and counts the rest", () => {
		assert.deepEqual(tailLines(""), []);
		assert.deepEqual(tailLines("a\n\nb"), ["a", "b"]);
		assert.deepEqual(tailLines("1\n2\n3\n4", 2), ["… +2 lines", "3", "4"]);
	});
	it("latestCacheHitPercent uses last assistant turn, not session average", () => {
		assert.equal(latestCacheHitPercent([]), undefined);
		assert.equal(
			latestCacheHitPercent([
				{ type: "message", message: { role: "assistant", usage: { input: 1000, cacheRead: 0, cacheWrite: 0 } } },
			]),
			undefined,
		);
		assert.equal(
			latestCacheHitPercent([
				{ type: "message", message: { role: "assistant", usage: { input: 1000, cacheRead: 9000, cacheWrite: 0 } } },
				{ type: "message", message: { role: "assistant", usage: { input: 100, cacheRead: 900, cacheWrite: 0 } } },
			]),
			90,
		);
		assert.equal(
			latestCacheHitPercent([
				{ type: "message", message: { role: "assistant", usage: { input: 1000, cacheRead: 9000, cacheWrite: 0 } } },
				{ type: "compaction", usage: { input: 10, cacheRead: 0, cacheWrite: 0 } },
				{ type: "message", message: { role: "assistant", usage: { input: 500, cacheRead: 0, cacheWrite: 0 } } },
			]),
			0,
		);
		assert.equal(
			cacheHitSignature({
				id: "a1",
				type: "message",
				message: { role: "assistant", usage: { input: 100, cacheRead: 900, cacheWrite: 0 } },
			}),
			"a1:100:900:0",
		);
	});
});
