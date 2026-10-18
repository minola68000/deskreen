const MAX_DELAY_MS = 10000;

export function clampDelayMs(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(MAX_DELAY_MS, Math.max(0, Math.round(value)));
}

export function windowHandleToken(sourceId: string): string | null {
	const parts = sourceId.split(':');
	if (parts[0] !== 'window' || !parts[1] || parts[1] === '0') {
		return null;
	}
	if (!/^-?\d+$/.test(parts[1])) {
		return null;
	}
	return parts[1];
}

/**
 * Byte-frame delay line. The first delayFrames reads are silence, then input
 * in order. Matches delayline.c.
 */
export class FrameDelay {
	private readonly frameBytes: number;
	private readonly data: Buffer;
	private readonly capacity: number;
	private read = 0;
	private count: number;

	constructor(delayFrames: number, frameBytes: number, slackFrames: number) {
		this.frameBytes = frameBytes;
		this.capacity = Math.max(1, delayFrames + slackFrames);
		this.data = Buffer.alloc(this.capacity * frameBytes);
		this.count = Math.min(delayFrames, this.capacity);
	}

	available(): number {
		return this.count;
	}

	write(src: Buffer, frames: number): void {
		const overflow = this.count + frames - this.capacity;
		if (overflow > 0) {
			this.read = (this.read + overflow) % this.capacity;
			this.count -= overflow;
		}
		let writeAt = (this.read + this.count) % this.capacity;
		for (let i = 0; i < frames; i += 1) {
			src.copy(
				this.data,
				writeAt * this.frameBytes,
				i * this.frameBytes,
				(i + 1) * this.frameBytes,
			);
			writeAt += 1;
			if (writeAt === this.capacity) {
				writeAt = 0;
			}
		}
		this.count += frames;
	}

	readFrames(frames: number): Buffer {
		const n = Math.min(frames, this.count);
		const dst = Buffer.alloc(frames * this.frameBytes);
		for (let i = 0; i < n; i += 1) {
			this.data.copy(
				dst,
				i * this.frameBytes,
				this.read * this.frameBytes,
				(this.read + 1) * this.frameBytes,
			);
			this.read += 1;
			if (this.read === this.capacity) {
				this.read = 0;
			}
		}
		this.count -= n;
		return dst.subarray(0, n * this.frameBytes);
	}
}
