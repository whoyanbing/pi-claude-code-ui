import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILTINS, keepOwnRenderer, resultIsVisiblyEmpty, shouldFallbackEmptyResult } from "./keep-renderer.ts";

const stock = () => {};
const custom = () => {};

describe("keepOwnRenderer", () => {
	it("restyles stock builtin renderers", () => {
		assert.equal(keepOwnRenderer("read", stock, stock), false);
		assert.equal(keepOwnRenderer("grep", stock, stock), false);
	});

	it("keeps a replacement of a builtin (hashline read)", () => {
		assert.equal(keepOwnRenderer("read", custom, stock), true);
	});

	it("restyles bash when stock identity is unavailable", () => {
		assert.equal(keepOwnRenderer("bash", custom, undefined), false);
		assert.equal(keepOwnRenderer("powershell", custom, undefined), false);
	});

	it("keeps third-party renderers", () => {
		assert.equal(keepOwnRenderer("replace", custom, undefined), true);
		assert.equal(keepOwnRenderer("anchor_grep", custom, undefined), true);
	});

	it("falls through when there is no renderer", () => {
		assert.equal(keepOwnRenderer("read", undefined, stock), false);
		assert.equal(keepOwnRenderer("replace", undefined, undefined), false);
	});

	it("covers the builtin set", () => {
		for (const name of ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]) {
			assert.ok(BUILTINS.has(name));
		}
	});

describe("resultIsVisiblyEmpty", () => {
	it("empty and missing render as empty", () => {
		assert.equal(resultIsVisiblyEmpty(null), true);
		assert.equal(resultIsVisiblyEmpty({}), true);
		assert.equal(resultIsVisiblyEmpty({ render: () => [] }), true);
		assert.equal(resultIsVisiblyEmpty({ render: () => ["   "] }), true);
	});

	it("keeps visible and ANSI-wrapped lines", () => {
		assert.equal(resultIsVisiblyEmpty({ render: () => ["hi"] }), false);
		assert.equal(resultIsVisiblyEmpty({ render: () => ["\x1b[2mhi\x1b[22m"] }), false);
	});
});

describe("shouldFallbackEmptyResult", () => {
	it("only mixed CC-call + kept-result path falls back", () => {
		assert.equal(shouldFallbackEmptyResult(false, true, true), true);
		assert.equal(shouldFallbackEmptyResult(false, true, false), false);
		assert.equal(shouldFallbackEmptyResult(true, true, true), false);
		assert.equal(shouldFallbackEmptyResult(false, false, true), false);
	});
});

});
