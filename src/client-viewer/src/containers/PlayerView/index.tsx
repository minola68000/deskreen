import { useEffect, useRef, useCallback } from 'react';
import { OverlayToaster, Position } from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import VideoJSPlayer from '../../components/VideoJSPlayer';
import PlayerControlPanel from '../../components/PlayerControlPanel';
import {
	COMPARISON_CANVAS_ID,
	PLAYER_WRAPPER_ID,
} from '../../constants/appConstants';
import { type VideoQualityType } from '../../features/VideoAutoQualityOptimizer/VideoQualityEnum';
import { togglePlayerFullscreen } from '../../utils/playerFullscreen';
import {
	attachInlinePlayback,
	viewerVideoLayout,
} from './viewerVideoLayout';
import {
	keysFromBeforeInput,
	keysFromKeyboard,
	repeatedText,
	viewerKeyMessage,
	type ViewerKeyPayload,
} from '../../../../common/viewerKeyInput';

interface PlayerViewProps {
	isWithControls: boolean;
	setIsWithControls: (_: boolean) => void;
	handlePlayPause: () => void;
	isPlaying: boolean;
	setPlaying: (playing: boolean) => void;
	setVideoQuality: (_: VideoQualityType) => void;
	videoQuality: VideoQualityType;
	screenSharingSourceType: ScreenSharingSourceType;
	streamUrl: MediaStream | null;
	onViewerKey: (message: string) => void;
}

type IOSVideoElement = HTMLVideoElement & {
	webkitEnterFullscreen?: () => void;
	webkitExitFullscreen?: () => void;
	webkitSupportsFullscreen?: boolean;
	webkitDisplayingFullscreen?: boolean;
};

function PlayerView(props: PlayerViewProps) {
	const { t } = useTranslation();
	const {
		screenSharingSourceType,
		setIsWithControls,
		isWithControls,
		handlePlayPause,
		isPlaying,
		setPlaying,
		setVideoQuality,
		videoQuality,
		streamUrl,
		onViewerKey,
	} = props;
	const keyInputRef = useRef<HTMLTextAreaElement>(null);

	// const player = useRef(null);

	const videoRef = useRef<HTMLVideoElement>(null);
	const toasterRef = useRef<Awaited<ReturnType<typeof OverlayToaster.create>> | null>(null);
	// no external player ref needed for video.js variant

	useEffect(() => {
		if (!streamUrl) return;

		// html5 video mode
		if (isWithControls && videoRef.current) {
			if (streamUrl instanceof MediaStream) {
				attachInlinePlayback(videoRef.current, streamUrl);
			} else {
				videoRef.current.src = streamUrl;
			}
			return;
		}

		// video.js mode (default) doesn't need imperative src assignment here
	}, [streamUrl, isWithControls]);

	useEffect(() => {
		if (isWithControls) {
			if (!videoRef.current) return;
			if (isPlaying) {
				videoRef.current.play().catch((error) => {
					console.error('Error playing video:', error);
				});
			} else {
				videoRef.current.pause();
			}
		}
		// react-player play/pause is handled via its `playing` prop
	}, [isPlaying, isWithControls]);

	// initialize toaster
	useEffect(() => {
		const initToaster = async () => {
			if (!toasterRef.current) {
				toasterRef.current = await OverlayToaster.create({
					position: Position.BOTTOM,
				});
			}
		};
		initToaster();
	}, []);

	// wrap handlePlayPause to show toaster notifications
	const handlePlayPauseWithNotification = useCallback(() => {
		const nextPlaying = !isPlaying;
		handlePlayPause();
		
		// show notification after a small delay to ensure state is updated
		setTimeout(() => {
			if (toasterRef.current) {
				toasterRef.current.show({
					message: nextPlaying ? t('Video stream is playing') : t('Video stream is paused'),
					intent: nextPlaying ? 'success' : 'warning',
					timeout: 2000,
				});
			}
		}, 50);
	}, [handlePlayPause, isPlaying, t]);

	// handle iPhone fullscreen exit - detect when video stops and auto-resume
	useEffect(() => {
		if (!streamUrl) return;

		const getVideoElement = (): IOSVideoElement | null => {
			if (isWithControls && videoRef.current) {
				return videoRef.current as IOSVideoElement;
			}
			const container = document.getElementById(PLAYER_WRAPPER_ID);
			if (!container) return null;
			const maybeVideo = container.querySelector('video');
			if (!(maybeVideo instanceof HTMLVideoElement)) return null;
			return maybeVideo as IOSVideoElement;
		};

		const handleFullscreenEnd = () => {
			// small delay to ensure video state is updated after fullscreen exit
			setTimeout(() => {
				const video = getVideoElement();
				if (!video) return;

				// check if video is paused after exiting fullscreen
				if (video.paused) {
					// sync play state - ensure button shows "Play" instead of "Pause"
					setPlaying(false);

					// show warning notification that video stopped and user needs to click play
					if (toasterRef.current) {
						toasterRef.current.show({
							message: t('Video stream paused after exiting fullscreen. Please click Play to continue.'),
							intent: 'warning',
							timeout: 5000,
						});
					}
				} else {
					// video is playing, but state might be wrong - sync it
					if (!isPlaying) {
						setPlaying(true);
					}
				}
			}, 150);
		};

		const attachListener = (video: IOSVideoElement | null) => {
			if (video) {
				video.addEventListener('webkitendfullscreen', handleFullscreenEnd);
			}
		};

		const detachListener = (video: IOSVideoElement | null) => {
			if (video) {
				video.removeEventListener('webkitendfullscreen', handleFullscreenEnd);
			}
		};

		let currentVideo: IOSVideoElement | null = getVideoElement();
		attachListener(currentVideo);

		// watch for video element changes (especially for VideoJSPlayer)
		const container = document.getElementById(PLAYER_WRAPPER_ID);
		let observer: MutationObserver | null = null;

		if (container) {
			observer = new MutationObserver(() => {
				const newVideo = getVideoElement();
				if (newVideo !== currentVideo) {
					detachListener(currentVideo);
					currentVideo = newVideo;
					attachListener(currentVideo);
				}
			});
			observer.observe(container, { childList: true, subtree: true });
		}

		return () => {
			detachListener(currentVideo);
			if (observer) {
				observer.disconnect();
			}
		};
	}, [streamUrl, isWithControls, isPlaying, setPlaying, t]);

	useEffect(() => {
		const input = keyInputRef.current;
		if (!input || !streamUrl) return;
		let lastText = '';
		let lastAt = 0;
		let lastSpaceAt = 0;
		let composing = false;
		const held = new Set<string>();
		const send = (payload: ViewerKeyPayload) => {
			if (payload.kind === 'text') {
				const now = Date.now();
				if (repeatedText(lastText, payload.text, now - lastAt)) return;
				lastText = payload.text;
				lastAt = now;
			}
			if (payload.kind === 'key' && payload.down && payload.code === 'Space') {
				lastSpaceAt = Date.now();
			}
			onViewerKey(viewerKeyMessage(payload));
		};
		const onKey = (type: 'keydown' | 'keyup') => (event: KeyboardEvent) => {
			const payload = keysFromKeyboard(
				type,
				event.key,
				event.code,
				{
					ctrl: event.ctrlKey,
					alt: event.altKey,
					meta: event.metaKey,
					shift: event.shiftKey,
				},
				event.keyCode,
			);
			if (!payload) return;
			if (payload.kind === 'key' && payload.down) held.add(payload.code);
			if (payload.kind === 'key' && !payload.down) held.delete(payload.code);
			event.preventDefault();
			event.stopPropagation();
			send(payload);
		};
		const releaseHeld = () => {
			held.forEach((code) => {
				send({
					kind: 'key',
					down: false,
					code,
					ctrl: false,
					alt: false,
					shift: false,
					meta: false,
				});
			});
			held.clear();
		};
		const onDown = onKey('keydown');
		const onUp = onKey('keyup');
		const onBeforeInput = (event: Event) => {
			if (composing) return;
			const inputEvent = event as InputEvent;
			if (inputEvent.data === ' ' && Date.now() - lastSpaceAt < 80) {
				inputEvent.preventDefault();
				return;
			}
			const payloads = keysFromBeforeInput(inputEvent.inputType, inputEvent.data);
			if (payloads.length === 0) return;
			inputEvent.preventDefault();
			payloads.forEach(send);
		};
		const onCompositionStart = () => {
			composing = true;
		};
		const onCompositionEnd = (event: CompositionEvent) => {
			composing = false;
			keysFromBeforeInput('insertText', event.data).forEach(send);
			input.value = '';
		};
		const onInput = () => {
			if (composing) return;
			const value = input.value;
			input.value = '';
			if ((value === ' ' || value === '\u00a0') && Date.now() - lastSpaceAt >= 80) {
				send({ kind: 'key', down: true, code: 'Space', ctrl: false, alt: false, shift: false, meta: false });
				send({ kind: 'key', down: false, code: 'Space', ctrl: false, alt: false, shift: false, meta: false });
			}
		};
		window.addEventListener('keydown', onDown, true);
		window.addEventListener('keyup', onUp, true);
		input.addEventListener('beforeinput', onBeforeInput);
		input.addEventListener('compositionstart', onCompositionStart);
		input.addEventListener('compositionend', onCompositionEnd);
		input.addEventListener('input', onInput);
		input.addEventListener('blur', releaseHeld);
		return () => {
			window.removeEventListener('keydown', onDown, true);
			window.removeEventListener('keyup', onUp, true);
			input.removeEventListener('beforeinput', onBeforeInput);
			input.removeEventListener('compositionstart', onCompositionStart);
			input.removeEventListener('compositionend', onCompositionEnd);
			input.removeEventListener('input', onInput);
			input.removeEventListener('blur', releaseHeld);
			releaseHeld();
		};
	}, [streamUrl, onViewerKey]);

	// @ts-ignore
	return (
		<div
			style={{
				position: 'absolute',
				zIndex: 1,
				top: 0,
				left: 0,
				width: '100%',
				height: '100vh',
				display: 'flex',
				flexDirection: 'column',
				overflow: 'hidden',
			}}
		>
			<div style={{ position: 'relative', zIndex: 2 }}>
			<PlayerControlPanel
				onSwitchChangedCallback={(isEnabled) => setIsWithControls(isEnabled)}
				isDefaultPlayerTurnedOn={isWithControls}
				handleClickFullscreen={() => {
					const result = togglePlayerFullscreen();
					if (result === 'failed') {
						console.warn('Unable to toggle fullscreen');
					}
					return result;
				}}
				handleClickPlayPause={handlePlayPauseWithNotification}
				isPlaying={isPlaying}
				setVideoQuality={setVideoQuality}
				selectedVideoQuality={videoQuality}
				screenSharingSourceType={screenSharingSourceType}
			/>
			</div>
			<div
				id="video-container"
				style={{
					position: 'absolute',
					top: 0,
					right: 0,
					bottom: 0,
					left: 0,
					backgroundColor: '#000',
				}}
			>
				<div
					id={PLAYER_WRAPPER_ID}
					className="player-wrapper"
					style={{
						position: 'absolute',
						top: 0,
						right: 0,
						bottom: 0,
						left: 0,
						backgroundColor: '#000',
					}}
				>
					{isWithControls ? (
						<video
							ref={videoRef}
							autoPlay
							playsInline
							muted
							style={viewerVideoLayout}
						/>
					) : (
						<VideoJSPlayer
							stream={streamUrl}
							playing={isPlaying}
							containerEl={document.getElementById(PLAYER_WRAPPER_ID)}
						/>
					)}
				</div>
				<canvas id={COMPARISON_CANVAS_ID} style={{ display: 'none' }}></canvas>
				{streamUrl ? <textarea
					ref={keyInputRef}
					aria-label="keyboard"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
					style={{
						position: 'absolute',
						top: 0,
						right: 0,
						bottom: 0,
						left: 0,
						zIndex: 1,
						margin: 0,
						padding: 0,
						border: 0,
						resize: 'none',
						fontSize: 16,
						color: 'transparent',
						background: 'transparent',
						caretColor: 'transparent',
					}}
				/> : null}
			</div>
		</div>
	);
}

export default PlayerView;
