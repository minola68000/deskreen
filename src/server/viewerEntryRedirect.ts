export function viewerEntryRedirect(
	requestPath: string,
	waitingRoomId: string | undefined,
	isRoomTaken: (roomId: string) => boolean = () => false,
): string | null {
	const pathOnly = (requestPath.split('?')[0] || '/').replace(/\/+$/, '') || '/';
	if (!waitingRoomId) return null;
	const target = `/${encodeURIComponent(waitingRoomId)}`;
	if (pathOnly === '/') return target;

	const segment = pathOnly.startsWith('/') ? pathOnly.slice(1) : pathOnly;
	if (!/^[0-9A-Za-z_-]{4,64}$/.test(segment)) return null;
	if (segment === waitingRoomId) return null;
	if (isRoomTaken(segment)) return null;
	return target;
}
