import os from "os";

// Wi-Fi interface patterns for detection and prioritization
const macosWifiInterfaces = ["en0", "en1"]; // macOS Wi-Fi interfaces (commonly en0, en1, though can also be Ethernet)
const linuxWifiPrefixes = ["wlan", "wlo", "wlp"]; // Linux Wi-Fi interface prefixes
const windowsWifiInterfaces = [
  "Wi-Fi",
  "Wireless LAN adapter Wi-Fi",
  "Wireless LAN adapter",
  "Wireless Network Connection",
  "WLAN",
]; // Windows Wi-Fi interface patterns

// Virtualization interface patterns
const virtualPrefixes = [
  "docker", // Docker Bridge
  "veth", // Linux Virtual Ethernet (Containers)
  "virbr", // Linux KVM/QEMU/Libvirt
  "vboxnet", // VirtualBox (Linux/macOS)
  "vmnet", // VMware (Linux/macOS)
  "br-", // Linux Bridge (often Docker or custom)
  "VirtualBox", // Windows VirtualBox
  "VMware", // Windows VMware
];

const virtualInterfaces = [
  "awdl0", // macOS peer-to-peer (AirDrop)
  "bridge100", // macOS bridge (virtual interface)
  "vEthernet", // Windows Ethernet Hyper-V
  "docker0", // Linux Docker standard bridge
  "virbr0",  // Linux KVM/QEMU standard bridge
  "vboxnet0", // VirtualBox (Linux/macOS)
  "vmnet1",   // VMware (Linux/macOS)
  "vmnet8",   // VMware (Linux/macOS)
  "VirtualBox Host-Only Network", // Windows VirtualBox
  "VMware Network Adapter VMnet1", // Windows VMware
  "VMware Network Adapter VMnet8", // Windows VMware
];

/**
 * Check if an interface name indicates a Wi-Fi interface across all operating systems
 * @param interfaceName - The network interface name to check
 * @returns true if the interface is likely Wi-Fi, false otherwise
 */
function isWifiInterface(interfaceName: string): boolean {
  // Check exact matches for macOS
  if (macosWifiInterfaces.includes(interfaceName)) {
    return true;
  }
  
  // Check if starts with Linux Wi-Fi patterns
  if (linuxWifiPrefixes.some((pattern) => interfaceName.startsWith(pattern))) {
    return true;
  }
  
  // Check if starts with or equals Windows Wi-Fi patterns
  if (
    windowsWifiInterfaces.some((pattern) =>
      interfaceName.startsWith(pattern) || interfaceName === pattern,
    )
  ) {
    return true;
  }
  
  return false;
}

function isVirtualInterface(interfaceName: string): boolean {
  if (
    virtualInterfaces.some((pattern) =>
      interfaceName.startsWith(pattern) || interfaceName === pattern
    )
  ) {
    return true;
  }

  return virtualPrefixes.some((pattern) => interfaceName.startsWith(pattern));
}

type LocalIpInterface = {
  address: string;
  family: string | number;
  internal: boolean;
};

export type LocalIpChoice = {
  interfaceName: string;
  ipAddress: string;
};

function isIpv4Family(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function isLinkLocalIpv4(ip: string): boolean {
  return ip.startsWith("169.254.");
}

function isPrivateLanIpv4(ip: string): boolean {
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return true;
  }
  const match = /^172\.(\d+)\./.exec(ip);
  if (!match) {
    return false;
  }
  const octet = Number(match[1]);
  return octet >= 16 && octet <= 31;
}

/**
 * Pick an address another device on the same LAN can open.
 * Localized names such as "イーサネット" are included. Link-local and virtual
 * adapters lose to a private LAN address. A usable Wi-Fi address wins.
 */
export function chooseLocalIpv4(
  networkInterfaces: Record<string, LocalIpInterface[] | undefined>,
): LocalIpChoice | undefined {
  let wifiLan: LocalIpChoice | undefined;
  let lan: LocalIpChoice | undefined;
  let other: LocalIpChoice | undefined;
  let virtual: LocalIpChoice | undefined;

  Object.entries(networkInterfaces).forEach(([networksKey, networks]) => {
    if (!networks) return;
    if (networksKey.startsWith("bridge")) return;

    networks.forEach((network) => {
      if (network.internal || !isIpv4Family(network.family)) return;
      if (isLinkLocalIpv4(network.address)) return;
      const choice = {
        interfaceName: networksKey,
        ipAddress: network.address,
      };
      if (isVirtualInterface(networksKey)) {
        if (!virtual) virtual = choice;
        return;
      }
      if (isWifiInterface(networksKey) && isPrivateLanIpv4(network.address)) {
        if (!wifiLan) wifiLan = choice;
        return;
      }
      if (isPrivateLanIpv4(network.address)) {
        if (!lan) lan = choice;
        return;
      }
      if (!other) other = choice;
    });
  });

  return wifiLan || lan || other || virtual;
}

export function getActiveNetworkInterface(): LocalIpChoice | undefined {
  return chooseLocalIpv4(os.networkInterfaces());
}

export default function getMyLocalIpV4(): string | undefined {
  return getActiveNetworkInterface()?.ipAddress;
}
