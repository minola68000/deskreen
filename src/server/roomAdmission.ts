export function roomIdFromQuery(roomId: unknown): string {
	const value = Array.isArray(roomId) ? roomId[0] : roomId;
	if (typeof value !== 'string') return '';
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
