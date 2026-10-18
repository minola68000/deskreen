// import SimplePeer from 'simple-peer';
import createDesktopCapturerStream from './createDesktopCapturerStream';
import handlePeerOnData from './handlePeerOnData';
import { peerCloseEndsShare } from './hostSessionLifetime';
import { signalUsesLanAddress } from './lanIceCandidate';
import NullSimplePeer from './NullSimplePeer';
import { requestVideoKeyframe } from './requestVideoKeyframe';
import simplePeerHandleSdpTransform from './simplePeerHandleSdpTransform';

let keyframeTimer: ReturnType<typeof setInterval> | undefined;

function videoSender(connection: RTCPeerConnection) {
	return connection
		.getSenders()
		.find((sender) => sender.track?.kind === 'video');
}

export default function handleCreatePeer(
	peerConnection: PeerConnection,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (keyframeTimer) clearInterval(keyframeTimer);

		// cleanup existing peer before creating new one
		if (peerConnection.peer !== NullSimplePeer) {
			try {
				peerConnection.peer.removeAllListeners();
				peerConnection.peer.destroy();
			} catch (error) {
				console.error('Error cleaning up existing peer:', error);
			}
			peerConnection.peer = NullSimplePeer;
		}

		// cleanup existing stream before creating new one
		if (peerConnection.localStream) {
			peerConnection.localStream.getTracks().forEach((track) => {
				track.stop();
			});
			peerConnection.localStream = null;
		}

		// clear old signals and reset call state when recreating peer
		peerConnection.signalsDataToCallUser = [];
		peerConnection.isCallStarted = false;

		createDesktopCapturerStream(
			peerConnection,
			peerConnection.desktopCapturerSourceID,
		)
			.then(async () => {
				const lanIp = await window.electron.ipcRenderer
					.invoke('get-local-lan-ip')
					.catch(() => '');
				// if (peerConnection.peer === NullSimplePeer) {
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore
				peerConnection.peer = new SimplePeer({
					initiator: true,
					// trickle: false,
					// wrtc: window.api.wrtc,
					config: { iceServers: [] },
					sdpTransform: (sdp: string) =>
						simplePeerHandleSdpTransform(sdp, lanIp),
				});
				// }

				// TODO: basically here we need a client side simple peer, but we get a nodejs side simple peer
				if (peerConnection.localStream !== null) {
					peerConnection.peer.addStream(peerConnection.localStream);
				}

				peerConnection.peer.on('signal', (data: string) => {
					// fired when simple peer and webrtc done preparation to start call on peerConnection machine
					if (!signalUsesLanAddress(data, lanIp)) return;
					peerConnection.signalsDataToCallUser.push(data);
				});

				peerConnection.peer.on('data', (data) => {
					handlePeerOnData(peerConnection, data);
				});

				let mediaConnected = false;
				let keyframeBusy = false;
				const pulseKeyframe = () => {
					if (keyframeBusy) return;
					const connection = (
						peerConnection.peer as { _pc?: RTCPeerConnection }
					)._pc;
					const sender = connection && videoSender(connection);
					if (!sender) return;
					keyframeBusy = true;
					requestVideoKeyframe(sender)
						.catch((error) => {
							console.error('keyframe request failed', error);
						})
						.finally(() => {
							keyframeBusy = false;
						});
				};
				peerConnection.peer.on('connect', () => {
					mediaConnected = true;
					if (keyframeTimer) clearInterval(keyframeTimer);
					pulseKeyframe();
					keyframeTimer = setInterval(pulseKeyframe, 2000);
				});

				peerConnection.peer.on('close', () => {
					if (keyframeTimer) clearInterval(keyframeTimer);
					if (peerCloseEndsShare(mediaConnected)) peerConnection.selfDestroy();
				});

				peerConnection.peer.on('error', (e: Error) => {
					console.error('peerConnection peer error', e);
				});
				resolve(undefined);
			})
			.catch((e) => {
				console.error(e);
				reject();
			});
	});
}
