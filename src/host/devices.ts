import { bad } from "../core/err.js";
import { FD_FLAGS, FD_INODE, FD_KIND, FD_OFFSET, P_FSUID, THISTLE_FD_HOST, THISTLE_FD_READ, THISTLE_FD_WRITE, THISTLE_VFS_KIND_CHARACTER } from "../native/abi.js";
import { loadU32, loadU64, storeU64 } from "../native/memory.js";
import { thistleVfsIdentity, thistleVfsKind } from "../native/vfs.js";
import type { HostInode } from "./inode.js";
import type { HostProcess } from "./process.js";
import type { CarrierDescriptor } from "./backing.js";

export interface CharacterDevice {
  readonly read: (length: number) => Uint8Array;
  readonly write: (bytes: Uint8Array) => number;
  readonly repeat: boolean;
}

interface DeviceReceipt {
  readonly inode: number;
  readonly identity: bigint;
  readonly offset: bigint;
  readonly device: CharacterDevice;
}

/** Attach a trusted host transport to an existing canonical character inode. */
export function registerDevice(view: HostInode, process: HostProcess, device: CharacterDevice): void {
  view.access(process, record => {
    const memory = view.memory;
    if (loadU32(memory, record + P_FSUID) !== 0) bad("EPERM", "device registration requires root");
    if (thistleVfsKind(memory, view.ino) !== THISTLE_VFS_KIND_CHARACTER) bad("EINVAL", "not a character device");
    const registry = process.memory.transports.devices;
    const previous = registry.get(view.ino) ?? null;
    if (previous !== null && previous.identity === view.identity) bad("EBUSY", "device transport already registered");
    registry.set(view.ino, { identity: view.identity, device });
  });
}

function receipt(descriptor: CarrierDescriptor, rights: number): DeviceReceipt | null {
  return descriptor.withStorage(state => {
    const memory = descriptor.process.memory;
    const inode = loadU32(memory, state + FD_INODE);
    if (loadU32(memory, state + FD_KIND) !== THISTLE_FD_HOST || inode === 0) return null;
    if ((loadU32(memory, state + FD_FLAGS) & rights) === 0) bad("EBADF", "device descriptor access denied");
    const identity = thistleVfsIdentity(memory, inode);
    const registry = memory.transports.devices;
    const registered = registry.get(inode) ?? bad("EIO", "device transport unavailable");
    if (registered.identity !== identity || identity === 0n) bad("EIO", "device transport expired");
    return { inode, identity, offset: loadU64(memory, state + FD_OFFSET), device: registered.device };
  });
}

function advance(descriptor: CarrierDescriptor, previous: DeviceReceipt, amount: number): void {
  descriptor.withStorage(state => {
    const memory = descriptor.process.memory;
    if (loadU32(memory, state + FD_INODE) !== previous.inode ||
        thistleVfsIdentity(memory, previous.inode) !== previous.identity ||
        loadU64(memory, state + FD_OFFSET) !== previous.offset) bad("EAGAIN", "device descriptor changed during transfer");
    storeU64(memory, state + FD_OFFSET, previous.offset + BigInt(amount));
  });
}

/** Return null only when the descriptor does not refer to a character transport. */
export function readDevice(descriptor: CarrierDescriptor, length: number): Uint8Array | null {
  const current = receipt(descriptor, THISTLE_FD_READ);
  if (current === null) return null;
  if (length === 0 || (!current.device.repeat && current.offset > 0n)) return new Uint8Array();
  const bytes = current.device.read(length).slice(0, length);
  advance(descriptor, current, bytes.length);
  return bytes;
}

/** Write through the retained host capability and report its actual transfer count. */
export function writeDevice(descriptor: CarrierDescriptor, bytes: Uint8Array): number | null {
  const current = receipt(descriptor, THISTLE_FD_WRITE);
  if (current === null) return null;
  if (bytes.length === 0) return 0;
  const amount = current.device.write(bytes);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > bytes.length) bad("EIO", "invalid device write count");
  advance(descriptor, current, amount);
  return amount;
}
