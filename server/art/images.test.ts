import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedImage } from './images';

const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
const redirect = (to: string) => new Response(null, { status: 307, headers: { location: to } });
const dir = () => mkdtempSync(join(tmpdir(), 'curio-img-'));

describe('cachedImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows one redirect to an allowed host', async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect('https://www.artic.edu/iiif/2/x/full/843,/0/default.jpg')).mockResolvedValueOnce(jpeg());
    vi.stubGlobal('fetch', f);
    const r = await cachedImage('https://www.artic.edu/iiif/2/x/full/1686,/0/default.jpg', dir());
    expect(r.type).toBe('image/jpeg');
    expect(String(f.mock.calls[1][0])).toContain('/full/843,/');
  });

  it('refuses a redirect to another host', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(redirect('https://evil.example/a.jpg')));
    await expect(cachedImage('https://www.artic.edu/iiif/2/y/full/1686,/0/default.jpg', dir())).rejects.toThrow('redirect not allowed');
  });
});
