type Encoding = { scaleResolutionDownBy?: number };

export type KeyframeSender = {
	generateKeyFrame?: () => Promise<void>;
	getParameters: () => { encodings?: Encoding[] };
	setParameters: (params: { encodings?: Encoding[] }) => Promise<void>;
	track?: { getSettings?: () => { width?: number; height?: number } };
};

export function alignedKeyframeScale(width: number, height: number): number {
	if (width < 32 || height < 32 || width % 16 !== 0 || height % 16 !== 0) {
		return 1;
	}
	for (let nextWidth = width - 16; nextWidth >= 16; nextWidth -= 16) {
		if ((height * nextWidth) % width !== 0) continue;
		const nextHeight = (height * nextWidth) / width;
		if (nextHeight % 16 !== 0 || nextHeight < 16) continue;
		return width / nextWidth;
	}
	return 1;
}

export async function requestVideoKeyframe(sender: KeyframeSender): Promise<boolean> {
	if (typeof sender.generateKeyFrame === 'function') {
		await sender.generateKeyFrame();
		return true;
	}
	const settings = sender.track?.getSettings?.() ?? {};
	const dip = alignedKeyframeScale(settings.width ?? 0, settings.height ?? 0);
	if (dip === 1) return false;
	const params = sender.getParameters();
	const encoding = params.encodings?.[0];
	if (!encoding) return false;
	encoding.scaleResolutionDownBy = dip;
	await sender.setParameters(params);
	const restored = sender.getParameters();
	const restoredEncoding = restored.encodings?.[0];
	if (!restoredEncoding) return true;
	restoredEncoding.scaleResolutionDownBy = 1;
	await sender.setParameters(restored);
	return true;
}
