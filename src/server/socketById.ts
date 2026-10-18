export function socketById<T>(
	sockets: { get?: (id: string) => T | undefined } | Record<string, T> | undefined,
	id: string,
): T | undefined {
	if (!sockets) return undefined;
	if (typeof (sockets as { get?: unknown }).get === 'function') {
		return (sockets as { get: (socketId: string) => T | undefined }).get(id);
	}
	return (sockets as Record<string, T>)[id];
}
