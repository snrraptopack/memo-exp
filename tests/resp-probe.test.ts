import { describe, expect, it } from 'vitest';

describe('happy-dom Response.json static', () => {
  it('decodes array body', async () => {
    const response = Response.json([{ id: 'n1', text: 'x', read: false }]);
    const data = await response.json();
    console.error('[probe-resp]', JSON.stringify(data), response.headers.get('content-type'));
    expect(Array.isArray(data)).toBe(true);
  });
});
