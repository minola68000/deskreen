import { useEffect, useRef, useState } from 'react';
import { Button, H3, Spinner } from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import { IpcEvents } from '../../../../../common/IpcEvents.enum';
import {
	cropFromDrag,
	pointInBox,
	type CaptureCrop,
} from '../../../../../common/captureCrop';

interface WindowCropPickerProps {
	sourceId: string;
	onConfirm: (crop: CaptureCrop | null) => void;
	onCancel: () => void;
}

export default function WindowCropPicker(props: WindowCropPickerProps) {
	const { sourceId, onConfirm, onCancel } = props;
	const { t } = useTranslation();
	const imageRef = useRef<HTMLImageElement | null>(null);
	const dragStart = useRef<{ x: number; y: number } | null>(null);
	const [imageUrl, setImageUrl] = useState('');
	const [crop, setCrop] = useState<CaptureCrop | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.electron.ipcRenderer
			.invoke(IpcEvents.GetDesktopCapturerServiceSourcesByIds, [sourceId])
			.then((sources: Record<string, { source?: { thumbnail?: string } }>) => {
				if (cancelled) return;
				setImageUrl(sources?.[sourceId]?.source?.thumbnail || '');
			})
			.catch((error: unknown) => {
				console.error(error);
			});
		return () => {
			cancelled = true;
		};
	}, [sourceId]);

	const pointFromEvent = (event: { clientX: number; clientY: number }) => {
		const bounds = imageRef.current?.getBoundingClientRect();
		if (!bounds) return { x: 0, y: 0 };
		return pointInBox(event.clientX, event.clientY, bounds);
	};

	return (
		<div style={{ padding: '80px 24px 24px' }}>
			<H3>{t('drag-window-region')}</H3>
			<div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
				{imageUrl ? (
					<img
						ref={imageRef}
						src={imageUrl}
						alt=""
						draggable={false}
						onPointerDown={(event) => {
							imageRef.current?.setPointerCapture(event.pointerId);
							dragStart.current = pointFromEvent(event);
							setCrop(null);
						}}
						onPointerMove={(event) => {
							if (!dragStart.current) return;
							const point = pointFromEvent(event);
							setCrop(
								cropFromDrag(
									dragStart.current.x,
									dragStart.current.y,
									point.x,
									point.y,
								),
							);
						}}
						onPointerUp={() => {
							dragStart.current = null;
						}}
						style={{
							maxWidth: '100%',
							maxHeight: '55vh',
							touchAction: 'none',
							userSelect: 'none',
						}}
					/>
				) : (
					<Spinner />
				)}
				{crop ? (
					<div
						style={{
							position: 'absolute',
							left: `${crop.x * 100}%`,
							top: `${crop.y * 100}%`,
							width: `${crop.width * 100}%`,
							height: `${crop.height * 100}%`,
							border: '2px solid #2B95D6',
							background: 'rgba(43, 149, 214, 0.25)',
							pointerEvents: 'none',
						}}
					/>
				) : null}
			</div>
			<div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
				<Button intent="primary" disabled={!crop} onClick={() => onConfirm(crop)}>
					{t('share-window-region')}
				</Button>
				<Button onClick={() => onConfirm(null)}>{t('share-whole-window')}</Button>
				<Button onClick={onCancel}>{t('no,-cancel')}</Button>
			</div>
		</div>
	);
}
