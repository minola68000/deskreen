export type CursorCaptureMode = 'always' | 'never';

export function normalizeShareMouseCursor(value: unknown): boolean {
	if (value === false || value === 'false' || value === 0 || value === '0') {
		return false;
	}
	return true;
}

export function cursorCaptureMode(includeCursor: boolean): CursorCaptureMode {
	return includeCursor ? 'always' : 'never';
}
