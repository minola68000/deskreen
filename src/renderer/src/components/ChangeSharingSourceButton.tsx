import { useCallback, useState } from 'react';
import { Button } from '@blueprintjs/core';
import ShareAppOrScreenControlGroup from './ShareAppOrScreenControlGroup';
import { useTranslation } from 'react-i18next';

interface ChangeSharingSourceButtonProps {
	disabled?: boolean;
	onChanged?: () => void;
}

export default function ChangeSharingSourceButton(
	props: ChangeSharingSourceButtonProps,
) {
	const { disabled, onChanged } = props;
	const { t } = useTranslation();
	const [isOpen, setIsOpen] = useState(false);

	const handleClose = useCallback(() => {
		setIsOpen(false);
	}, []);

	const handleChosen = useCallback(() => {
		setIsOpen(false);
		onChanged?.();
	}, [onChanged]);

	return (
		<>
			<Button
				icon="desktop"
				disabled={disabled}
				onClick={() => setIsOpen(true)}
				style={{ borderRadius: '100px' }}
			>
				{t('change-shared-screen')}
			</Button>
			{isOpen ? (
				<div
					style={{
						position: 'fixed',
						inset: 0,
						zIndex: 10000,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						background: 'rgba(16, 22, 26, 0.55)',
					}}
				>
					<div
						style={{
							background: '#fff',
							borderRadius: '12px',
							padding: '24px',
							maxWidth: '95vw',
						}}
					>
						<div style={{ marginBottom: '16px', textAlign: 'center' }}>
							{t('choose-entire-screen-or-app-window-you-want-to-share')}
						</div>
						<ShareAppOrScreenControlGroup
							handleNextEntireScreen={handleChosen}
							handleNextApplicationWindow={handleChosen}
						/>
						<div style={{ marginTop: '16px', textAlign: 'center' }}>
							<Button onClick={handleClose}>{t('cancel')}</Button>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
