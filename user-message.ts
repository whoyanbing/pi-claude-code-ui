import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const PATCH = Symbol.for("claude-code-ui:user-message:v1");
const OSC_START = "\x1b]133;A\x07";
const OSC_END = "\x1b]133;B\x07";
const OSC_FINAL = "\x1b]133;C\x07";
const ANSI = /\x1b\[[0-9;]*m/g;

type UserMessagePrototype = Record<PropertyKey, unknown> & {
	render(width: number): string[];
};

type PatchState = {
	render: UserMessagePrototype["render"];
};

function peelOsc(line: string, index: number, last: number): { osc: string; body: string } {
	let osc = "";
	let body = line;
	// On a one-line message Pi prepends END/FINAL after prepending START, so the
	// actual order is END, FINAL, START. Consume every allowed leading marker in
	// its emitted order and preserve it verbatim before adding the visual prompt.
	while (true) {
		if (index === last && body.startsWith(OSC_END)) {
			osc += OSC_END;
			body = body.slice(OSC_END.length);
			continue;
		}
		if (index === last && body.startsWith(OSC_FINAL)) {
			osc += OSC_FINAL;
			body = body.slice(OSC_FINAL.length);
			continue;
		}
		if (index === 0 && body.startsWith(OSC_START)) {
			osc += OSC_START;
			body = body.slice(OSC_START.length);
			continue;
		}
		break;
	}
	return { osc, body };
}

function restoreExistingPatch(proto: UserMessagePrototype): void {
	const existing = proto[PATCH];
	// Compatibility with the previous implementation, which stored the original
	// render function directly under PATCH.
	if (typeof existing === "function") {
		proto.render = existing as UserMessagePrototype["render"];
		delete proto[PATCH];
		return;
	}
	if (existing && typeof existing === "object") {
		const state = existing as Partial<PatchState>;
		if (typeof state.render === "function") proto.render = state.render;
		delete proto[PATCH];
	}
}

export function patchUserMessages(): () => void {
	const proto = UserMessageComponent.prototype as unknown as UserMessagePrototype;
	restoreExistingPatch(proto);

	const state: PatchState = {
		render: proto.render,
	};
	proto[PATCH] = state;

	proto.render = function (this: unknown, width: number) {
		let lines: string[];
		try {
			lines = state.render.call(this, width);
		} catch {
			// Pi changed UserMessageComponent internals and the original
			// render itself throws: render nothing rather than crash the TUI.
			return [];
		}
		if (!lines.length || width <= 0) return lines;
		const last = lines.length - 1;
		return lines.map((line, index) => {
			try {
				const { osc, body } = peelOsc(line, index, last);
				const visible = body.replace(ANSI, "");
				if (!visible.trim() || visible.trimStart().startsWith(">")) return line;
				// Box pads content with a single leading cell (outputPad = 1)
				// and has no borders, so stripping one cell is width-neutral.
				// If the padding ever differs (user setting or Pi change),
				// leave the line alone: prefixing anyway would eat the last
				// cell via truncateToWidth.
				if (!body.startsWith(" ")) return line;
				const content = body.slice(1);
				return `${osc}${truncateToWidth(`> ${content}`, width, "")}`;
			} catch {
				return line;
			}
		});
	};

	return () => {
		if (proto[PATCH] !== state) return;
		proto.render = state.render;
		delete proto[PATCH];
	};
}
