const INTERVAL_MS = 90;
const TICK_KEY = Symbol.for("claude-code-ui:tick:v3");
type TickState = {
	timer?: ReturnType<typeof setInterval>;
	listeners: Map<symbol, () => void>;
};

function tickState(): TickState {
	const root = globalThis as typeof globalThis & { [TICK_KEY]?: TickState };
	if (!root[TICK_KEY]) root[TICK_KEY] = { listeners: new Map() };
	return root[TICK_KEY];
}

function stop(state: TickState): void {
	if (!state.timer) return;
	clearInterval(state.timer);
	state.timer = undefined;
}

function pump(): void {
	const state = tickState();
	if (state.listeners.size === 0) {
		stop(state);
		return;
	}
	for (const cb of state.listeners.values()) {
		try {
			cb();
		} catch {
			// One listener throwing must not freeze working + tool spinners.
		}
	}
}

/** Replace the callback for `key`. Pass `undefined` to unsubscribe. Hot reload overwrites the same key. */
export function setTick(key: symbol, cb: (() => void) | undefined): void {
	const state = tickState();
	if (cb) state.listeners.set(key, cb);
	else state.listeners.delete(key);
	if (state.listeners.size === 0) {
		stop(state);
		return;
	}
	if (state.timer) return;
	state.timer = setInterval(pump, INTERVAL_MS);
	state.timer.unref?.();
}
