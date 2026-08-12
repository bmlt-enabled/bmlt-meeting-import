import { describe, test, expect, vi, afterEach } from 'vitest';
import { BmltSourceClient } from '../lib/BmltSourceClient';

const ROOT = 'https://bmlt.example.org/main_server/';

function mockJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BmltSourceClient', () => {
  describe('normalizeRootUrl', () => {
    test('leaves a well formed root url alone', () => {
      expect(BmltSourceClient.normalizeRootUrl(ROOT)).toBe(ROOT);
    });

    test('adds the scheme and trailing slash', () => {
      expect(BmltSourceClient.normalizeRootUrl('bmlt.example.org/main_server')).toBe(ROOT);
    });

    test('strips a pasted semantic query', () => {
      expect(BmltSourceClient.normalizeRootUrl('https://bmlt.example.org/main_server/client_interface/json/?switcher=GetSearchResults')).toBe(ROOT);
    });

    test('rejects an empty url', () => {
      expect(() => BmltSourceClient.normalizeRootUrl('   ')).toThrow('root server URL is required');
    });
  });

  describe('buildUrl', () => {
    test('builds a semantic url with the given parameters', () => {
      expect(BmltSourceClient.buildUrl(ROOT, { switcher: 'GetSearchResults', services: '5,6' })).toBe(
        'https://bmlt.example.org/main_server/client_interface/json/?switcher=GetSearchResults&services=5%2C6'
      );
    });
  });

  describe('getMeetings', () => {
    test('sends the service body, recursion and published filters', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockJson([]));
      vi.stubGlobal('fetch', fetchMock);

      await BmltSourceClient.getMeetings(ROOT, { serviceBodyIds: ['5', '6'], recursive: true, includeUnpublished: true });

      const url = new URL(fetchMock.mock.calls[0][0]);
      expect(url.searchParams.get('switcher')).toBe('GetSearchResults');
      expect(url.searchParams.get('services')).toBe('5,6');
      expect(url.searchParams.get('recursive')).toBe('1');
      expect(url.searchParams.get('advanced_published')).toBe('0');
    });

    test('omits the filters when none are asked for', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockJson([]));
      vi.stubGlobal('fetch', fetchMock);

      await BmltSourceClient.getMeetings(ROOT);

      const url = new URL(fetchMock.mock.calls[0][0]);
      expect(url.searchParams.has('services')).toBe(false);
      expect(url.searchParams.has('advanced_published')).toBe(false);
    });

    test('treats a non-array response as no meetings', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockJson({ error: 'nope' })));

      expect(await BmltSourceClient.getMeetings(ROOT)).toEqual([]);
    });
  });

  describe('error handling', () => {
    test('explains an unreachable server', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      await expect(BmltSourceClient.getServiceBodies(ROOT)).rejects.toThrow('Could not reach');
    });

    test('reports an http error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 } as Response));

      await expect(BmltSourceClient.getServiceBodies(ROOT)).rejects.toThrow('HTTP 422');
    });

    test('reports a response that is not json', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('Unexpected token <');
          }
        } as unknown as Response)
      );

      await expect(BmltSourceClient.getFormats(ROOT)).rejects.toThrow('did not return JSON');
    });

    test('passes an abort through untouched', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));

      await expect(BmltSourceClient.getFormats(ROOT)).rejects.toThrow(DOMException);
    });
  });

  describe('fetchSource', () => {
    test('reads meetings, service bodies and formats together', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('GetSearchResults')) return Promise.resolve(mockJson([{ id_bigint: '1' }]));
        if (url.includes('GetServiceBodies')) return Promise.resolve(mockJson([{ id: '5' }]));
        return Promise.resolve(mockJson([{ id: '3' }]));
      });
      vi.stubGlobal('fetch', fetchMock);

      const source = await BmltSourceClient.fetchSource('bmlt.example.org/main_server');

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(source.rootUrl).toBe(ROOT);
      expect(source.meetings).toHaveLength(1);
      expect(source.serviceBodies).toHaveLength(1);
      expect(source.formats).toHaveLength(1);
    });
  });
});
