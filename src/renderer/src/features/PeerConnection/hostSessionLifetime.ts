export function hostSocketAction(
	hasPeer: boolean,
	connected: boolean,
): 'create' | 'enter' | 'wait' {
	if (!hasPeer) return 'create';
	return connected ? 'enter' : 'wait';
}

export function peerCloseEndsShare(mediaConnected: boolean): boolean {
	return mediaConnected;
}
