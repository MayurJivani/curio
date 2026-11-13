import { describe, expect, it } from 'vitest';
import { normalizeAic, normalizeCma, normalizeMet } from './providers';

const aicRaw = {
  id: 8991, title: 'Improvisation No. 30 (Cannons)', artist_title: 'Vasily Kandinsky', date_display: '1913',
  image_id: 'b5bc6b66', thumbnail: { width: 10199, height: 10244 }, medium_display: 'Oil on canvas',
  department_title: 'Modern Art', is_public_domain: true, artwork_type_title: 'Painting',
};
const cmaRaw = {
  id: 135705, title: 'Mother and Child', type: 'Print', share_license_status: 'CC0', creation_date: 'c. 1915',
  creators: [{ description: 'Koshiro Onchi (Japanese, 1891–1955)' }], url: 'https://clevelandart.org/art/1959.240',
  images: {
    web: { url: 'https://openaccess-cdn.clevelandart.org/1959.240/1959.240_web.jpg', width: '770', height: '893' },
    print: { url: 'https://openaccess-cdn.clevelandart.org/1959.240/1959.240_print.jpg', width: '2931', height: '3400' },
  },
};
const metRaw = {
  objectID: 436531, isPublicDomain: true, classification: 'Paintings', title: 'Wheat Field with Cypresses',
  artistDisplayName: 'Vincent van Gogh', objectDate: '1889', objectURL: 'https://www.metmuseum.org/art/collection/search/436531',
  primaryImage: 'https://images.metmuseum.org/CRDImages/ep/original/DT1567.jpg',
  primaryImageSmall: 'https://images.metmuseum.org/CRDImages/ep/web-large/DT1567.jpg',
};

describe('normalize', () => {
  it('aic', () => {
    const a = normalizeAic(aicRaw)!;
    expect(a).toMatchObject({ id: 'aic:8991', artist: 'Vasily Kandinsky', width: 1686, sourceUrl: 'https://www.artic.edu/artworks/8991' });
    expect(a.imageUrl).toBe('https://www.artic.edu/iiif/2/b5bc6b66/full/1686,/0/default.jpg');
    expect(a.height).toBe(Math.round((1686 * 10244) / 10199));
    expect(normalizeAic({ ...aicRaw, is_public_domain: false })).toBeNull();
    expect(normalizeAic({ ...aicRaw, image_id: null })).toBeNull();
    expect(normalizeAic({ ...aicRaw, artwork_type_title: 'Print' })).toBeNull();
    expect(normalizeAic({ ...aicRaw, artwork_type_title: 'Print' }, ['print'])).not.toBeNull();
  });
  it('cma', () => {
    const a = normalizeCma(cmaRaw, ['print'])!;
    expect(a).toMatchObject({ id: 'cma:135705', artist: 'Koshiro Onchi', width: 2931, height: 3400, license: 'CC0' });
    expect(a.thumbnailUrl).toContain('_web.jpg');
    expect(normalizeCma({ ...cmaRaw, share_license_status: 'Copyrighted' }, ['print'])).toBeNull();
    expect(normalizeCma({ ...cmaRaw, images: {} }, ['print'])).toBeNull();
    expect(normalizeCma({ ...cmaRaw, creators: [] }, ['print'])!.artist).toBe('Unknown artist');
  });
  it('met', () => {
    expect(normalizeMet(metRaw)).toMatchObject({ id: 'met:436531', artist: 'Vincent van Gogh', imageUrl: metRaw.primaryImage });
    expect(normalizeMet({ ...metRaw, isPublicDomain: false })).toBeNull();
    expect(normalizeMet({ ...metRaw, primaryImage: '' })).toBeNull();
  });
});
