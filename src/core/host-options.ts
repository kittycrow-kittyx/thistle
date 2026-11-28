import type { Lim } from "./cap.js";
import { rootCred } from "./config.js";
import type { AccountConfig } from "./config.js";
import { fullCred, credUid } from "../fs/vfs.js";
import type { ProcCred, SessionCred } from "../fs/vfs.js";
import type { SystemConfig } from "./config.js";
import type { Net } from "../net/net.js";
import type { WasmGuestRunner } from "../wasm/guest-runner.js";

export interface KernelOptions {
  net: Net;
  lim: Lim;
  config: SystemConfig;
  setId: boolean;
  wasiGuest: WasmGuestRunner;
}

export type HostAccount = AccountConfig | SessionCred;

/** Resolve host session configuration into complete canonical loader metadata. */
export const accountIdentity = (account: HostAccount | null = null): { cred: ProcCred; name: string; home: string } => {
  if (account === null) return { cred: rootCred(), name: "root", home: "/root" };
  if ("cred" in account) return { cred: fullCred(account.cred), name: account.name, home: account.home };
  const cred = fullCred(account);
  return { cred, name: credUid(cred) === 0 ? "root" : "guest", home: credUid(cred) === 0 ? "/root" : "/home/guest" };
};
