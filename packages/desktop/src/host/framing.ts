import { HostError, MAX_PACKET_BYTES } from './protocol';

/** The streaming byte codec lives at the adapter boundary, outside the client. */
export function encodeFrame(json: string): Uint8Array {
  // Reject obvious oversize input before allocating its UTF-8 representation.
  if (json.length === 0 || json.length > MAX_PACKET_BYTES) {
    throw new HostError('invalidFrameLength', 'Desktop frame exceeds its byte budget');
  }
  const payload = new TextEncoder().encode(json);
  if (payload.byteLength > MAX_PACKET_BYTES) {
    throw new HostError('invalidFrameLength', 'Desktop UTF-8 frame exceeds its byte budget');
  }
  const frame = new Uint8Array(payload.byteLength + 4);
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false);
  frame.set(payload, 4);
  return frame;
}

/**
 * Allocate only after validating a complete prefix. Consume arbitrary chunks
 * directly, keeping at most one frame; never repeatedly concatenate a backlog.
 */
export class FrameDecoder {
  private readonly header = new Uint8Array(4);
  private headerBytes = 0;
  private payload?: Uint8Array;
  private payloadBytes = 0;
  private closed = false;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly receive: (value: unknown) => void) {}

  push(chunk: Uint8Array): void {
    if (this.closed) throw new HostError('closed', 'Desktop reply stream is closed');
    let offset = 0;
    try {
      while (offset < chunk.byteLength) {
        if (!this.payload) {
          const count = Math.min(4 - this.headerBytes, chunk.byteLength - offset);
          this.header.set(chunk.subarray(offset, offset + count), this.headerBytes);
          offset += count;
          this.headerBytes += count;
          if (this.headerBytes < 4) continue;

          const length = new DataView(this.header.buffer).getUint32(0, false);
          if (length === 0 || length > MAX_PACKET_BYTES) {
            throw new HostError('invalidFrameLength', 'Native reply length exceeds its byte budget');
          }
          this.payload = new Uint8Array(length);
        }

        const count = Math.min(this.payload.length - this.payloadBytes, chunk.byteLength - offset);
        this.payload.set(chunk.subarray(offset, offset + count), this.payloadBytes);
        this.payloadBytes += count;
        offset += count;
        if (this.payloadBytes === this.payload.length) {
          const value: unknown = JSON.parse(this.decoder.decode(this.payload));
          this.headerBytes = 0;
          this.payloadBytes = 0;
          this.payload = undefined;
          this.receive(value);
        }
      }
    } catch (error) {
      this.closed = true;
      this.payload = undefined;
      throw error;
    }
  }

  end(): void {
    this.closed = true;
    if (this.headerBytes !== 0 || this.payload) {
      this.payload = undefined;
      throw new HostError('truncatedFrame', 'Native reply stream ended inside a frame');
    }
  }
}
