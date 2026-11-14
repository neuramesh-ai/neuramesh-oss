// THE BYTES A SESSION PRODUCED, kept for a resume (the session round, 2026-10). A terminal or a Code
// session outlives the relay socket that carried it, and the client that comes back says how many
// bytes it already has. This holds the newest `max` bytes by their absolute offset in the session,
// drops the oldest when full, and reads from any offset it still holds. Bounded on purpose: a session
// nobody watches must not grow the daemon without limit.

export interface Piece { at: number; bytes: Buffer }

export class ResumeBuffer {
  private chunks: Piece[] = [];
  private size = 0;
  private startAt = 0;
  private endAt = 0;
  /** whether the last byte dropped from the front ended a line, so `start` begins a whole one */
  private startOnLine = true;

  constructor(readonly max: number) {}

  /** the oldest offset still held */
  get start(): number { return this.startAt; }
  /** one past the newest byte: every byte the session ever produced */
  get end(): number { return this.endAt; }

  push(bytes: Buffer): void {
    if (!bytes.length) return;
    this.chunks.push({ at: this.endAt, bytes });
    this.endAt += bytes.length;
    this.size += bytes.length;
    while (this.size > this.max && this.chunks.length) {
      const first = this.chunks[0]!;
      const over = this.size - this.max;
      if (first.bytes.length <= over) {
        this.chunks.shift();
        this.size -= first.bytes.length;
        this.startOnLine = first.bytes[first.bytes.length - 1] === 0x0a;
      } else {
        this.startOnLine = first.bytes[over - 1] === 0x0a;
        this.chunks[0] = { at: first.at + over, bytes: first.bytes.subarray(over) };
        this.size -= over;
      }
    }
    this.startAt = this.chunks[0]?.at ?? this.endAt;
  }

  /** what it holds from `from` (never before `start`) to `end`, cut into pieces of at most `piece` bytes */
  read(from: number, piece: number): Piece[] {
    const out: Piece[] = [];
    let pos = Math.max(from, this.startAt);
    for (const c of this.chunks) {
      const cEnd = c.at + c.bytes.length;
      if (cEnd <= pos) continue;
      for (let off = pos - c.at; off < c.bytes.length; off += piece) {
        out.push({ at: c.at + off, bytes: c.bytes.subarray(off, off + piece) });
      }
      pos = cEnd;
    }
    return out;
  }

  /** the first offset at or after `start` that begins a whole line: an event stream that lost bytes
   *  resumes on a whole event, never in the middle of one. `end` when no line begins after it */
  lineStart(): number {
    if (this.startOnLine) return this.startAt;
    for (const c of this.chunks) {
      const i = c.bytes.indexOf(0x0a);
      if (i >= 0) return c.at + i + 1;
    }
    return this.endAt;
  }
}
