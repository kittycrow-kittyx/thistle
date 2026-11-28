import { Kern } from "./kernel.js";
import type { Lim } from "./cap.js";
import { hostLimits } from "../host/limits.js";
import { DEFAULT_CONFIG } from "./config.js";
import type { SystemConfig } from "./config.js";
import { hostNet } from "../net/host-fetch.js";
import { HostWasiRunner } from "../wasm/host-wasi.js";

/**
 * Host entry point with explicit browser/Node networking and WASI services.
 * Kernel implementation remains the same canonical Thistle Kern class.
 */
export const createHostKernel = (
  lim: Lim = hostLimits(),
  config: SystemConfig = DEFAULT_CONFIG,
  setId = false,
): Kern => new Kern({ net: hostNet(), lim, config, setId, wasiGuest: new HostWasiRunner() });
