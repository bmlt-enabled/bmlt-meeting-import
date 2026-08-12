import { describe, test, expect } from 'vitest';
import type { Format, ServiceBody } from 'bmlt-server-client';

import type { SemanticFormat, SemanticMeeting, SemanticServiceBody } from '../lib/BmltSourceClient';
import { BmltSourceMapper, type MappingOptions } from '../lib/BmltSourceMapper';

function sourceBodies(): SemanticServiceBody[] {
  return [
    { id: '1', parent_id: '0', name: 'Montana Region', type: 'RS', world_id: '' },
    { id: '5', parent_id: '1', name: 'Area 2: Helena', type: 'AS', world_id: '' },
    { id: '6', parent_id: '5', name: 'Helena Group', type: 'GR', world_id: '' },
    { id: '7', parent_id: '1', name: 'Coded Area', type: 'AS', world_id: 'AR12345' },
    { id: '8', parent_id: '1', name: 'Unused Area', type: 'AS', world_id: '' }
  ];
}

function destinationBody(overrides: Partial<ServiceBody>): ServiceBody {
  return {
    id: 1,
    name: 'Destination',
    worldId: '',
    parentId: null,
    type: 'AS',
    adminUserId: 1,
    assignedUserIds: [1],
    description: '',
    email: '',
    helpline: '',
    url: '',
    ...overrides
  };
}

function createMeeting(overrides: Partial<SemanticMeeting> = {}): SemanticMeeting {
  return {
    id_bigint: '133',
    service_body_bigint: '5',
    weekday_tinyint: '2',
    venue_type: '1',
    start_time: '19:30:00',
    duration_time: '01:30:00',
    published: '1',
    meeting_name: 'Good Start',
    location_street: '1308 Boulder Ave',
    location_municipality: 'Helena',
    latitude: '46.59',
    longitude: '-112.01',
    ...overrides
  };
}

function mappingOptions(overrides: Partial<MappingOptions> = {}): MappingOptions {
  return {
    serviceBodyIds: new Map([['5', 42]]),
    formatIds: new Map([['3', 300]]),
    defaultLatitude: 0,
    defaultLongitude: 0,
    ...overrides
  };
}

describe('BmltSourceMapper', () => {
  describe('matchServiceBodies', () => {
    test('matches on worldId when both sides have one', () => {
      const destination = destinationBody({ id: 99, name: 'Renamed Since', worldId: 'AR12345' });

      const matches = BmltSourceMapper.matchServiceBodies(sourceBodies(), [destination], [createMeeting({ service_body_bigint: '7' })]);
      const match = matches.find((candidate) => candidate.source.id === '7');

      expect(match?.destination?.id).toBe(99);
      expect(match?.matchedBy).toBe('worldId');
    });

    test('falls back to matching on name, ignoring case and spacing', () => {
      const destination = destinationBody({ id: 77, name: 'area 2:  helena' });

      const matches = BmltSourceMapper.matchServiceBodies(sourceBodies(), [destination], [createMeeting()]);
      const match = matches.find((candidate) => candidate.source.id === '5');

      expect(match?.destination?.id).toBe(77);
      expect(match?.matchedBy).toBe('name');
    });

    test('reports no match when the destination has neither', () => {
      const matches = BmltSourceMapper.matchServiceBodies(sourceBodies(), [], [createMeeting()]);
      const match = matches.find((candidate) => candidate.source.id === '5');

      expect(match?.destination).toBeNull();
      expect(match?.matchedBy).toBeNull();
      expect(match?.meetingCount).toBe(1);
    });

    test('pulls in ancestors so the hierarchy can be rebuilt', () => {
      const matches = BmltSourceMapper.matchServiceBodies(sourceBodies(), [], [createMeeting({ service_body_bigint: '6' })]);
      const ids = matches.map((match) => match.source.id).sort();

      expect(ids).toEqual(['1', '5', '6']);
      expect(matches.find((match) => match.source.id === '6')?.ancestorOnly).toBe(false);
      expect(matches.find((match) => match.source.id === '5')?.ancestorOnly).toBe(true);
      expect(matches.find((match) => match.source.id === '1')?.ancestorOnly).toBe(true);
    });

    test('leaves out service bodies with no meetings', () => {
      const matches = BmltSourceMapper.matchServiceBodies(sourceBodies(), [], [createMeeting()]);

      expect(matches.map((match) => match.source.id)).not.toContain('8');
    });
  });

  describe('orderForCreation', () => {
    test('returns unmatched bodies with parents ahead of children', () => {
      const matches = BmltSourceMapper.matchServiceBodies(sourceBodies(), [], [createMeeting({ service_body_bigint: '6' })]);

      expect(BmltSourceMapper.orderForCreation(matches).map((match) => match.source.id)).toEqual(['1', '5', '6']);
    });

    test('leaves out bodies that already exist on the destination', () => {
      const destination = destinationBody({ id: 77, name: 'Montana Region' });
      const matches = BmltSourceMapper.matchServiceBodies(sourceBodies(), [destination], [createMeeting()]);

      expect(BmltSourceMapper.orderForCreation(matches).map((match) => match.source.id)).toEqual(['5']);
    });
  });

  describe('matchFormats', () => {
    const sourceFormats: SemanticFormat[] = [
      { id: '3', key_string: 'BT', world_id: 'BT' },
      { id: '17', key_string: 'O', world_id: 'OPEN' },
      { id: '50', key_string: 'XYZ', world_id: '' }
    ];

    const destinationFormats: Format[] = [
      { id: 300, worldId: 'BT', type: '', translations: [{ key: 'BT', name: 'Basic Text', description: '', language: 'en' }] },
      { id: 301, worldId: '', type: '', translations: [{ key: 'O', name: 'Open', description: '', language: 'en' }] }
    ];

    test('matches on worldId, then on key', () => {
      const matches = BmltSourceMapper.matchFormats(sourceFormats, destinationFormats);

      expect(matches.find((match) => match.source.id === '3')).toMatchObject({ destinationId: 300, matchedBy: 'worldId' });
      expect(matches.find((match) => match.source.id === '17')).toMatchObject({ destinationId: 301, matchedBy: 'key' });
      expect(matches.find((match) => match.source.id === '50')).toMatchObject({ destinationId: null, matchedBy: null });
    });

    test('collapses the per-language duplicates the semantic interface returns', () => {
      const duplicated = [...sourceFormats, { id: '3', key_string: 'BT', world_id: 'BT', lang: 'es' }];

      expect(BmltSourceMapper.matchFormats(duplicated, destinationFormats).filter((match) => match.source.id === '3')).toHaveLength(1);
    });

    test('recognises the formats the destination manages itself', () => {
      expect(BmltSourceMapper.isRestrictedFormat({ id: '54', key_string: 'VM', world_id: 'VM' })).toBe(true);
      expect(BmltSourceMapper.isRestrictedFormat({ id: '56', key_string: 'HY', world_id: 'HYBR' })).toBe(true);
      expect(BmltSourceMapper.isRestrictedFormat({ id: '3', key_string: 'BT', world_id: 'BT' })).toBe(false);
    });
  });

  describe('mapMeeting', () => {
    test('keeps the fields the NAWS spreadsheet drops', () => {
      const meeting = createMeeting({
        comments: '1st Saturday is a potluck',
        contact_name_1: 'Pat',
        contact_email_1: 'pat@example.org',
        bus_lines: 'Route 5',
        train_lines: 'Blue Line',
        location_info: 'Use alley entrance',
        email_contact: 'group@example.org',
        time_zone: 'America/Denver'
      });

      const result = BmltSourceMapper.mapMeeting(meeting, mappingOptions(), 'Good Start');

      expect(result.errors).toEqual([]);
      expect(result.meeting).toMatchObject({
        serviceBodyId: 42,
        duration: '01:30',
        published: true,
        comments: '1st Saturday is a potluck',
        contactName1: 'Pat',
        contactEmail1: 'pat@example.org',
        busLines: 'Route 5',
        trainLines: 'Blue Line',
        locationInfo: 'Use alley entrance',
        email: 'group@example.org',
        timeZone: 'America/Denver'
      });
    });

    test('shifts the semantic weekday onto the API weekday', () => {
      expect(BmltSourceMapper.mapMeeting(createMeeting({ weekday_tinyint: '1' }), mappingOptions(), 'x').meeting?.day).toBe(0);
      expect(BmltSourceMapper.mapMeeting(createMeeting({ weekday_tinyint: '7' }), mappingOptions(), 'x').meeting?.day).toBe(6);
    });

    test('carries the venue type across rather than guessing it', () => {
      const virtual = createMeeting({
        venue_type: '2',
        location_street: '',
        virtual_meeting_additional_info: 'Zoom ID: 878 7947 7097'
      });

      const result = BmltSourceMapper.mapMeeting(virtual, mappingOptions(), 'x');

      expect(result.meeting?.venueType).toBe(2);
      expect(result.warnings).toHaveLength(1);
    });

    test('downgrades a hybrid with no street address so the server accepts it', () => {
      const result = BmltSourceMapper.mapMeeting(createMeeting({ venue_type: '3', location_street: '' }), mappingOptions(), 'Good Start');

      expect(result.meeting?.venueType).toBe(2);
      expect(result.warnings[0]).toContain('importing as virtual');
    });

    test('keeps unpublished meetings unpublished', () => {
      expect(BmltSourceMapper.mapMeeting(createMeeting({ published: '0' }), mappingOptions(), 'x').meeting?.published).toBe(false);
    });

    test('honours forceUnpublished', () => {
      const options = mappingOptions({ forceUnpublished: true });

      expect(BmltSourceMapper.mapMeeting(createMeeting(), options, 'x').meeting?.published).toBe(false);
    });

    test('translates format ids and drops ones with no destination', () => {
      const meeting = createMeeting({ format_shared_id_list: '3,54' });

      expect(BmltSourceMapper.mapMeeting(meeting, mappingOptions(), 'x').meeting?.formatIds).toEqual([300]);
    });

    test('falls back to the default time zone', () => {
      const options = mappingOptions({ defaultTimeZone: 'America/Denver' });

      expect(BmltSourceMapper.mapMeeting(createMeeting({ time_zone: '' }), options, 'x').meeting?.timeZone).toBe('America/Denver');
    });

    test('reports rows it cannot map', () => {
      expect(BmltSourceMapper.mapMeeting(createMeeting({ meeting_name: '' }), mappingOptions(), 'x').errors[0]).toContain('no name');
      expect(BmltSourceMapper.mapMeeting(createMeeting({ service_body_bigint: '999' }), mappingOptions(), 'x').errors[0]).toContain('No destination service body');
      expect(BmltSourceMapper.mapMeeting(createMeeting({ weekday_tinyint: '9' }), mappingOptions(), 'x').errors[0]).toContain('Invalid weekday');
      expect(BmltSourceMapper.mapMeeting(createMeeting({ start_time: '' }), mappingOptions(), 'x').errors[0]).toContain('Invalid start time');
    });
  });
});
