import { bad } from "../core/err.js";
import type { ProcCred } from "../fs/vfs.js";
import {
  C_PROCESS_LOCK, C_CREDENTIAL_LOCK, P_PID, P_RUID, P_EUID, P_SUID,
  P_RGID, P_EGID, P_SGID, P_FSUID, P_FSGID, P_GROUP_COUNT, P_UMASK,
} from "../native/abi.js";
import { loadU32, storeU32 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { readGroup } from "../native/credentials.js";
import { thistleProcessInstallCredentials, thistleProcessRecord, thistleProcessIdentity, thistleProcessGroups, thistleProcessUmask } from "../native/process-state.js";
import { withNativeLock, withImage, checkNative } from "./native-access.js";

export interface HostIdentity {
  readonly credentials: ProcCred;
  readonly fsuid: number;
  readonly fsgid: number;
  readonly umask: number;
}

/** Non-owning view of a canonical process identified by hart and allocated PID. */
export class HostProcess {
  private readonly pid: number;

  constructor(private readonly memory: ThistleMemory, private readonly hart: number) {
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

  setIdentity(operation: number, first: number, second = 0xffffffff, third = 0xffffffff): number {
    return this.withRecord(() => {
      const result = Number(thistleProcessIdentity(this.memory, this.hart, operation, first, second, third));
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
