import os from 'os';
import { chooseLocalIpv4 } from './getMyLocalIpV4';

export default function isWifiConnected(): boolean {
	return chooseLocalIpv4(os.networkInterfaces()) !== undefined;
}
