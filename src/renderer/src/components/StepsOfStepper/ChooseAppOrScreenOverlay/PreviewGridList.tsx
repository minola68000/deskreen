import { Row, Col } from 'react-flexbox-grid';
import SharingSourcePreviewCard from '../../SharingSourcePreviewCard';
import { IpcEvents } from '../../../../../common/IpcEvents.enum';

interface PreviewGridListProps {
	viewSharingIds: string[];
	isEntireScreen: boolean;
	handleNextEntireScreen: () => void;
	handleNextApplicationWindow: () => void;
	onSelectWindow: (sourceId: string) => void;
}

export default function PreviewGridList(props: PreviewGridListProps) {
	const {
		viewSharingIds,
		isEntireScreen,
		handleNextEntireScreen,
		onSelectWindow,
	} = props;

	return (
		<Row
			center="xs"
			around="xs"
			style={{
				height: '90%',
			}}
		>
			{viewSharingIds.map((id) => {
				return (
					<Col xs={12} md={6} key={id}>
						<SharingSourcePreviewCard
							sharingSourceID={id}
							isChangeAppearanceOnHover
							onClickCard={async () => {
								if (!isEntireScreen) {
									onSelectWindow(id);
									return;
								}
								window.electron.ipcRenderer.invoke(
									IpcEvents.SetDesktopCapturerSourceId,
									id,
								);
								handleNextEntireScreen();
							}}
						/>
					</Col>
				);
			})}
		</Row>
	);
}
