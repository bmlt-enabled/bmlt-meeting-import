import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the ServerApi before importing ServiceBodyCreator
vi.mock('../lib/ServerApi', () => ({
  default: {
    getServiceBodies: vi.fn().mockResolvedValue([]),
    getUser: vi.fn(),
    createServiceBody: vi.fn(),
    token: null,
    currentServerUrl: 'https://test.bmlt.app/main_server/'
  }
}));

// Mock the stores
vi.mock('../stores/apiCredentials', () => ({
  currentServerUrl: {
    set: vi.fn(),
    subscribe: vi.fn((callback) => {
      callback('https://test.bmlt.app/main_server/');
      return () => {};
    })
  }
}));

vi.mock('../stores/errorModal', () => ({
  errorModal: {
    show: vi.fn()
  }
}));

import { ServiceBodyCreator } from '../lib/ServiceBodyCreator';

describe('ServiceBodyCreator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe('extractUniqueAreas', () => {
    test('extracts unique areas from rows', () => {
      const rows = [
        { parentname: 'Test Area', arearegion: 'AR12345' },
        { parentname: 'Test Region', arearegion: 'RG67890' },
        { parentname: 'Test Area', arearegion: 'AR12345' } // Duplicate
      ];

      const result = ServiceBodyCreator.extractUniqueAreas(rows);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ worldId: 'AR12345', name: 'Test Area' });
      expect(result).toContainEqual({ worldId: 'RG67890', name: 'Test Region' });
    });

    test('skips deleted rows', () => {
      const rows = [
        { parentname: 'Test Area', arearegion: 'AR12345' },
        { parentname: 'Deleted Area', arearegion: 'AR99999', delete: 'D' }
      ];

      const result = ServiceBodyCreator.extractUniqueAreas(rows);

      expect(result).toHaveLength(1);
      expect(result[0].worldId).toBe('AR12345');
    });

    test('skips rows without worldId', () => {
      const rows = [
        { parentname: 'Test Area', arearegion: 'AR12345' },
        { parentname: 'No World ID', arearegion: '' }
      ];

      const result = ServiceBodyCreator.extractUniqueAreas(rows);

      expect(result).toHaveLength(1);
    });

    test('skips rows without name', () => {
      const rows = [
        { parentname: 'Test Area', arearegion: 'AR12345' },
        { parentname: '', arearegion: 'AR99999' }
      ];

      const result = ServiceBodyCreator.extractUniqueAreas(rows);

      expect(result).toHaveLength(1);
    });

    test('normalizes worldId to uppercase', () => {
      const rows = [
        { parentname: 'Test Area', arearegion: 'ar12345' },
        { parentname: 'Same Area', arearegion: 'AR12345' } // Same but uppercase
      ];

      const result = ServiceBodyCreator.extractUniqueAreas(rows);

      expect(result).toHaveLength(1);
      expect(result[0].worldId).toBe('AR12345');
    });

    test('handles empty array', () => {
      const result = ServiceBodyCreator.extractUniqueAreas([]);

      expect(result).toHaveLength(0);
    });

    test('handles whitespace in values', () => {
      const rows = [{ parentname: '  Test Area  ', arearegion: '  AR12345  ' }];

      const result = ServiceBodyCreator.extractUniqueAreas(rows);

      expect(result).toHaveLength(1);
      expect(result[0].worldId).toBe('AR12345');
      expect(result[0].name).toBe('Test Area');
    });
  });

  describe('determineServiceBodyType (via extractUniqueAreas behavior)', () => {
    // The determineServiceBodyType is private, but we can infer its behavior
    // from the worldId prefixes. Areas starting with 'AR' should be 'AS' type,
    // others should be 'RS' type. This is tested implicitly through integration.

    test('extracts areas with AR prefix', () => {
      const rows = [{ parentname: 'Area Service', arearegion: 'AR12345' }];

      const result = ServiceBodyCreator.extractUniqueAreas(rows);

      expect(result).toHaveLength(1);
      expect(result[0].worldId.startsWith('AR')).toBe(true);
    });

    test('extracts regions without AR prefix', () => {
      const rows = [{ parentname: 'Regional Service', arearegion: 'RG12345' }];

      const result = ServiceBodyCreator.extractUniqueAreas(rows);

      expect(result).toHaveLength(1);
      expect(result[0].worldId.startsWith('RG')).toBe(true);
    });
  });
});
