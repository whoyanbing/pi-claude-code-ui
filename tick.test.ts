import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTick } from "./tick.ts";

describe("setTick", () => {
	it("fires subscribers on one timer and unsubscribes", async () => {
		const key = Symbol("test-tick");
		let n = 0;
		setTick(key, () => {
			n++;
		});
		await new Promise((resolve) => setTimeout(resolve, 200));
		setTick(key, undefined);
		assert.ok(n >= 1);
		const after = n;
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.equal(n, after);
	});
});
