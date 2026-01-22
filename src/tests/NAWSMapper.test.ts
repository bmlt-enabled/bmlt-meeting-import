import { describe, test, expect } from 'vitest';
import { NAWSMapper, type MappingOptions } from '../lib/NAWSMapper';
import type { NAWSRow } from '../lib/SpreadsheetProcessor';
import type { ServiceBody, Format } from 'bmlt-server-client';

function createMockServiceBodies(): ServiceBody[] {
  return [
    { id: 1, name: 'Test Area', worldId: 'AR12345', parentId: null, type: 'AS', adminUserId: 1, assignedUserIds: [1], description: '', email: '', helpline: '', url: '' },
    { id: 2, name: 'Test Region', worldId: 'RG67890', parentId: null, type: 'RS', adminUserId: 1, assignedUserIds: [1], description: '', email: '', helpline: '', url: '' }
  ];
}

function createMockFormats(): Format[] {
  return [
    { id: 1, worldId: 'O', type: '', translations: [{ key: 'O', name: 'Open', description: 'Open to non-addicts', language: 'en' }] },
    { id: 2, worldId: 'C', type: '', translations: [{ key: 'C', name: 'Closed', description: 'Closed meeting', language: 'en' }] },
    { id: 3, worldId: 'WCHR', type: '', translations: [{ key: 'WCHR', name: 'Wheelchair', description: 'Wheelchair accessible', language: 'en' }] },
    { id: 4, worldId: 'VM', type: '', translations: [{ key: 'VM', name: 'Virtual', description: 'Virtual meeting', language: 'en' }] }
  ];
}

function createDefaultOptions(): MappingOptions {
  return {
    serviceBodies: createMockServiceBodies(),
    formats: createMockFormats(),
    defaultDuration: '01:00',
    defaultLatitude: 40.7128,
    defaultLongitude: -74.006,
    defaultPublished: true
  };
}

function createValidNAWSRow(overrides: Partial<NAWSRow> = {}): NAWSRow {
  return {
    committeename: 'Test Meeting',
    arearegion: 'AR12345',
    day: 'Monday',
    time: '1930',
    committee: 'TST001',
    place: 'Test Location',
    address: '123 Main St',
    city: 'Test City',
    state: 'TS',
    zip: '12345',
    country: 'US',
    ...overrides
  };
}

describe('NAWSMapper', () => {
  describe('mapNAWSRowToMeeting', () => {
    test('successfully maps a valid NAWS row', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow();

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).not.toBeNull();
      expect(result.errors).toHaveLength(0);
      expect(result.meeting?.name).toBe('Test Meeting');
      expect(result.meeting?.serviceBodyId).toBe(1);
      expect(result.meeting?.day).toBe(1); // Monday
      expect(result.meeting?.startTime).toBe('19:30');
      expect(result.meeting?.worldId).toBe('TST001');
    });

    test('skips deleted meetings', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ delete: 'D' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    test('skips deleted meetings (lowercase)', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ delete: 'd' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    test('returns error for missing meeting name', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ committeename: '' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).toBeNull();
      expect(result.errors).toContain('Row 2: Missing meeting name (committeename)');
    });

    test('returns error for missing area/region', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ arearegion: '' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).toBeNull();
      expect(result.errors).toContain('Row 2: Missing area/region (arearegion)');
    });

    test('returns error for missing day', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ day: '' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).toBeNull();
      expect(result.errors).toContain('Row 2: Missing day');
    });

    test('returns error for missing time', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ time: '' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).toBeNull();
      expect(result.errors).toContain('Row 2: Missing time');
    });

    test('returns error for unknown service body', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ arearegion: 'UNKNOWN123' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).toBeNull();
      expect(result.errors[0]).toContain('Service body not found');
    });

    test('maps formats correctly', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        closed: 'C',
        format1: 'O'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).not.toBeNull();
      expect(result.meeting?.formatIds).toContain(1); // Open
      expect(result.meeting?.formatIds).toContain(2); // Closed
    });

    test('maps wheelchair format correctly', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ wheelchr: 'true' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).not.toBeNull();
      expect(result.meeting?.formatIds).toContain(3); // WCHR
    });

    test('maps wheelchair format with value 1', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ wheelchr: '1' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).not.toBeNull();
      expect(result.meeting?.formatIds).toContain(3); // WCHR
    });

    test('warns about missing formats', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({ format1: 'UNKNOWN' });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting).not.toBeNull();
      expect(result.warnings).toContainEqual(expect.stringContaining("Format 'UNKNOWN' not found"));
    });
  });

  describe('venue type detection', () => {
    test('detects in-person venue when only physical location', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        address: '123 Main St',
        city: 'Test City'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.venueType).toBe(1); // VENUE_TYPE_IN_PERSON
    });

    test('detects virtual venue when only virtual info', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        address: '',
        city: '',
        virtualmeetinglink: 'https://zoom.us/j/123456'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.venueType).toBe(2); // VENUE_TYPE_VIRTUAL
    });

    test('detects virtual venue with phone meeting number', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        address: '',
        city: '',
        phonemeetingnumber: '+1-555-123-4567'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.venueType).toBe(2); // VENUE_TYPE_VIRTUAL
    });

    test('detects hybrid venue when both physical and virtual', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        address: '123 Main St',
        city: 'Test City',
        virtualmeetinglink: 'https://zoom.us/j/123456'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.venueType).toBe(3); // VENUE_TYPE_HYBRID
    });
  });

  describe('coordinate parsing', () => {
    test('uses provided coordinates', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        latitude: '35.6762',
        longitude: '139.6503'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.latitude).toBe(35.6762);
      expect(result.meeting?.longitude).toBe(139.6503);
    });

    test('uses default coordinates when not provided', () => {
      const options = createDefaultOptions();
      const mapper = new NAWSMapper(options);
      const nawsRow = createValidNAWSRow({
        latitude: '',
        longitude: ''
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.latitude).toBe(options.defaultLatitude);
      expect(result.meeting?.longitude).toBe(options.defaultLongitude);
    });

    test('uses default for invalid coordinates', () => {
      const options = createDefaultOptions();
      const mapper = new NAWSMapper(options);
      const nawsRow = createValidNAWSRow({
        latitude: 'invalid',
        longitude: 'notanumber'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.latitude).toBe(options.defaultLatitude);
      expect(result.meeting?.longitude).toBe(options.defaultLongitude);
    });
  });

  describe('location info building', () => {
    test('combines room and directions', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        room: 'Room 101',
        directions: 'Enter through back door'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.locationInfo).toBe('Room 101, Enter through back door');
    });

    test('handles room only', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        room: 'Room 101',
        directions: ''
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.locationInfo).toBe('Room 101');
    });

    test('handles directions only', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRow = createValidNAWSRow({
        room: '',
        directions: 'Enter through back door'
      });

      const result = mapper.mapNAWSRowToMeeting(nawsRow, 2);

      expect(result.meeting?.locationInfo).toBe('Enter through back door');
    });
  });

  describe('mapAllRows', () => {
    test('processes multiple rows and returns stats', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRows: NAWSRow[] = [
        createValidNAWSRow(),
        createValidNAWSRow({ committeename: 'Second Meeting', committee: 'TST002' }),
        createValidNAWSRow({ committeename: '' }) // Invalid
      ];

      const stats = mapper.mapAllRows(nawsRows);

      expect(stats.totalProcessed).toBe(3);
      expect(stats.successfullyMapped).toBe(2);
      expect(stats.errors.length).toBeGreaterThan(0);
    });

    test('skips deleted rows', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRows: NAWSRow[] = [createValidNAWSRow(), createValidNAWSRow({ delete: 'D' })];

      const stats = mapper.mapAllRows(nawsRows);

      expect(stats.totalProcessed).toBe(2);
      expect(stats.successfullyMapped).toBe(1);
    });
  });

  describe('validateServiceBodiesExist', () => {
    test('finds missing service bodies', async () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRows: NAWSRow[] = [createValidNAWSRow({ arearegion: 'AR12345' }), createValidNAWSRow({ arearegion: 'MISSING123' })];

      const missing = await mapper.validateServiceBodiesExist(nawsRows);

      expect(missing).toContain('MISSING123');
      expect(missing).not.toContain('AR12345');
    });

    test('skips deleted rows when validating', async () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRows: NAWSRow[] = [createValidNAWSRow({ arearegion: 'MISSING123', delete: 'D' })];

      const missing = await mapper.validateServiceBodiesExist(nawsRows);

      expect(missing).not.toContain('MISSING123');
    });
  });

  describe('getFormatStats', () => {
    test('identifies found and missing formats', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRows: NAWSRow[] = [createValidNAWSRow({ format1: 'O', format2: 'MISSING' }), createValidNAWSRow({ wheelchr: 'true' })];

      const stats = mapper.getFormatStats(nawsRows);

      expect(stats.found).toContain('O');
      expect(stats.found).toContain('WCHR');
      expect(stats.missing).toContain('MISSING');
    });

    test('skips deleted rows', () => {
      const mapper = new NAWSMapper(createDefaultOptions());
      const nawsRows: NAWSRow[] = [createValidNAWSRow({ format1: 'MISSING', delete: 'D' })];

      const stats = mapper.getFormatStats(nawsRows);

      expect(stats.missing).not.toContain('MISSING');
    });
  });
});
