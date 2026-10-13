import { HostError, MAX_OPERATIONS, MAX_PACKET_BYTES, type Publication } from './protocol';

/** Bound snapshots without depending on an engine's TextEncoder or Buffer APIs. */
export function snapshotPublication(publication: Publication): string {
  if (!Array.isArray(publication.operations) || publication.operations.length > MAX_OPERATIONS) {
    throw new HostError('invalidPublication', 'Publication operation array exceeds its contract');
  }
  const body = JSON.stringify({
    templates: publication.templates,
    operations: publication.operations,
  });
  // Reserve envelope capacity for version and the largest safe sequence.
  const budget = MAX_PACKET_BYTES - 64;
  if (body.length > budget || utf8Length(body) > budget) {
    throw new HostError('packetTooLarge', 'Desktop publication exceeds the byte budget');
  }
  return body;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes++;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
