import type { ViewerKeyPayload } from '../../common/viewerKeyInput';

export const WM_KEYDOWN = 0x0100;
export const WM_KEYUP = 0x0101;
export const WM_CHAR = 0x0102;

export type KeyMessage = { msg: number; wParam: number; lParam: number };

type KeySpec = { vk: number; scan: number; ext?: boolean };

const SPECIAL: Record<string, KeySpec> = {
	Backspace: { vk: 0x08, scan: 0x0e },
	Tab: { vk: 0x09, scan: 0x0f },
	Enter: { vk: 0x0d, scan: 0x1c },
	Escape: { vk: 0x1b, scan: 0x01 },
	Delete: { vk: 0x2e, scan: 0x53, ext: true },
	Space: { vk: 0x20, scan: 0x39 },
	ArrowLeft: { vk: 0x25, scan: 0x4b, ext: true },
	ArrowUp: { vk: 0x26, scan: 0x48, ext: true },
	ArrowRight: { vk: 0x27, scan: 0x4d, ext: true },
	ArrowDown: { vk: 0x28, scan: 0x50, ext: true },
	Home: { vk: 0x24, scan: 0x47, ext: true },
	End: { vk: 0x23, scan: 0x4f, ext: true },
	PageUp: { vk: 0x21, scan: 0x49, ext: true },
	PageDown: { vk: 0x22, scan: 0x51, ext: true },
	ControlLeft: { vk: 0x11, scan: 0x1d },
	ControlRight: { vk: 0x11, scan: 0x1d, ext: true },
	ShiftLeft: { vk: 0x10, scan: 0x2a },
	ShiftRight: { vk: 0x10, scan: 0x36 },
	AltLeft: { vk: 0x12, scan: 0x38 },
	AltRight: { vk: 0x12, scan: 0x38, ext: true },
	MetaLeft: { vk: 0x5b, scan: 0x5b, ext: true },
	MetaRight: { vk: 0x5c, scan: 0x5c, ext: true },
};

export function keyLParam(scan: number, extended: boolean, up: boolean): number {
	let lp = 1;
	lp |= (scan & 0xff) << 16;
	if (extended) lp |= 1 << 24;
	if (up) {
		lp |= 1 << 30;
		lp |= 0x80000000;
	}
	return lp >>> 0;
}

function specFor(code: string): KeySpec | null {
	const letter = /^Key([A-Z])$/.exec(code);
	if (letter) return { vk: letter[1].charCodeAt(0), scan: 0 };
	const digit = /^Digit([0-9])$/.exec(code);
	if (digit) return { vk: 0x30 + Number(digit[1]), scan: 0 };
	return SPECIAL[code] ?? null;
}

function keyMessage(spec: KeySpec, down: boolean): KeyMessage {
	return {
		msg: down ? WM_KEYDOWN : WM_KEYUP,
		wParam: spec.vk,
		lParam: keyLParam(spec.scan, spec.ext === true, !down),
	};
}

export function keyMessages(payload: ViewerKeyPayload): KeyMessage[] {
	if (payload.kind === 'text') {
		const messages: KeyMessage[] = [];
		for (const char of payload.text) {
			const point = char.codePointAt(0) ?? 0;
			if (point === 0) continue;
			if (point > 0xffff) {
				const shifted = point - 0x10000;
				messages.push({ msg: WM_CHAR, wParam: 0xd800 + (shifted >> 10), lParam: 1 });
				messages.push({ msg: WM_CHAR, wParam: 0xdc00 + (shifted & 0x3ff), lParam: 1 });
			} else {
				messages.push({ msg: WM_CHAR, wParam: point, lParam: 1 });
			}
		}
		return messages;
	}

	const spec = specFor(payload.code);
	if (!spec) return [];
	const messages: KeyMessage[] = [];
	if (payload.down) {
		const mods: KeySpec[] = [];
		if (payload.ctrl) mods.push(SPECIAL.ControlLeft);
		if (payload.alt) mods.push(SPECIAL.AltLeft);
		if (payload.shift) mods.push(SPECIAL.ShiftLeft);
		if (payload.meta) mods.push(SPECIAL.MetaLeft);
		for (const mod of mods) {
			if (mod.vk !== spec.vk) messages.push(keyMessage(mod, true));
		}
		messages.push(keyMessage(spec, true));
		if (payload.code === 'Enter') {
			messages.push({ msg: WM_CHAR, wParam: 13, lParam: 1 });
		}
		return messages;
	}
	return [keyMessage(spec, false)];
}
