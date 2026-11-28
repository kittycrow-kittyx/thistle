export type Errno =
  | "EACCES" | "EAGAIN" | "EBADF" | "EBUSY" | "ECHILD" | "EEXIST"
  | "EXDEV" | "EFAULT" | "EFBIG" | "EINTR" | "EINVAL" | "EIO" | "EISDIR" | "ELOOP" | "EMFILE"
  | "ENAMETOOLONG" | "ENFILE" | "ENOENT" | "ENOEXEC" | "ENOMEM"
  | "ENETUNREACH" | "ENOSPC" | "ENOSYS" | "ENOTDIR" | "ENOTEMPTY" | "ENOTSUP"
  | "EPERM" | "EPIPE" | "ESPIPE" | "EPROTO" | "ERANGE" | "EROFS" | "ESRCH" | "ETIMEDOUT";

export class KErr extends Error {
  constructor(public readonly code: Errno, msg: string = code) {
    super(msg);
    this.name = "KErr";
  }
}

export const bad = (code: Errno, msg: string = code): never => {
  throw new KErr(code, msg);
};

export const msg = (e: Error | string): string => {
  if (e instanceof KErr) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
};

/** Read a required indexed value without hiding an invalid index or missing entry. */
export function requireValue<T>(value: T | null, expression: string): T {
  if (value === null) throw new KErr("EFAULT", `missing value: ${expression}`);
  return value;
}

/** Read an optional array slot with an explicit missing-value result. */
export function indexedValue<T>(values: ArrayLike<T>, index: number): T | null {
  return values[index] ?? null;
}

/** Read an optional map entry with an explicit missing-value result. */
export function mappedValue<K, V>(values: ReadonlyMap<K, V>, key: K): V | null {
  return values.get(key) ?? null;
}

/** Apply an operation only when its input is present. */
export function withValue<T, R>(value: T | null, use: (value: T) => R): R | null {
  if (value === null) return null;
  return use(value);
}

/** Enforce an invariant while preserving control-flow narrowing and lazy errors. */
export function ensure<T>(condition: T, failure: () => never): asserts condition {
  if (!condition) failure();
}
