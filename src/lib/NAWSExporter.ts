import type { BmltSource, SemanticFormat, SemanticMeeting, SemanticServiceBody } from './BmltSourceClient';

/**
 * Turns a BMLT source server's meetings into the NAWS-style rows this tool
 * imports, plus the optional Duration / VenueType / Published columns.
 *
 * Service bodies with no worldId on the source get a generated one so the
 * importer can create them; every generated id is reported so it can be
 * reviewed (or replaced) before the import runs.
 */

export const NAWS_EXPORT_COLUMNS = [
  'Committee',
  'CommitteeName',
  'AreaRegion',
  'ParentName',
  'Day',
  'Time',
  'Duration',
  'Place',
  'Address',
  'City',
  'LocBorough',
  'State',
  'Zip',
  'Country',
  'Directions',
  'Room',
  'Closed',
  'WheelChr',
  'Format1',
  'Format2',
  'Format3',
  'Format4',
  'Format5',
  'Longitude',
  'Latitude',
  'PhoneMeetingNumber',
  'VirtualMeetingLink',
  'VirtualMeetingInfo',
  'TimeZone',
  'VenueType',
  'Published',
  'Delete'
];

const DAYS = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const VENUE_TYPES: { [key: string]: string } = { '1': 'In-Person', '2': 'Virtual', '3': 'Hybrid' };

// Auto-managed by the destination server based on venue type
const RESTRICTED_FORMATS = new Set(['TC', 'VM', 'HY', 'HYBR']);
const OPEN_CLOSED = new Set(['OPEN', 'CLOSED']);

// The importer treats AR* worldIds as Areas and everything else as Regions
const AREA_TYPES = new Set(['AS', 'MA']);

const MAX_FORMAT_COLUMNS = 5;

export interface ExportOptions {
  /** Fallback for meetings whose source has no time zone. */
  defaultTimeZone?: string;
  /** Infix for generated service body worldIds. */
  worldIdPrefix?: string;
}

export interface GeneratedWorldId {
  serviceBodyId: string;
  worldId: string;
  name: string;
}

export interface ExportResult {
  columns: string[];
  rows: string[][];
  generatedWorldIds: GeneratedWorldId[];
  /** Source formats with no worldId -- these cannot survive the NAWS round trip. */
  formatsWithoutWorldId: string[];
  /** Format ids referenced by a meeting but absent from GetFormats. */
  unknownFormatIds: string[];
  /** Meetings with more than five non-special formats, and what was dropped. */
  truncatedFormats: { meetingName: string; dropped: string[] }[];
  meetingsWithoutTimeZone: number;
  unpublishedCount: number;
}

function text(value: string | undefined | null): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

/** '19:30:00' -> '1930' */
export function toMilitaryTime(startTime: string): string {
  const [hours, minutes] = text(startTime).split(':');
  if (!hours) {
    return '';
  }
  return `${hours.padStart(2, '0')}${(minutes ?? '00').padStart(2, '0')}`;
}

/** '01:30:00' -> '01:30' */
export function toDuration(duration: string): string {
  const parts = text(duration).split(':');
  if (parts.length < 2) {
    return '';
  }
  return `${parts[0].padStart(2, '0')}:${parts[1]}`;
}

export function generateWorldId(serviceBody: Pick<SemanticServiceBody, 'id' | 'type'>, prefix: string): string {
  const kind = AREA_TYPES.has(serviceBody.type) ? 'AR' : 'RG';
  return `${kind}${prefix}${serviceBody.id}`.toUpperCase();
}

function buildFormatWorldIds(formats: SemanticFormat[]): { byId: Map<string, string>; withoutWorldId: string[] } {
  const byId = new Map<string, string>();
  const withoutWorldId = new Set<string>();

  formats.forEach((format) => {
    const worldId = text(format.world_id);
    if (worldId) {
      byId.set(String(format.id), worldId.toUpperCase());
    } else {
      withoutWorldId.add(text(format.key_string));
    }
  });

  return { byId, withoutWorldId: [...withoutWorldId].filter(Boolean) };
}

function sortMeetings(meetings: SemanticMeeting[]): SemanticMeeting[] {
  return [...meetings].sort((a, b) => {
    const byBody = text(a.service_body_bigint).padStart(8, '0').localeCompare(text(b.service_body_bigint).padStart(8, '0'));
    if (byBody !== 0) return byBody;

    const byDay = text(a.weekday_tinyint).localeCompare(text(b.weekday_tinyint));
    if (byDay !== 0) return byDay;

    const byTime = text(a.start_time).localeCompare(text(b.start_time));
    if (byTime !== 0) return byTime;

    return text(a.meeting_name).localeCompare(text(b.meeting_name));
  });
}

export function exportToNAWSRows(source: BmltSource, options: ExportOptions = {}): ExportResult {
  const worldIdPrefix = options.worldIdPrefix ?? 'SB';
  const defaultTimeZone = text(options.defaultTimeZone);

  const serviceBodiesById = new Map<string, SemanticServiceBody>();
  source.serviceBodies.forEach((serviceBody) => serviceBodiesById.set(String(serviceBody.id), serviceBody));

  const { byId: formatWorldIds, withoutWorldId } = buildFormatWorldIds(source.formats);

  const worldIdByServiceBody = new Map<string, string>();
  const generatedWorldIds: GeneratedWorldId[] = [];
  const unknownFormatIds = new Set<string>();
  const truncatedFormats: { meetingName: string; dropped: string[] }[] = [];

  let meetingsWithoutTimeZone = 0;
  let unpublishedCount = 0;

  const rows = sortMeetings(source.meetings).map((meeting) => {
    const serviceBodyId = text(meeting.service_body_bigint);
    const serviceBody = serviceBodiesById.get(serviceBodyId);
    const serviceBodyName = text(meeting.service_body_name) || text(serviceBody?.name) || `Service body ${serviceBodyId}`;

    let worldId = worldIdByServiceBody.get(serviceBodyId);
    if (!worldId) {
      const sourceWorldId = text(serviceBody?.world_id);
      worldId = sourceWorldId || generateWorldId({ id: serviceBodyId, type: text(serviceBody?.type) || 'AS' }, worldIdPrefix);
      worldIdByServiceBody.set(serviceBodyId, worldId);

      if (!sourceWorldId) {
        generatedWorldIds.push({ serviceBodyId, worldId, name: serviceBodyName });
      }
    }

    let closed = '';
    let wheelchair = '';
    const otherFormats: string[] = [];

    text(meeting.format_shared_id_list)
      .split(',')
      .filter(Boolean)
      .forEach((formatId) => {
        const formatWorldId = formatWorldIds.get(formatId.trim());
        if (!formatWorldId) {
          unknownFormatIds.add(formatId.trim());
          return;
        }

        if (OPEN_CLOSED.has(formatWorldId)) {
          closed = formatWorldId;
        } else if (formatWorldId === 'WCHR') {
          wheelchair = 'TRUE';
        } else if (!RESTRICTED_FORMATS.has(formatWorldId)) {
          otherFormats.push(formatWorldId);
        }
      });

    if (otherFormats.length > MAX_FORMAT_COLUMNS) {
      truncatedFormats.push({
        meetingName: text(meeting.meeting_name),
        dropped: otherFormats.slice(MAX_FORMAT_COLUMNS)
      });
    }

    const timeZone = text(meeting.time_zone) || defaultTimeZone;
    if (!timeZone) {
      meetingsWithoutTimeZone++;
    }

    const published = text(meeting.published) !== '0';
    if (!published) {
      unpublishedCount++;
    }

    const weekday = parseInt(text(meeting.weekday_tinyint), 10);
    const formatColumns = Array.from({ length: MAX_FORMAT_COLUMNS }, (_, index) => otherFormats[index] ?? '');

    return [
      text(meeting.worldid_mixed),
      text(meeting.meeting_name),
      worldId,
      serviceBodyName,
      DAYS[weekday] ?? '',
      toMilitaryTime(text(meeting.start_time)),
      toDuration(text(meeting.duration_time)),
      text(meeting.location_text),
      text(meeting.location_street),
      text(meeting.location_municipality),
      text(meeting.location_neighborhood),
      text(meeting.location_province),
      text(meeting.location_postal_code_1),
      text(meeting.location_nation),
      text(meeting.location_info),
      '',
      closed,
      wheelchair,
      ...formatColumns,
      text(meeting.longitude),
      text(meeting.latitude),
      text(meeting.phone_meeting_number),
      text(meeting.virtual_meeting_link),
      text(meeting.virtual_meeting_additional_info),
      timeZone,
      VENUE_TYPES[text(meeting.venue_type)] ?? '',
      published ? 'TRUE' : 'FALSE',
      ''
    ];
  });

  return {
    columns: NAWS_EXPORT_COLUMNS,
    rows,
    generatedWorldIds,
    formatsWithoutWorldId: withoutWorldId,
    unknownFormatIds: [...unknownFormatIds],
    truncatedFormats,
    meetingsWithoutTimeZone,
    unpublishedCount
  };
}
