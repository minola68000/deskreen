export const viewerVideoLayout = {
	position: 'absolute',
	top: 0,
	right: 0,
	bottom: 0,
	left: 0,
	width: '100%',
	height: '100%',
	objectFit: 'contain',
	backgroundColor: '#000',
} as const;

type InlineVideo = {
	muted: boolean;
	playsInline: boolean;
	srcObject: unknown;
	setAttribute: (name: string, value: string) => void;
	play: () => Promise<void>;
};

export function attachInlinePlayback(
	video: InlineVideo,
	stream: MediaStream,
): void {
	video.muted = true;
	video.playsInline = true;
	video.setAttribute('playsinline', 'true');
	video.setAttribute('webkit-playsinline', 'true');
	video.srcObject = stream;
	const play = () => {
		video.play().catch(() => undefined);
	};
	play();
	const track = stream.getVideoTracks()[0];
	if (track) track.onunmute = play;
}
