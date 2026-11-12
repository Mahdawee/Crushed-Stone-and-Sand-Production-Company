import fs from 'node:fs';

/** Basic PE/x64 sanity check, not an Authenticode or integrity verification. */
export function assertWindowsExe(file, label = 'node.exe') {
  let buf;
  try { buf = fs.readFileSync(file); } catch { throw new Error(`${label} خوانده نشد`); }
  if (buf.length < 1024 || buf[0] !== 0x4d || buf[1] !== 0x5a) {
    throw new Error(`${label} فایل اجرایی ویندوز نیست (امضای MZ ندارد)`);
  }
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.length < peOff + 6 || buf.toString('latin1', peOff, peOff + 4) !== 'PE\u0000\u0000') {
    throw new Error(`${label} ساختار PE معتبر ندارد`);
  }
  const machine = buf.readUInt16LE(peOff + 4);
  if (machine !== 0x8664) throw new Error(`${label} برای x64 نیست (machine=0x${machine.toString(16)})`);
}

/** Only copy the *currently running* compatible Windows x64 Node runtime. */
export function copyInstalledNode(dest, { platform = process.platform, arch = process.arch, execPath = process.execPath, version = process.versions.node } = {}) {
  if (platform !== 'win32' || arch !== 'x64') return false;
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 22 || (major === 22 && minor < 12)) return false;
  assertWindowsExe(execPath, 'Node نصب‌شده');
  fs.copyFileSync(execPath, dest);
  assertWindowsExe(dest);
  return true;
}
