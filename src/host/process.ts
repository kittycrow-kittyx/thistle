import { thistleProcessFinish, thistleProcessSetHostState, thistleProcessQueueSignal, thistleProcessSignalMask } from "../native/process-host.js";
import { bad } from "../core/err.js";
import { thistleVfsChdir, thistleVfsCwdPath } from "../native/vfs.js";
import type { ProcCred } from "../fs/vfs.js";
import {
  C_PROCESS_LOCK, C_PROCESS_CAPACITY, C_CREDENTIAL_LOCK, C_VFS_GENERATION, P_PID, P_RUID, P_EUID, P_SUID,
  P_RGID, P_EGID, P_SGID, P_FSUID, P_FSGID, P_GROUP_COUNT, P_UMASK, P_PPID, P_PGID, P_STATE, P_EXIT_CODE,
  THISTLE_PROCESS_RUNNABLE, THISTLE_PROCESS_WAITING, THISTLE_PROCESS_ZOMBIE,
  THISTLE_PROCESS_RUNNING, THISTLE_PROCESS_STOPPED, P_SIGNAL_LAST, P_SIGNAL_MASK,
} from "../native/abi.js";
import { atomicLoadU64, atomicStoreI32, loadI32, loadU32, loadU64, storeU32, storeU64 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { readGroup } from "../native/credentials.js";
import { processAt } from "../native/state.js";
import { thistleProcessInstallCredentials, thistleProcessRecord, thistleProcessIdentity, thistleProcessGroups, thistleProcessUmask } from "../native/process-state.js";
import { withNativeLock, withVfsLock, withImage, checkNative } from "./native-access.js";

const identityRequest = (id: number | null): number =>
  id === null ? 0xffffffff : id === 0xffffffff ? Number.NaN : id;

export type HostProcessState = "ready" | "run" | "sleep" | "stop" | "zombie";
export type HostSignal = 0 | 1 | 2 | 9 | 13 | 15;
export interface HostSignalChange { readonly previous: bigint; readonly signal: HostSignal | null }
const decodeSignal = (signal: number): HostSignal | null => {
  if (signal === 0) return null;
  if (signal === 1 || signal === 2 || signal === 9 || signal === 13 || signal === 15) return signal;
  return bad("EPROTO", "unsupported canonical signal");
};
export interface HostProcessPhase { readonly state: HostProcessState; readonly code: number | null }
const phaseCodes: Readonly<Record<HostProcessState, number>> = {
  ready: THISTLE_PROCESS_RUNNABLE, run: THISTLE_PROCESS_RUNNING, sleep: THISTLE_PROCESS_WAITING,
  stop: THISTLE_PROCESS_STOPPED, zombie: THISTLE_PROCESS_ZOMBIE,
};
const phaseNames: Readonly<Record<number, HostProcessState>> = {
  [THISTLE_PROCESS_RUNNABLE]: "ready", [THISTLE_PROCESS_RUNNING]: "run",
  [THISTLE_PROCESS_WAITING]: "sleep", [THISTLE_PROCESS_STOPPED]: "stop", [THISTLE_PROCESS_ZOMBIE]: "zombie",
};

export type HostIdentityField = "ruid" | "euid" | "suid" | "rgid" | "egid" | "sgid" | "fsuid" | "fsgid" | "umask";
const identityOffsets: Readonly<Record<HostIdentityField, number>> = {
  ruid: P_RUID, euid: P_EUID, suid: P_SUID, rgid: P_RGID, egid: P_EGID,
  sgid: P_SGID, fsuid: P_FSUID, fsgid: P_FSGID, umask: P_UMASK,
};

export interface HostIdentity {
  readonly credentials: ProcCred;
  readonly fsuid: number;
  readonly fsgid: number;
  readonly umask: number;
}

/** Non-owning view of a canonical process identified by hart and allocated PID. */
export class HostProcess {
  readonly pid: number;

  constructor(readonly memory: ThistleMemory, readonly hart: number) {
    this.pid = withNativeLock(memory, C_PROCESS_LOCK, () => {
      const record = thistleProcessRecord(memory, hart);
      if (record === 0xffffffff) bad("ESRCH", "missing canonical process");
      return loadU32(memory, record + P_PID);
    });
  }

  private withRecord<T>(operation: (record: number) => T): T {
    return withNativeLock(this.memory, C_PROCESS_LOCK, () => {
      const record = thistleProcessRecord(this.memory, this.hart);
      if (record === 0xffffffff || loadU32(this.memory, record + P_PID) !== this.pid) bad("ESRCH", "canonical process view expired");
      return operation(record);
    });
  }

  /** Hold identity and credentials while a host adapter invokes canonical VFS operations. */
  withFilesystem<T>(operation: (record: number) => T): T {
    return this.withRecord(record => withNativeLock(this.memory, C_CREDENTIAL_LOCK,
      () => withVfsLock(this.memory, () => operation(record))));
  }

  /** The host marshals path bytes; native memory owns the working directory. */
  chdir(path: string): void {
    const bytes = new TextEncoder().encode(path);
    if (bytes.length > 4096) bad("ENAMETOOLONG", path);
    withImage(this.memory, Math.max(1, bytes.length), input => this.withFilesystem(record => {
      this.memory.bytes.set(bytes, input);
      checkNative(thistleVfsChdir(this.memory, record, input, bytes.length));
    }));
  }

  cwdPath(): string {
    return withImage(this.memory, 4096, input => this.withFilesystem(record => {
      const length = thistleVfsCwdPath(this.memory, record, input, 4096);
      checkNative(length);
      return new TextDecoder().decode(this.memory.bytes.subarray(input, input + length - 1));
    }));
  }

  /** Root-only persistence generation receipt under live process and VFS locks. */
  snapshotGeneration(): bigint {
    return this.withFilesystem(record => {
      if (loadU32(this.memory, record + P_FSUID) !== 0) bad("EPERM", "root snapshot requires filesystem UID zero");
      return atomicLoadU64(this.memory, C_VFS_GENERATION);
    });
  }

  get parentPid(): number { return this.withRecord(record => loadU32(this.memory, record + P_PPID)); }
  get groupId(): number { return this.withRecord(record => loadU32(this.memory, record + P_PGID)); }

  get children(): ReadonlySet<number> {
    return this.withRecord(() => {
      const children = new Set<number>(), count = loadU32(this.memory, C_PROCESS_CAPACITY);
      for (let slot = 0; slot < count; slot++) {
        const proc = processAt(this.memory, slot);
        if (loadU32(this.memory, proc + P_STATE) !== 0 && loadU32(this.memory, proc + P_PPID) === this.pid) children.add(loadU32(this.memory, proc + P_PID));
      }
      return children;
    });
  }

  set groupId(value: number) {
    if (!Number.isInteger(value) || value < 1 || value >= 0xffffffff) bad("EINVAL", "process group ID");
    this.withRecord(record => atomicStoreI32(this.memory, record + P_PGID, value | 0));
  }

  finish(code: number): void {
    checkNative(thistleProcessFinish(this.memory, this.hart, this.pid, code));
  }

  get phase(): HostProcessPhase {
    return this.withRecord(record => {
      const state = loadU32(this.memory, record + P_STATE);
      return { state: phaseNames[state] ?? bad("EPROTO", "invalid canonical process phase"),
        code: state === THISTLE_PROCESS_ZOMBIE ? loadI32(this.memory, record + P_EXIT_CODE) & 0xff : null };
    });
  }

  setState(state: HostProcessState): void {
    checkNative(thistleProcessSetHostState(this.memory, this.hart, this.pid, phaseCodes[state]));
  }

  get lastSignal(): HostSignal | null {
    return this.withRecord(record => decodeSignal(loadU32(this.memory, record + P_SIGNAL_LAST)));
  }

  get signalMask(): bigint {
    return this.withRecord(record => atomicLoadU64(this.memory, record + P_SIGNAL_MASK));
  }

  queueSignal(signal: HostSignal): boolean {
    const result = thistleProcessQueueSignal(this.memory, this.hart, this.pid, signal);
    checkNative(result);
    return result === 1;
  }

  changeSignalMask(how: 0 | 1 | 2, mask: bigint): HostSignalChange {
    return withImage(this.memory, 16, input => {
      storeU64(this.memory, input, mask);
      checkNative(thistleProcessSignalMask(this.memory, this.hart, this.pid, how, input));
      return { previous: loadU64(this.memory, input), signal: decodeSignal(loadU32(this.memory, input + 8)) };
    });
  }

  id(field: HostIdentityField): number {
    return this.withRecord(record => withNativeLock(this.memory, C_CREDENTIAL_LOCK,
      () => loadU32(this.memory, record + identityOffsets[field])));
  }

  identity(): HostIdentity {
    return this.withRecord(record => withNativeLock(this.memory, C_CREDENTIAL_LOCK, () => {
      const ruid = loadU32(this.memory, record + P_RUID), euid = loadU32(this.memory, record + P_EUID);
      const rgid = loadU32(this.memory, record + P_RGID), egid = loadU32(this.memory, record + P_EGID);
      const groups: number[] = [], count = loadU32(this.memory, record + P_GROUP_COUNT);
      for (let index = 0; index < count; index++) groups.push(readGroup(this.memory, record, index));
      return {
        credentials: { uid: euid, gid: egid, ruid, euid, suid: loadU32(this.memory, record + P_SUID),
          rgid, egid, sgid: loadU32(this.memory, record + P_SGID), groups },
        fsuid: loadU32(this.memory, record + P_FSUID), fsgid: loadU32(this.memory, record + P_FSGID),
        umask: loadU32(this.memory, record + P_UMASK),
      };
    }));
  }

  setIdentity(operation: number, first: number | null, second: number | null = null, third: number | null = null): number {
    return this.withRecord(() => {
      const result = Number(thistleProcessIdentity(this.memory, this.hart, operation, identityRequest(first), identityRequest(second), identityRequest(third)));
      checkNative(result);
      return result;
    });
  }

  setGroups(groups: readonly number[]): void {
    withImage(this.memory, Math.max(4, groups.length * 4), input => this.withRecord(() => {
      for (let index = 0; index < groups.length; index++) {
        const gid = groups[index] ?? 0xffffffff;
        const valid = Number.isInteger(gid) && gid >= 0 && gid < 0xffffffff;
        storeU32(this.memory, input + index * 4, valid ? gid : 0xffffffff);
      }
      checkNative(thistleProcessGroups(this.memory, this.hart, input, groups.length));
    }));
  }

  /** Trusted constructor/validated-exec metadata, never a guest set-ID operation. */
  installIdentity(credentials: ProcCred, fsuid = credentials.euid, fsgid = credentials.egid): void {
    const ids = [credentials.ruid, credentials.euid, credentials.suid, fsuid,
      credentials.rgid, credentials.egid, credentials.sgid, fsgid];
    withImage(this.memory, 36 + credentials.groups.length * 4, input => this.withRecord(() => {
      const values = [...ids, credentials.groups.length, ...credentials.groups];
      for (let index = 0; index < values.length; index++) {
        const value = values[index] ?? 0xffffffff;
        const valid = Number.isInteger(value) && value >= 0 && value < 0xffffffff;
        storeU32(this.memory, input + index * 4, valid ? value : 0xffffffff);
      }
      checkNative(thistleProcessInstallCredentials(this.memory, this.hart, input));
    }));
  }

  setUmask(mask: number): number {
    return this.withRecord(() => {
      const previous = thistleProcessUmask(this.memory, this.hart, mask);
      checkNative(previous);
      return previous;
    });
  }
}
