export type CaptureCrop = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type CropPixels = {
	sx: number;
	sy: number;
	sw: number;
	sh: number;
};

const MIN_SPAN = 0.02;

function clamp01(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}

function even(value: number): number {
	const rounded = Math.round(value);
	return rounded - (rounded % 2);
}

export function clampCrop(value: unknown): CaptureCrop | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const x = clamp01(record.x);
	const y = clamp01(record.y);
	const width = clamp01(record.width);
	const height = clamp01(record.height);
	if (x === null || y === null || width === null || height === null) return null;
	if (width < MIN_SPAN || height < MIN_SPAN) return null;
	const right = Math.min(1, x + width);
	const bottom = Math.min(1, y + height);
	const cropped = {
		x: round4(x),
		y: round4(y),
		width: round4(right - x),
		height: round4(bottom - y),
	};
	if (cropped.width < MIN_SPAN || cropped.height < MIN_SPAN) return null;
	if (cropped.x <= 0.01 && cropped.y <= 0.01 && cropped.width >= 0.98 && cropped.height >= 0.98) {
		return null;
	}
	return cropped;
}

export function cropFromDrag(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): CaptureCrop | null {
	return clampCrop({
		x: Math.min(startX, endX),
		y: Math.min(startY, endY),
		width: Math.abs(endX - startX),
		height: Math.abs(endY - startY),
	});
}

export function pointInBox(
	clientX: number,
	clientY: number,
	box: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
	if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
	return {
		x: Math.min(1, Math.max(0, (clientX - box.left) / box.width)),
		y: Math.min(1, Math.max(0, (clientY - box.top) / box.height)),
	};
}

export function cropPixels(
	crop: CaptureCrop,
	frameWidth: number,
	frameHeight: number,
): CropPixels | null {
	if (frameWidth < 2 || frameHeight < 2) return null;
	const sw = Math.max(2, Math.min(even(crop.width * frameWidth), even(frameWidth)));
	const sh = Math.max(2, Math.min(even(crop.height * frameHeight), even(frameHeight)));
	let sx = Math.round(crop.x * frameWidth);
	let sy = Math.round(crop.y * frameHeight);
	if (sx + sw > frameWidth) sx = frameWidth - sw;
	if (sy + sh > frameHeight) sy = frameHeight - sh;
	if (sx < 0) sx = 0;
	if (sy < 0) sy = 0;
	return { sx, sy, sw, sh };
}
