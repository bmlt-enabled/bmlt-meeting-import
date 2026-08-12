import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the ServerApi before importing MeetingImportService
vi.mock('../lib/ServerApi', () => ({
  default: {
    getServiceBodies: vi.fn().mockResolvedValue([]),
    getFormats: vi.fn().mockResolvedValue([]),
    getMeetings: vi.fn().mockResolvedValue([]),
    createMeeting: vi.fn(),
    getUser: vi.fn(),
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

import { MeetingImportService } from '../lib/MeetingImportService';
import { BmltSourceClient, type BmltSource } from '../lib/BmltSourceClient';
import RootServerApi from '../lib/ServerApi';

function createSource(): BmltSource {
  return {
    rootUrl: 'https://source.example.org/main_server/',
    meetings: [
      {
        id_bigint: '1',
        service_body_bigint: '5',
        weekday_tinyint: '2',
        venue_type: '1',
        start_time: '19:30:00',
        duration_time: '01:30:00',
        published: '1',
        meeting_name: 'Good Start',
        location_street: '123 Main St',
        format_shared_id_list: '3,54,99'
      }
    ],
    serviceBodies: [
      { id: '1', parent_id: '0', name: 'Source Region', type: 'RS', world_id: '' },
      { id: '5', parent_id: '1', name: 'Source Area', type: 'AS', world_id: '' }
    ],
    formats: [
      { id: '3', key_string: 'BT', world_id: 'BT' },
      { id: '54', key_string: 'VM', world_id: 'VM' },
      { id: '99', key_string: 'LOCAL', world_id: '' }
    ]
  };
}

describe('MeetingImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('previewBmltSource', () => {
    test('matches service bodies and reports what will be created', async () => {
      vi.spyOn(BmltSourceClient, 'fetchSource').mockResolvedValue(createSource());
      vi.mocked(RootServerApi.getServiceBodies).mockResolvedValue([
        { id: 70, name: 'Source Region', worldId: '', parentId: null, type: 'RS', adminUserId: 1, assignedUserIds: [1], description: '', email: '', helpline: '', url: '' }
      ]);
      vi.mocked(RootServerApi.getFormats).mockResolvedValue([{ id: 300, worldId: 'BT', type: '', translations: [{ key: 'BT', name: 'Basic Text', description: '', language: 'en' }] }]);

      const preview = await MeetingImportService.previewBmltSource('https://source.example.org/main_server/');

      expect(preview.meetingCount).toBe(1);

      const region = preview.serviceBodyMatches.find((match) => match.source.id === '1');
      expect(region?.destination?.id).toBe(70);
      expect(region?.ancestorOnly).toBe(true);

      const area = preview.serviceBodyMatches.find((match) => match.source.id === '5');
      expect(area?.destination).toBeNull();
      expect(area?.meetingCount).toBe(1);

      // VM is server-managed so it is not reported as missing; LOCAL is
      expect(preview.unmatchedFormats.map((match) => match.source.key_string)).toEqual(['LOCAL']);
      expect(preview.warnings.some((warning) => warning.includes('Source Area'))).toBe(true);
    });

    test('refuses a source with no meetings', async () => {
      vi.spyOn(BmltSourceClient, 'fetchSource').mockResolvedValue({ ...createSource(), meetings: [] });

      await expect(MeetingImportService.previewBmltSource('https://source.example.org/main_server/')).rejects.toThrow('no meetings');
    });
  });

  describe('getSupportedFileTypes', () => {
    test('returns supported file types', () => {
      const types = MeetingImportService.getSupportedFileTypes();

      expect(types).toContain('.xlsx');
      expect(types).toContain('.xls');
      expect(types).toContain('.csv');
      expect(types).toContain('.ods');
    });

    test('returns array of strings', () => {
      const types = MeetingImportService.getSupportedFileTypes();

      expect(Array.isArray(types)).toBe(true);
      types.forEach((type) => {
        expect(typeof type).toBe('string');
        expect(type.startsWith('.')).toBe(true);
      });
    });
  });

  describe('getMaxFileSize', () => {
    test('returns a positive number', () => {
      const maxSize = MeetingImportService.getMaxFileSize();

      expect(typeof maxSize).toBe('number');
      expect(maxSize).toBeGreaterThan(0);
    });

    test('returns 10MB in bytes', () => {
      const maxSize = MeetingImportService.getMaxFileSize();

      expect(maxSize).toBe(10 * 1024 * 1024);
    });
  });
});
