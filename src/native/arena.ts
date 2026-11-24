import { P_PAGE_TABLE, P_PAGE_CAPACITY, THISTLE_PAGE_ENTRY_SIZE, C_IMAGE_TOP, C_IMAGE_LOCK, C_IMAGE_SIZE, THISTLE_CONTROL_BASE, C_PHYSICAL_FREE, C_PHYSICAL_NEXT, C_VFS_DATA_END, THISTLE_GUEST_PAGE_SIZE } from "./abi.js";
import { atomicLoadI32, fill, loadU32, loadU64, storeU32 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { Ptr, U32 } from "./types.js";

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
    if (loadU64(memory, entry) !== 0n &&
        !validFrame(memory, frame)) return false;
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
    }
    index += 1;
  }
  fill(memory, table, count * THISTLE_PAGE_ENTRY_SIZE, 0);
};

