import { describe, test, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { Format, ServiceBody } from 'bmlt-server-client';

import type { BmltSource, SemanticMeeting } from '../lib/BmltSourceClient';
import { exportToNAWSRows, toDuration, toMilitaryTime, generateWorldId, NAWS_EXPORT_COLUMNS } from '../lib/NAWSExporter';
import { SpreadsheetProcessor } from '../lib/SpreadsheetProcessor';
import { NAWSMapper } from '../lib/NAWSMapper';

function createMeeting(overrides: Partial<SemanticMeeting> = {}): SemanticMeeting {
  return {
    id_bigint: '1',
    service_body_bigint: '5',
    service_body_name: 'Test Area',
    weekday_tinyint: '2',
    venue_type: '1',
    start_time: '19:30:00',
    duration_time: '01:00:00',
    published: '1',
    meeting_name: 'Test Meeting',
    location_street: '123 Main St',
    location_municipality: 'Helena',
    location_province: 'MT',
    location_postal_code_1: '59601',
    longitude: '-112.0179197',
    latitude: '46.5974062',
    ...overrides
  };
}

function createSource(meetings: SemanticMeeting[]): BmltSource {
  return {
    rootUrl: 'https://bmlt.example.org/main_server/',
    meetings,
    serviceBodies: [
      { id: '1', parent_id: '0', name: 'Test Region', type: 'RS', world_id: '' },
      { id: '5', parent_id: '1', name: 'Test Area', type: 'AS', world_id: '' },
      { id: '6', parent_id: '1', name: 'Coded Area', type: 'AS', world_id: 'AR12345' }
    ],
    formats: [
      { id: '3', key_string: 'BT', world_id: 'BT' },
      { id: '4', key_string: 'C', world_id: 'CLOSED' },
      { id: '17', key_string: 'O', world_id: 'OPEN' },
      { id: '33', key_string: 'WC', world_id: 'WCHR' },
      { id: '54', key_string: 'VM', world_id: 'VM' },
      { id: '56', key_string: 'HY', world_id: 'HYBR' },
      { id: '99', key_string: 'LOCAL', world_id: '' }
    ]
  };
}

function column(result: { columns: string[]; rows: string[][] }, row: number, name: string): string {
  return result.rows[row][result.columns.indexOf(name)];
}

describe('NAWSExporter', () => {
  describe('field conversion', () => {
    test('converts times to military format', () => {
      expect(toMilitaryTime('19:30:00')).toBe('1930');
      expect(toMilitaryTime('06:45:00')).toBe('0645');
      expect(toMilitaryTime('')).toBe('');
    });

    test('converts durations to HH:MM', () => {
      expect(toDuration('01:00:00')).toBe('01:00');
      expect(toDuration('01:30:00')).toBe('01:30');
      expect(toDuration('')).toBe('');
    });

    test('generates area worldIds for areas and region worldIds for everything else', () => {
      expect(generateWorldId({ id: '5', type: 'AS' }, 'SB')).toBe('ARSB5');
      expect(generateWorldId({ id: '1', type: 'RS' }, 'SB')).toBe('RGSB1');
    });
  });

  describe('exportToNAWSRows', () => {
    test('maps a meeting onto the NAWS columns', () => {
      const result = exportToNAWSRows(createSource([createMeeting()]));

      expect(result.columns).toEqual(NAWS_EXPORT_COLUMNS);
      expect(result.rows).toHaveLength(1);
      expect(column(result, 0, 'CommitteeName')).toBe('Test Meeting');
      expect(column(result, 0, 'Day')).toBe('Monday');
      expect(column(result, 0, 'Time')).toBe('1930');
      expect(column(result, 0, 'Duration')).toBe('01:00');
      expect(column(result, 0, 'Address')).toBe('123 Main St');
      expect(column(result, 0, 'VenueType')).toBe('In-Person');
      expect(column(result, 0, 'Published')).toBe('TRUE');
    });

    test('generates a worldId for service bodies that have none', () => {
      const result = exportToNAWSRows(createSource([createMeeting()]));

      expect(column(result, 0, 'AreaRegion')).toBe('ARSB5');
      expect(column(result, 0, 'ParentName')).toBe('Test Area');
      expect(result.generatedWorldIds).toEqual([{ serviceBodyId: '5', worldId: 'ARSB5', name: 'Test Area' }]);
    });

    test('keeps the source worldId when the service body has one', () => {
      const result = exportToNAWSRows(createSource([createMeeting({ service_body_bigint: '6', service_body_name: 'Coded Area' })]));

      expect(column(result, 0, 'AreaRegion')).toBe('AR12345');
      expect(result.generatedWorldIds).toHaveLength(0);
    });

    test('splits formats into Closed, WheelChr and Format columns', () => {
      const result = exportToNAWSRows(createSource([createMeeting({ format_shared_id_list: '17,33,3' })]));

      expect(column(result, 0, 'Closed')).toBe('OPEN');
      expect(column(result, 0, 'WheelChr')).toBe('TRUE');
      expect(column(result, 0, 'Format1')).toBe('BT');
      expect(column(result, 0, 'Format2')).toBe('');
    });

    test('omits server-managed venue formats', () => {
      const result = exportToNAWSRows(createSource([createMeeting({ format_shared_id_list: '54,56,3' })]));

      expect(column(result, 0, 'Format1')).toBe('BT');
      expect(column(result, 0, 'Format2')).toBe('');
    });

    test('reports formats that cannot survive the round trip', () => {
      const result = exportToNAWSRows(createSource([createMeeting({ format_shared_id_list: '99,404' })]));

      expect(result.formatsWithoutWorldId).toContain('LOCAL');
      expect(result.unknownFormatIds).toContain('404');
    });

    test('applies the default time zone only where the source has none', () => {
      const source = createSource([createMeeting({ time_zone: 'America/New_York' }), createMeeting({ id_bigint: '2', time_zone: '' })]);

      const withDefault = exportToNAWSRows(source, { defaultTimeZone: 'America/Denver' });
      expect(withDefault.rows.map((row) => row[withDefault.columns.indexOf('TimeZone')])).toEqual(['America/New_York', 'America/Denver']);
      expect(withDefault.meetingsWithoutTimeZone).toBe(0);

      const withoutDefault = exportToNAWSRows(source);
      expect(withoutDefault.meetingsWithoutTimeZone).toBe(1);
    });

    test('marks unpublished meetings', () => {
      const result = exportToNAWSRows(createSource([createMeeting({ published: '0' })]));

      expect(column(result, 0, 'Published')).toBe('FALSE');
      expect(result.unpublishedCount).toBe(1);
    });
  });

  describe('round trip through the importer', () => {
    async function importRows(meetings: SemanticMeeting[]) {
      const result = exportToNAWSRows(createSource(meetings), { defaultTimeZone: 'America/Denver' });
      const sheet = XLSX.utils.aoa_to_sheet([result.columns, ...result.rows]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Meetings');
      const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

      const file = new File([buffer], 'export.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const processed = await SpreadsheetProcessor.processFile(file);

      const serviceBodies: ServiceBody[] = [
        { id: 10, name: 'Test Area', worldId: 'ARSB5', parentId: null, type: 'AS', adminUserId: 1, assignedUserIds: [1], description: '', email: '', helpline: '', url: '' }
      ];
      const formats: Format[] = [
        { id: 1, worldId: 'OPEN', type: '', translations: [{ key: 'O', name: 'Open', description: '', language: 'en' }] },
        { id: 2, worldId: 'BT', type: '', translations: [{ key: 'BT', name: 'Basic Text', description: '', language: 'en' }] }
      ];

      const mapper = new NAWSMapper({
        serviceBodies,
        formats,
        defaultDuration: '01:00',
        defaultLatitude: 0,
        defaultLongitude: 0,
        defaultPublished: true
      });

      return {
        processed,
        meetings: processed.rows.map((row, index) => mapper.mapNAWSRowToMeeting(row, index + 2))
      };
    }

    test('produces a spreadsheet the processor accepts', async () => {
      const { processed } = await importRows([createMeeting()]);

      expect(processed.errors).toEqual([]);
      expect(processed.validRows).toBe(1);
    });

    test('carries duration, venue type and published through to the meeting', async () => {
      const { meetings } = await importRows([
        createMeeting({ duration_time: '01:30:00', published: '0' }),
        createMeeting({
          id_bigint: '2',
          venue_type: '3',
          virtual_meeting_additional_info: 'Zoom ID: 878 7947 7097',
          start_time: '20:00:00'
        }),
        createMeeting({
          id_bigint: '3',
          venue_type: '2',
          location_street: '',
          virtual_meeting_additional_info: 'Zoom ID: 917 8728 2261',
          start_time: '21:00:00'
        })
      ]);

      const created = meetings.map((result) => result.meeting);
      expect(created.every((meeting) => meeting !== null)).toBe(true);

      expect(created[0]?.duration).toBe('01:30');
      expect(created[0]?.published).toBe(false);
      expect(created[0]?.venueType).toBe(1);

      // Hybrid and virtual survive even though neither row has a link or phone
      expect(created[1]?.venueType).toBe(3);
      expect(created[2]?.venueType).toBe(2);
    });

    test('maps exported format codes back to destination format ids', async () => {
      const { meetings } = await importRows([createMeeting({ format_shared_id_list: '17,3' })]);

      expect(meetings[0].meeting?.formatIds).toEqual([1, 2]);
    });
  });
});
