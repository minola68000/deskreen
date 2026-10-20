import { viewerSafeCaptureSize } from './viewerSafeCaptureSize';
import { cursorCaptureMode } from '../../../../common/shareMouseCursor';

async function getStreamWithSource(
	chromeMediaSource: 'desktop' | 'screen',
	sourceID: string,
	width: number | null | undefined,
	height: number | null | undefined,
	minSizeMultiplier: number,
	maxSizeMultiplier: number,
	minFrameRate: number,
	maxFrameRate: number,
	includeCursor: boolean,
): Promise<MediaStream> {
	const maxSize = viewerSafeCaptureSize(
		width ? width * maxSizeMultiplier : undefined,
		height ? height * maxSizeMultiplier : undefined,
	);
	const minSize =
		width && height
			? viewerSafeCaptureSize(width * minSizeMultiplier, height * minSizeMultiplier)
			: maxSize;
	const cursor = cursorCaptureMode(includeCursor);

	if (width && height) {
		return navigator.mediaDevices.getUserMedia({
			audio: false,
			video: {
				// @ts-ignore: mandatory/cursor are supported in chromium but missing in types
				cursor,
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
			// @ts-ignore: mandatory/cursor are supported in chromium but missing in types
			cursor,
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
	includeCursor = true,
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
			includeCursor,
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
			includeCursor,
		);
	}
};
