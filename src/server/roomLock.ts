export function nonOwnerCount(
	users: { isOwner?: boolean }[] | undefined,
): number {
	return (users || []).filter((user) => !user.isOwner).length;
}

export function isRoomBlockingNewViewer(room: {
	isLocked?: boolean;
	users?: { isOwner?: boolean }[];
} | null | undefined): boolean {
	if (!room?.isLocked) return false;
	return nonOwnerCount(room.users) > 0;
}

export function usersAfterLeave<T extends { socketId: string }>(
	users: T[] | undefined,
	leftSocketId: string,
): T[] {
	return (users || []).filter((user) => user.socketId !== leftSocketId);
}

export function staleViewerSocketIds(
	users: { socketId: string; isOwner?: boolean }[] | undefined,
): string[] {
	const list = users || [];
	if (list.some((user) => user.isOwner)) return [];
	return list.filter((user) => !user.isOwner).map((user) => user.socketId);
}

export function lockAfterUserLeft(
	usersAfterLeave: { isOwner?: boolean }[] | undefined,
	wasLocked: boolean,
): boolean {
	if (nonOwnerCount(usersAfterLeave) === 0) return false;
	return wasLocked;
}
