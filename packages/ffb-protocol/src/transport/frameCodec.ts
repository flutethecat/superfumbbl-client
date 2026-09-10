import lzString from 'lz-string';

/**
 * Frame encoding matching the upstream client (CommandEndpoint.java):
 * - Outgoing: JSON text, optionally LZ-String compressToUTF16, then sent as a
 *   binary frame containing the UTF-8 bytes of that string.
 * - Incoming: text frames used directly; binary frames UTF-8 decoded first.
 *   If compression is on, LZ-String decompressFromUTF16 yields the JSON text.
 *
 * Compression is toggled by the CLIENT_COMMAND_COMPRESSION property the server
 * announces (see ServerCommandVersion clientProperties).
 */
export class FrameCodec {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder('utf-8');

  constructor(public compression = false) {}

  encode(json: string): Uint8Array {
    const text = this.compression ? lzString.compressToUTF16(json) : json;
    return this.encoder.encode(text);
  }

  decode(frame: string | Uint8Array | ArrayBuffer): string {
    const text =
      typeof frame === 'string'
        ? frame
        : this.decoder.decode(frame instanceof ArrayBuffer ? frame : (frame as Uint8Array));
    if (!this.compression) {
      return text;
    }
    const decompressed = lzString.decompressFromUTF16(text);
    if (decompressed == null || decompressed === '') {
      throw new Error('FrameCodec: failed to LZString-decompress incoming frame');
    }
    return decompressed;
  }
}
