import { commonsFilePage, fileTitle, isCommonsUpload, loadPhotoCredits, plainText, shortCredit } from '../photoCredit';

const rice = 'https://commons.wikimedia.org/wiki/File:Rice%20field.jpg';
const maize = 'https://commons.wikimedia.org/wiki/File:maize_cob.jpg';
const missing = 'https://commons.wikimedia.org/wiki/File:Missing.jpg';

describe('crop photo licences', () => {
  it('accepts only Wikimedia Commons files', () => {
    expect(isCommonsUpload('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Oryza_sativa.jpg/320px-Oryza_sativa.jpg')).toBe(true);
    // Stored on English Wikipedia itself: may be a copyrighted "fair use" image.
    expect(isCommonsUpload('https://upload.wikimedia.org/wikipedia/en/a/ab/Some_logo.png')).toBe(false);
    // Thumbnails from Wikipedia's summary API come from another wikimedia.org host.
    expect(isCommonsUpload('https://thumbs.wikimedia.org/wikipedia/commons/thumb/a/ab/Oryza_sativa.jpg/320px-Oryza_sativa.jpg?utm_source=x')).toBe(true);
    expect(isCommonsUpload('https://example.com/wikipedia/commons/x.jpg')).toBe(false);
    expect(isCommonsUpload('https://wikimedia.org.example.com/wikipedia/commons/x.jpg')).toBe(false);
    expect(isCommonsUpload('not a url')).toBe(false);
  });

  it('turns Commons metadata HTML into plain text', () => {
    expect(plainText('<a href="//commons.wikimedia.org/wiki/User:Jo">Jo &amp; Sam</a>\n')).toBe('Jo & Sam');
    expect(plainText('<span>Forest &quot;Kim&quot; Starr</span>')).toBe('Forest "Kim" Starr');
    expect(fileTitle(maize)).toBe('File:maize cob.jpg');
  });

  it('reads photographers and licences for many files in one request', async () => {
    const asked: string[] = [];
    const get = (async (url: string) => {
      asked.push(url);
      return {
        ok: true,
        json: async () => ({
          query: {
            // Commons capitalises the first letter of a file name.
            normalized: [{ from: 'File:maize cob.jpg', to: 'File:Maize cob.jpg' }],
            pages: {
              '1': {
                title: 'File:Rice field.jpg',
                imageinfo: [
                  {
                    extmetadata: {
                      Artist: { value: '<a href="x">IRRI Images</a>' },
                      LicenseShortName: { value: 'CC BY 2.0' },
                      LicenseUrl: { value: 'http://creativecommons.org/licenses/by/2.0' },
                    },
                  },
                ],
              },
              '2': { title: 'File:Maize cob.jpg', imageinfo: [{ extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
              '-1': { title: 'File:Missing.jpg' },
            },
          },
        }),
      };
    }) as unknown as typeof fetch;
    const credits = await loadPhotoCredits([rice, maize, missing], get);
    expect(asked).toHaveLength(1);
    expect(credits.get(rice)).toEqual({ artist: 'IRRI Images', licence: 'CC BY 2.0', licenceUrl: 'https://creativecommons.org/licenses/by/2.0' });
    expect(credits.get(maize)).toEqual({ artist: null, licence: 'Public domain', licenceUrl: null });
    expect(credits.get(missing)).toBeNull();
    expect(shortCredit(credits.get(rice)!)).toBe('IRRI Images, CC BY 2.0');
    expect(shortCredit(credits.get(maize)!)).toBe('Public domain');
  });

  it('links to the real Commons page even when the photo address has tracking text', () => {
    // Wikipedia's summary API adds ?utm_… to photo addresses; it must not end up in the file name.
    expect(commonsFilePage('https://upload.wikimedia.org/wikipedia/commons/9/9a/Rice%20field%20(1).jpg?utm_source=en.wikipedia.org&utm_campaign=x')).toBe(
      'https://commons.wikimedia.org/wiki/File:Rice_field_(1).jpg',
    );
    expect(commonsFilePage('https://thumbs.wikimedia.org/wikipedia/commons/a/ab/Mango.jpg')).toBe('https://commons.wikimedia.org/wiki/File:Mango.jpg');
    expect(commonsFilePage('not a url')).toBeNull();
  });
});
