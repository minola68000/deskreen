export type SharingSessionLike = {
	status: number;
};

/** SHARING = 2 in SharingSessionStatusEnum */
export const SHARING_STATUS = 2;

/**
 * While a session is already sharing, change its source.
 * Before sharing starts, change the waiting session instead.
 */
export function sessionsToUpdateForSourceChange(
	waiting: SharingSessionLike | null | undefined,
	sharing: Iterable<SharingSessionLike>,
): { updateWaiting: boolean; updateSharing: boolean } {
	for (const session of sharing) {
		if (session.status === SHARING_STATUS) {
			return { updateWaiting: false, updateSharing: true };
		}
	}
	return { updateWaiting: Boolean(waiting), updateSharing: false };
}
