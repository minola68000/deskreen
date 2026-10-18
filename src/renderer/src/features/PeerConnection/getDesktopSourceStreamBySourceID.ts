import { viewerSafeCaptureSize } from './viewerSafeCaptureSize';

async function getStreamWithSource(
	chromeMediaSource: 'desktop' | 'screen',
	sourceID: string,
	width: number | null | undefined,
	height: number | null | undefined,
	minSizeMultiplier: number,
	maxSizeMultiplier: number,
	minFrameRate: number,
	maxFrameRate: number,
): Promise<MediaStream> {
	const maxSize = viewerSafeCaptureSize(
		width ? width * maxSizeMultiplier : undefined,
		height ? height * maxSizeMultiplier : undefined,
	);
	const minSize =
		width && height
			? viewerSafeCaptureSize(width * minSizeMultiplier, height * minSizeMultiplier)
			: maxSize;

	if (width && height) {
		return navigator.mediaDevices.getUserMedia({
			audio: false,
			video: {
				// @ts-ignore: mandatory is supported in chromium but missing in types
				mandatory: {
					chromeMediaSource,
					chromeMediaSourceId: sourceID,
					minWidth: Math.min(minSize.width, maxSize.width),
					maxWidth: maxSize.width,
					minHeight: Math.min(minSize.height, maxSize.height),
					maxHeight: maxSize.height,
					minFrameRate,
					maxFrameRate,
				},
			},
		});
	}

	return navigator.mediaDevices.getUserMedia({
		audio: false,
		video: {
			// @ts-ignore: mandatory is supported in chromium but missing in types
			mandatory: {
				chromeMediaSource,
				chromeMediaSourceId: sourceID,
				maxWidth: maxSize.width,
				maxHeight: maxSize.height,
				minFrameRate,
				maxFrameRate,
			},
		},
	});
}

export default async (
	sourceID: string,
	width: number | null | undefined = undefined,
	height: number | null | undefined = undefined,
	minSizeMultiplier = 1,
	maxSizeMultiplier = 1,
	minFrameRate = 15,
	maxFrameRate = 30,
): Promise<MediaStream> => {
	try {
		return await getStreamWithSource(
			'desktop',
			sourceID,
			width,
			height,
			minSizeMultiplier,
			maxSizeMultiplier,
			minFrameRate,
			maxFrameRate,
		);
	} catch (desktopError) {
		console.warn(
			'failed to capture desktop stream, retrying with screen source',
			desktopError,
		);
		return getStreamWithSource(
			'screen',
			sourceID,
			width,
			height,
			minSizeMultiplier,
			maxSizeMultiplier,
			minFrameRate,
			maxFrameRate,
		);
	}
};
