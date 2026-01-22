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

describe('MeetingImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
