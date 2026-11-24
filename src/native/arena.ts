import { P_PAGE_TABLE, P_PAGE_CAPACITY, THISTLE_PAGE_ENTRY_SIZE, C_IMAGE_TOP, C_IMAGE_LOCK, C_IMAGE_SIZE, THISTLE_CONTROL_BASE, C_PHYSICAL_FREE, C_PHYSICAL_NEXT, C_VFS_DATA_END, THISTLE_GUEST_PAGE_SIZE, PAGE_DIRTY_FRAME, C_MEMORY_LOCK } from "./abi.js";
import { atomicLoadI32, atomicStoreI32, compareExchangeI32, fill, loadU32, loadU64, storeU32 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { I32, Ptr, U32 } from "./types.js";

const INVALID: Ptr = 0xffffffff;
const frameBase = (memory: ThistleMemory): Ptr =>
  (loadU32(memory, C_VFS_DATA_END) + THISTLE_GUEST_PAGE_SIZE - 1) & -THISTLE_GUEST_PAGE_SIZE;

export const validFrame = (memory: ThistleMemory, frame: Ptr): boolean =>
  frame !== 0 && frame >= frameBase(memory) && frame < loadU32(memory, C_PHYSICAL_NEXT) &&
  frame % THISTLE_GUEST_PAGE_SIZE === 0;

// All operations run while the canonical memory lock is held.
export const allocateFrame = (memory: ThistleMemory): Ptr => {
  const recycled = loadU32(memory, C_PHYSICAL_FREE);
  const frame = recycled !== 0 ? recycled : loadU32(memory, C_PHYSICAL_NEXT);
  const end = loadU32(memory, C_IMAGE_TOP);
  if (recycled !== 0 && !validFrame(memory, frame)) return INVALID;
  if (frame > end || THISTLE_GUEST_PAGE_SIZE > end - frame) return INVALID;
  const next = recycled !== 0 ? loadU32(memory, frame) : 0;
  fill(memory, frame, THISTLE_GUEST_PAGE_SIZE, 0);
  if (recycled !== 0) storeU32(memory, C_PHYSICAL_FREE, next);
  else storeU32(memory, C_PHYSICAL_NEXT, frame + THISTLE_GUEST_PAGE_SIZE);
  return frame;
};

export const releaseFrame = (memory: ThistleMemory, frame: Ptr): void => {
  storeU32(memory, frame, loadU32(memory, C_PHYSICAL_FREE));
  storeU32(memory, C_PHYSICAL_FREE, frame);
};

const unlinkFreeFrame = (memory: ThistleMemory, wanted: Ptr): boolean => {
  let link: Ptr = C_PHYSICAL_FREE;
  let frame = loadU32(memory, link);
  while (frame !== 0) {
    if (frame === wanted) {
      storeU32(memory, link, loadU32(memory, frame));
      return true;
    }
    link = frame;
    frame = loadU32(memory, frame);
  }
  return false;
};

export const trimFreeFrames = (memory: ThistleMemory): void => {
  const base = frameBase(memory);
  let top = loadU32(memory, C_PHYSICAL_NEXT);
  while (top > base) {
    const frame = top - THISTLE_GUEST_PAGE_SIZE;
    if (!unlinkFreeFrame(memory, frame)) return;
    top = frame;
    storeU32(memory, C_PHYSICAL_NEXT, top);
  }
};

/** Access is valid only inside the current locked input image reservation. */
export const inputContains = (memory: ThistleMemory, at: Ptr, size: U32): boolean => {
  if (atomicLoadI32(memory, THISTLE_CONTROL_BASE + C_IMAGE_LOCK) !== 1) return false;
  const start = loadU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_TOP);
  const length = loadU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_SIZE);
  return at >= start && at - start <= length && size <= length - (at - start);
};

export const validProcessFrames = (memory: ThistleMemory, proc: Ptr): boolean => {
  const table = loadU32(memory, proc + P_PAGE_TABLE);
  const count = loadU32(memory, proc + P_PAGE_CAPACITY);
  let index: U32 = 0;
  while (index < count) {
    const entry = table + index * THISTLE_PAGE_ENTRY_SIZE;
    const frame = loadU32(memory, entry + 8);
    const dirty = loadU32(memory, entry + PAGE_DIRTY_FRAME);
    if (loadU64(memory, entry) !== 0n &&
        (!validFrame(memory, frame) || (dirty !== 0 && (dirty === frame || !validFrame(memory, dirty))))) return false;
    index += 1;
  }
  return true;
};

export const releaseProcessFrames = (memory: ThistleMemory, proc: Ptr): void => {
  const table = loadU32(memory, proc + P_PAGE_TABLE);
  const count = loadU32(memory, proc + P_PAGE_CAPACITY);
  let index: U32 = 0;
  while (index < count) {
    const entry = table + index * THISTLE_PAGE_ENTRY_SIZE;
    if (loadU64(memory, entry) !== 0n) {
      const frame = loadU32(memory, entry + 8);
      releaseFrame(memory, frame);
      const dirty = loadU32(memory, entry + PAGE_DIRTY_FRAME);
      if (dirty !== 0) releaseFrame(memory, dirty);
    }
    index += 1;
  }
  fill(memory, table, count * THISTLE_PAGE_ENTRY_SIZE, 0);
};


const dirtyFrame = (memory: ThistleMemory, entry: Ptr): Ptr => {
  const current = loadU32(memory, entry + PAGE_DIRTY_FRAME);
  if (current !== 0) return current;
  if (compareExchangeI32(memory, C_MEMORY_LOCK, 0, 1) !== 0) return INVALID;
  let frame = loadU32(memory, entry + PAGE_DIRTY_FRAME);
  if (frame === 0) {
    frame = allocateFrame(memory);
    if (frame !== INVALID) storeU32(memory, entry + PAGE_DIRTY_FRAME, frame);
  }
  atomicStoreI32(memory, C_MEMORY_LOCK, 0);
  return frame;
};

const dirtyMask = (offset: U32, count: U32): I32 =>
  (0xffffffff >>> (32 - count)) << (offset & 31);

const dirtyWordUpdate = (memory: ThistleMemory, at: Ptr, mask: I32, mark: boolean): void => {
  let old = atomicLoadI32(memory, at);
  let next = mark ? old | mask : old & ~mask;
  while (old !== next && compareExchangeI32(memory, at, old, next) !== old) {
    old = atomicLoadI32(memory, at);
    next = mark ? old | mask : old & ~mask;
  }
};

const dirtyBytesUpdate = (memory: ThistleMemory, frame: Ptr, offset: U32, length: U32, mark: boolean): void => {
  let done: U32 = 0;
  while (done < length) {
    const current = offset + done;
    const room = 32 - (current & 31);
    const count = room < length - done ? room : length - done;
    dirtyWordUpdate(memory, frame + (current >>> 5) * 4, dirtyMask(current, count), mark);
    done += count;
  }
};

/** One bit per guest byte, allocated from the canonical arena only on a shared-file write. */
export const markDirtyBytes = (memory: ThistleMemory, entry: Ptr, offset: U32, length: U32): boolean => {
  if (offset >= THISTLE_GUEST_PAGE_SIZE || length > THISTLE_GUEST_PAGE_SIZE - offset) return false;
  if (length === 0) return true;
  const frame = dirtyFrame(memory, entry);
  if (frame === INVALID) return false;
  dirtyBytesUpdate(memory, frame, offset, length, true);
  return true;
};

/** Clear only the acknowledged bytes; adjacent dirty ranges remain retained. */
export const clearDirtyBytes = (memory: ThistleMemory, entry: Ptr, offset: U32, length: U32): void => {
  const frame = loadU32(memory, entry + PAGE_DIRTY_FRAME);
  if (frame !== 0) dirtyBytesUpdate(memory, frame, offset, length, false);
};

/** Determine whether a range contains any unpublished shared-file writes. */
export const hasDirtyBytes = (memory: ThistleMemory, entry: Ptr, offset: U32, length: U32): boolean => {
  const frame = loadU32(memory, entry + PAGE_DIRTY_FRAME);
  if (frame === 0) return false;
  let done: U32 = 0;
  while (done < length) {
    const current = offset + done;
    const room = 32 - (current & 31);
    const count = room < length - done ? room : length - done;
    if ((atomicLoadI32(memory, frame + (current >>> 5) * 4) & dirtyMask(current, count)) !== 0) return true;
    done += count;
  }
  return false;
};
