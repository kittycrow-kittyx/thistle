import { bad } from "../core/err.js";
import { THISTLE_KERNEL_MEMORY_BYTES } from "../core/kernel-memory.js";
import type { ProcCred } from "../fs/vfs.js";
import { C_MAX_HARTS, H_STATUS, THISTLE_HART_EMPTY } from "../native/abi.js";
import { directMemory, atomicStoreI32, loadU32 } from "../native/memory.js";
import { thistleKernelInit, thistleHartInit, thistleProcessInit, thistleExitHart, thistleProcessReap, thistleNextPid, thistleProcessPark } from "../native/kernel.js";
import { hartAt } from "../native/state.js";
import { HostProcess } from "./process.js";
import { checkNative } from "./native-access.js";

/** Own one canonical memory instance; retain no second process registry. */
export class HostContext {
  readonly memory = directMemory(THISTLE_KERNEL_MEMORY_BYTES);

  constructor() {
    if (thistleKernelInit(this.memory, 1024, false) !== 0) bad("ENOMEM", "canonical kernel initialisation");
  }

  reap(parent: HostProcess, pid: number): void {
    if (parent.memory !== this.memory) bad("ESRCH", "canonical reaper instance");
    checkNative(thistleProcessReap(this.memory, parent.hart, pid));
  }

  nextPid(): number {
    return thistleNextPid(this.memory) || bad("EAGAIN", "canonical PID allocation");
  }

  create(pid: number, ppid: number, credentials: ProcCred): HostProcess {
    const count = loadU32(this.memory, C_MAX_HARTS);
    for (let hart = 0; hart < count; hart++) {
      if (loadU32(this.memory, hartAt(hart) + H_STATUS) !== THISTLE_HART_EMPTY) continue;
      return this.createAt(hart, pid, ppid, credentials);
    }
    return bad("EAGAIN", "canonical hart capacity");
  }

  private createAt(hart: number, pid: number, ppid: number, credentials: ProcCred): HostProcess {
    if (thistleHartInit(this.memory, hart, 0x0000ffffffffffffn, 0n) !== 0) bad("EAGAIN", "canonical hart initialisation");
    const result = thistleProcessInit(this.memory, hart, pid, ppid,
      credentials.ruid, credentials.euid, credentials.suid, credentials.rgid, credentials.egid, credentials.sgid);
    if (result !== 0) {
      atomicStoreI32(this.memory, hartAt(hart) + H_STATUS, THISTLE_HART_EMPTY);
      bad("EAGAIN", "canonical process allocation");
    }
    const view = new HostProcess(this.memory, hart);
    try {
      view.installIdentity(credentials);
      checkNative(thistleProcessPark(this.memory, hart));
      return view;
    } catch (error) {
      thistleExitHart(this.memory, hart, 126);
      if (pid !== 1) checkNative(thistleProcessReap(this.memory, 0, pid));
      throw error;
    }
  }
}
