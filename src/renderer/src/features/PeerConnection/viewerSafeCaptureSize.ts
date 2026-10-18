const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;

function align16(value: number): number {
	return Math.max(16, Math.floor(value / 16) * 16);
}

export function viewerSafeCaptureSize(
	width?: number | null,
	height?: number | null,
): { width: number; height: number } {
	const sourceWidth = width && width > 0 ? width : MAX_WIDTH;
	const sourceHeight = height && height > 0 ? height : MAX_HEIGHT;
	const scale = Math.min(MAX_WIDTH / sourceWidth, MAX_HEIGHT / sourceHeight, 1);
	return {
		width: align16(sourceWidth * scale),
		height: align16(sourceHeight * scale),
	};
}
