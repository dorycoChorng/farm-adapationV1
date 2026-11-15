import { isCommonsUpload, loadPhotoCredit, plainText } from '../photoCredit';

describe('crop photo licences', () => {
  it('accepts only Wikimedia Commons files', () => {
    expect(isCommonsUpload('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Oryza_sativa.jpg/320px-Oryza_sativa.jpg')).toBe(true);
    // Stored on English Wikipedia itself: may be a copyrighted "fair use" image.
    expect(isCommonsUpload('https://upload.wikimedia.org/wikipedia/en/a/ab/Some_logo.png')).toBe(false);
    expect(isCommonsUpload('https://example.com/wikipedia/commons/x.jpg')).toBe(false);
  });

  it('turns Commons metadata HTML into plain text', () => {
    expect(plainText('<a href="//commons.wikimedia.org/wiki/User:Jo">Jo &amp; Sam</a>\n')).toBe('Jo & Sam');
    expect(plainText('<span>Forest &quot;Kim&quot; Starr</span>')).toBe('Forest "Kim" Starr');
  });

  it('reads the photographer and licence of a file', async () => {
    let asked = '';
    const get = (async (url: string) => {
      asked = url;
      return {
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '123': {
                imageinfo: [{ extmetadata: { Artist: { value: '<a href="x">IRRI Images</a>' }, LicenseShortName: { value: 'CC BY 2.0' } } }],
              },
            },
          },
        }),
      };
    }) as unknown as typeof fetch;
    const credit = await loadPhotoCredit('https://commons.wikimedia.org/wiki/File:Rice%20field.jpg', get);
    expect(credit).toEqual({ artist: 'IRRI Images', licence: 'CC BY 2.0' });
    expect(decodeURIComponent(asked)).toContain('titles=File:Rice field.jpg');
  });

  it('gives nothing when Commons has no metadata', async () => {
    const get = (async () => ({ ok: true, json: async () => ({ query: { pages: { '-1': {} } } }) })) as unknown as typeof fetch;
    expect(await loadPhotoCredit('https://commons.wikimedia.org/wiki/File:Missing.jpg', get)).toBeNull();
  });
});
