/** Reject addressable sockets and io_uring's alternate path. Anonymous AF_UNIX stream pairs are
 * local IPC only: libuv needs them for child-process stdio, including Node's test runner. */
export function engineeringNetworkSeccompFilter(): Buffer {
  const platform = process.arch === 'x64'
    ? { auditArch: 0xc000003e, socket: 41, socketpair: 53, address: [42, 49, 50], ioUringSetup: 425 }
    : process.arch === 'arm64'
      ? { auditArch: 0xc00000b7, socket: 198, socketpair: 199, address: [203, 200, 201], ioUringSetup: 425 }
      : null;
  if (!platform) throw new Error(`Code command execution does not support Linux architecture ${process.arch}.`);
  const instructions: Array<[number, number, number, number]> = [
    [0x20, 0, 0, 4], // load seccomp_data.arch
    [0x15, 1, 0, platform.auditArch],
    [0x06, 0, 0, 0x80000000], // kill a process that changes syscall ABI
    [0x20, 0, 0, 0], // load seccomp_data.nr
  ];
  // x32 shares AUDIT_ARCH_X86_64 but ORs this bit into its syscall numbers. Refuse that ABI
  // outright rather than letting its alternate socket numbers fall through to the allow rule.
  if (process.arch === 'x64') instructions.push(
    [0x45, 0, 1, 0x40000000], // BPF_JSET __X32_SYSCALL_BIT
    [0x06, 0, 0, 0x00050001], // EPERM
  );
  for (const syscall of [platform.socket, ...platform.address, platform.ioUringSetup]) {
    instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, 0x00050001]); // EPERM
  }
  instructions.push(
    [0x15, 0, 8, platform.socketpair],
    [0x20, 0, 0, 16], // low word of args[0] (domain), an int on supported little-endian ABIs
    [0x15, 1, 0, 1], // AF_UNIX only; bind/connect/listen stay blocked above
    [0x06, 0, 0, 0x00050001], // other socketpair domains remain forbidden
    [0x20, 0, 0, 24], // low word of args[1] (type)
    [0x54, 0, 0, 0xf], // SOCK_TYPE_MASK: ignore CLOEXEC/NONBLOCK flags
    [0x15, 1, 0, 1], // SOCK_STREAM only; datagrams could sendto an outside Unix address
    [0x06, 0, 0, 0x00050001],
    [0x06, 0, 0, 0x7fff0000],
  );
  instructions.push([0x06, 0, 0, 0x7fff0000]); // allow
  const filter = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jt, jf, value], index) => {
    const offset = index * 8;
    filter.writeUInt16LE(code, offset); filter.writeUInt8(jt, offset + 2);
    filter.writeUInt8(jf, offset + 3); filter.writeUInt32LE(value, offset + 4);
  });
  return filter;
}

