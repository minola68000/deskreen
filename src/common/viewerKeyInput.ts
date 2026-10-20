export type ViewerKeyPayload =
	| { kind: 'text'; text: string }
	| {
			kind: 'key';
			down: boolean;
			code: string;
			ctrl: boolean;
			alt: boolean;
			shift: boolean;
			meta: boolean;
	  };

const NAMED_KEYS = new Set([
	'ArrowLeft',
	'ArrowRight',
	'ArrowUp',
	'ArrowDown',
	'Escape',
	'Tab',
	'Home',
	'End',
	'PageUp',
	'PageDown',
	'Delete',
	'Space',
	'ControlLeft',
	'ControlRight',
	'ShiftLeft',
	'ShiftRight',
	'AltLeft',
	'AltRight',
	'MetaLeft',
	'MetaRight',
]);

const KEY_ALIASES: Record<string, string> = {
	' ': 'Space',
	'\u00a0': 'Space',
	UIKeyInputLeftArrow: 'ArrowLeft',
	UIKeyInputRightArrow: 'ArrowRight',
	UIKeyInputUpArrow: 'ArrowUp',
	UIKeyInputDownArrow: 'ArrowDown',
};

const KEY_CODE_NUMBERS: Record<number, string> = {
	9: 'Tab',
	27: 'Escape',
	32: 'Space',
	33: 'PageUp',
	34: 'PageDown',
	35: 'End',
	36: 'Home',
	37: 'ArrowLeft',
	38: 'ArrowUp',
	39: 'ArrowRight',
	40: 'ArrowDown',
	46: 'Delete',
};

export function canonicalKeyCode(key: string, code: string, keyCode = 0): string | null {
	if (NAMED_KEYS.has(code)) return code;
	if (KEY_ALIASES[key]) return KEY_ALIASES[key];
	if (NAMED_KEYS.has(key)) return key;
	if (KEY_CODE_NUMBERS[keyCode]) return KEY_CODE_NUMBERS[keyCode];
	if (keyCode >= 65 && keyCode <= 90) return `Key${String.fromCharCode(keyCode)}`;
	if (keyCode >= 48 && keyCode <= 57) return `Digit${String.fromCharCode(keyCode)}`;
	if (/^Key[A-Z]$|^Digit[0-9]$/.test(code)) return code;
	return null;
}

function printableText(key: string, keyCode: number, shift: boolean): string | null {
	if (key === ' ' || key === '\u00a0') return null;
	if (key.length === 1 && !/[\u0000-\u001f\u007f]/.test(key)) return key;
	if (keyCode >= 65 && keyCode <= 90) {
		const letter = String.fromCharCode(keyCode);
		return shift ? letter : letter.toLowerCase();
	}
	if ((keyCode >= 48 && keyCode <= 57) || (keyCode >= 96 && keyCode <= 105)) {
		const digit = keyCode <= 57 ? keyCode : 48 + (keyCode - 96);
		return String.fromCharCode(digit);
	}
	return null;
}

export function keysFromKeyboard(
	type: 'keydown' | 'keyup',
	key: string,
	code: string,
	mods: { ctrl: boolean; alt: boolean; meta: boolean; shift: boolean },
	keyCode = 0,
): ViewerKeyPayload | null {
	const shortcut = mods.ctrl || mods.alt || mods.meta;
	if (!shortcut && type === 'keydown') {
		const text = printableText(key, keyCode, mods.shift);
		if (text) return { kind: 'text', text };
	}
	const canonical = canonicalKeyCode(key, code, keyCode);
	if (!canonical) return null;
	const characterKey = canonical === 'Enter' || canonical === 'Backspace' || /^Key[A-Z]$|^Digit[0-9]$/.test(canonical);
	if (!shortcut && characterKey) return null;
	return {
		kind: 'key',
		down: type === 'keydown',
		code: canonical,
		ctrl: mods.ctrl,
		alt: mods.alt,
		shift: mods.shift,
		meta: mods.meta,
	};
}

export function textFromUserInput(value: string, data: string | null): string | null {
	const source = data && data.length > 0 ? data : value;
	const text = source.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 32);
	if (!text || text === ' ' || text === '\u00a0') return null;
	return text;
}

export function keysFromBeforeInput(
	inputType: string,
	data: string | null,
): ViewerKeyPayload[] {
	if (inputType === 'insertText' && (data === ' ' || data === '\u00a0')) {
		return [keyTap('Space'), keyTap('Space', false)];
	}
	if (inputType === 'insertText' && data) {
		const text = data.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 32);
		return text ? [{ kind: 'text', text }] : [];
	}
	if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
		return [keyTap('Enter'), keyTap('Enter', false)];
	}
	if (inputType === 'deleteContentBackward') {
		return [keyTap('Backspace'), keyTap('Backspace', false)];
	}
	return [];
}

function keyTap(code: string, down = true): ViewerKeyPayload {
	return { kind: 'key', down, code, ctrl: false, alt: false, shift: false, meta: false };
}

export function repeatedText(previous: string, text: string, elapsedMs: number): boolean {
	return previous === text && elapsedMs >= 0 && elapsedMs < 80;
}

export function viewerKeyMessage(payload: ViewerKeyPayload): string {
	return JSON.stringify({ type: 'viewer_key', payload });
}

export function parseViewerKey(value: unknown): ViewerKeyPayload | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	if (record.kind === 'text') {
		if (typeof record.text !== 'string') return null;
		if (record.text.length === 0 || record.text.length > 32) return null;
		if (/[\u0000-\u001f\u007f]/.test(record.text)) return null;
		return { kind: 'text', text: record.text };
	}
	if (record.kind !== 'key') return null;
	if (typeof record.code !== 'string' || record.code.length === 0 || record.code.length > 32) {
		return null;
	}
	if (typeof record.down !== 'boolean') return null;
	return {
		kind: 'key',
		down: record.down,
		code: record.code,
		ctrl: record.ctrl === true,
		alt: record.alt === true,
		shift: record.shift === true,
		meta: record.meta === true,
	};
}
