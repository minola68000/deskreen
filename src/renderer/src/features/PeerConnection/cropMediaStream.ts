import { cropPixels, type CaptureCrop } from '../../../../common/captureCrop';
import { viewerSafeCaptureSize } from './viewerSafeCaptureSize';

export async function cropMediaStream(
	source: MediaStream,
	crop: CaptureCrop,
): Promise<MediaStream> {
	const video = document.createElement('video');
	video.muted = true;
	video.playsInline = true;
	video.srcObject = source;
	try {
		await video.play();
		if (!video.videoWidth) {
			await new Promise<void>((resolve) => {
				const timer = window.setTimeout(resolve, 1000);
				video.onloadeddata = () => {
					window.clearTimeout(timer);
					resolve();
				};
			});
		}
	} catch (error) {
		console.error(error);
		return source;
	}
	const pixels = cropPixels(crop, video.videoWidth, video.videoHeight);
	if (!pixels) {
		video.pause();
		video.srcObject = null;
		return source;
	}
	const size = viewerSafeCaptureSize(pixels.sw, pixels.sh);
	const canvas = document.createElement('canvas');
	canvas.width = size.width;
	canvas.height = size.height;
	const context = canvas.getContext('2d');
	if (!context) {
		video.pause();
		video.srcObject = null;
		return source;
	}

	let closed = false;
	const draw = () => {
		if (closed || !video.videoWidth) return;
		const next = cropPixels(crop, video.videoWidth, video.videoHeight);
		if (!next) return;
		context.drawImage(
			video,
			next.sx,
			next.sy,
			next.sw,
			next.sh,
			0,
			0,
			canvas.width,
			canvas.height,
		);
	};
	draw();
	const timer = window.setInterval(draw, 33);
	const output = canvas.captureStream(30);
	const track = output.getVideoTracks()[0];
	const close = () => {
		if (closed) return;
		closed = true;
		window.clearInterval(timer);
		video.pause();
		video.srcObject = null;
		source.getTracks().forEach((item) => item.stop());
	};
	track.addEventListener('ended', close);
	const stopTrack = track.stop.bind(track);
	track.stop = () => {
		close();
		stopTrack();
	};
	return output;
}
