export function shouldReannounceHost(
	isOwnerSocket: boolean,
	users: { isOwner?: boolean }[] | undefined,
): boolean {
	if (isOwnerSocket) return false;
	return !(users || []).some((user) => user.isOwner);
}
