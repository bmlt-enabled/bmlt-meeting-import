import type { Format, MeetingCreate, ServiceBody } from 'bmlt-server-client';
import type { SemanticFormat, SemanticMeeting, SemanticServiceBody } from './BmltSourceClient';

/**
 * Maps meetings straight from a BMLT source server onto the destination's
 * MeetingCreate shape.
 *
 * Unlike the NAWS path this keeps everything BMLT models -- duration, venue
 * type, published state, comments, contacts, transit lines -- and matches
 * service bodies by worldId *or* name, so a source with no NAWS codes set can
 * still be imported.
 */

// The destination server derives these from the venue type
const RESTRICTED_FORMAT_WORLD_IDS = new Set(['TC', 'VM', 'HY', 'HYBR']);
const RESTRICTED_FORMAT_KEYS = new Set(['TC', 'VM', 'HY']);

export interface ServiceBodyMatch {
  source: SemanticServiceBody;
  destination: ServiceBody | null;
  matchedBy: 'worldId' | 'name' | null;
  /** Meetings in this service body in the current source selection. */
  meetingCount: number;
  /** Present only to hold a child's parent; has no meetings of its own. */
  ancestorOnly: boolean;
}

export interface FormatMatch {
  source: SemanticFormat;
  destinationId: number | null;
  matchedBy: 'worldId' | 'key' | null;
}

export interface MappingOptions {
  /** sourceServiceBodyId -> destination service body id */
  serviceBodyIds: Map<string, number>;
  /** sourceFormatId -> destination format id */
  formatIds: Map<string, number>;
  defaultLatitude: number;
  defaultLongitude: number;
  /** Fallback for meetings whose source has no time zone. */
  defaultTimeZone?: string;
  /** Import everything unpublished regardless of its state on the source. */
  forceUnpublished?: boolean;
}

export interface MeetingMappingResult {
  meeting: MeetingCreate | null;
  errors: string[];
  warnings: string[];
}

function text(value: string | undefined | null): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeName(name: string): string {
  return text(name).toLowerCase().replace(/\s+/g, ' ');
}

/** 'HH:MM:SS' or 'HH:MM' -> 'HH:MM' */
function toClock(value: string): string {
  const parts = text(value).split(':');
  if (parts.length < 2) {
    return '';
  }
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = parseFloat(text(value));
  return Number.isNaN(parsed) ? fallback : parsed;
}

export class BmltSourceMapper {
  /**
   * Pairs source service bodies with destination ones, by worldId first and
   * then by name. Only bodies that actually hold meetings are returned, plus
   * any ancestors needed to rebuild the hierarchy.
   */
  static matchServiceBodies(sourceBodies: SemanticServiceBody[], destinationBodies: ServiceBody[], meetings: SemanticMeeting[]): ServiceBodyMatch[] {
    const sourceById = new Map<string, SemanticServiceBody>();
    sourceBodies.forEach((body) => sourceById.set(String(body.id), body));

    const meetingCounts = new Map<string, number>();
    meetings.forEach((meeting) => {
      const id = text(meeting.service_body_bigint);
      meetingCounts.set(id, (meetingCounts.get(id) ?? 0) + 1);
    });

    // Walk up from every service body that has meetings so parents come along
    const needed = new Map<string, boolean>(); // sourceId -> hasMeetingsOfItsOwn
    meetingCounts.forEach((_count, id) => {
      let current = sourceById.get(id);
      let isSelf = true;

      while (current) {
        const currentId = String(current.id);
        needed.set(currentId, (needed.get(currentId) ?? false) || isSelf);

        const parentId = text(current.parent_id);
        if (!parentId || parentId === '0' || parentId === currentId) {
          break;
        }
        current = sourceById.get(parentId);
        isSelf = false;
      }

      if (!sourceById.has(id)) {
        needed.set(id, true);
      }
    });

    const byWorldId = new Map<string, ServiceBody>();
    const byName = new Map<string, ServiceBody>();
    destinationBodies.forEach((body) => {
      if (body.worldId?.trim()) {
        byWorldId.set(body.worldId.trim().toUpperCase(), body);
      }
      byName.set(normalizeName(body.name), body);
    });

    return [...needed.entries()].map(([sourceId, hasOwnMeetings]) => {
      const source = sourceById.get(sourceId) ?? {
        id: sourceId,
        parent_id: '0',
        name: `Service body ${sourceId}`,
        type: 'AS'
      };

      const sourceWorldId = text(source.world_id).toUpperCase();
      const worldIdMatch = sourceWorldId ? byWorldId.get(sourceWorldId) : undefined;
      const nameMatch = byName.get(normalizeName(source.name));
      const destination = worldIdMatch ?? nameMatch ?? null;

      return {
        source,
        destination,
        matchedBy: worldIdMatch ? 'worldId' : nameMatch ? 'name' : null,
        meetingCount: meetingCounts.get(sourceId) ?? 0,
        ancestorOnly: !hasOwnMeetings
      } as ServiceBodyMatch;
    });
  }

  /**
   * Orders the service bodies that need creating so a parent is always created
   * before its children.
   */
  static orderForCreation(matches: ServiceBodyMatch[]): ServiceBodyMatch[] {
    const bySourceId = new Map<string, ServiceBodyMatch>();
    matches.forEach((match) => bySourceId.set(String(match.source.id), match));

    const depth = (match: ServiceBodyMatch): number => {
      let steps = 0;
      let current: ServiceBodyMatch | undefined = match;
      const seen = new Set<string>();

      while (current) {
        const currentId = String(current.source.id);
        if (seen.has(currentId)) {
          break; // cycle in the source data; stop rather than hang
        }
        seen.add(currentId);

        const parentId = text(current.source.parent_id);
        if (!parentId || parentId === '0') {
          break;
        }
        current = bySourceId.get(parentId);
        if (current) {
          steps++;
        }
      }

      return steps;
    };

    return matches.filter((match) => !match.destination).sort((a, b) => depth(a) - depth(b));
  }

  /** Pairs source formats with destination ones, by worldId first and then by key. */
  static matchFormats(sourceFormats: SemanticFormat[], destinationFormats: Format[]): FormatMatch[] {
    const byWorldId = new Map<string, number>();
    const byKey = new Map<string, number>();

    destinationFormats.forEach((format) => {
      if (format.worldId?.trim()) {
        byWorldId.set(format.worldId.trim().toUpperCase(), format.id);
      }
      format.translations?.forEach((translation) => {
        if (translation.key?.trim()) {
          const key = translation.key.trim().toUpperCase();
          if (!byKey.has(key)) {
            byKey.set(key, format.id);
          }
        }
      });
    });

    // The semantic interface repeats a format per language; one entry per id is enough
    const seen = new Set<string>();

    return sourceFormats
      .filter((format) => {
        const id = String(format.id);
        if (seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      })
      .map((format) => {
        const worldId = text(format.world_id).toUpperCase();
        const key = text(format.key_string).toUpperCase();

        const worldIdMatch = worldId ? byWorldId.get(worldId) : undefined;
        const keyMatch = byKey.get(key);

        return {
          source: format,
          destinationId: worldIdMatch ?? keyMatch ?? null,
          matchedBy: worldIdMatch ? 'worldId' : keyMatch ? 'key' : null
        } as FormatMatch;
      });
  }

  /** True when the destination server manages this format itself. */
  static isRestrictedFormat(format: SemanticFormat): boolean {
    return RESTRICTED_FORMAT_WORLD_IDS.has(text(format.world_id).toUpperCase()) || RESTRICTED_FORMAT_KEYS.has(text(format.key_string).toUpperCase());
  }

  static mapMeeting(meeting: SemanticMeeting, options: MappingOptions, label: string): MeetingMappingResult {
    const result: MeetingMappingResult = { meeting: null, errors: [], warnings: [] };

    const name = text(meeting.meeting_name);
    if (!name) {
      result.errors.push(`${label}: Meeting has no name`);
      return result;
    }

    const sourceServiceBodyId = text(meeting.service_body_bigint);
    const serviceBodyId = options.serviceBodyIds.get(sourceServiceBodyId);
    if (!serviceBodyId) {
      result.errors.push(`${label}: No destination service body for source service body '${sourceServiceBodyId}'`);
      return result;
    }

    // Semantic weekdays are 1-indexed from Sunday; the API is 0-indexed
    const weekday = parseInt(text(meeting.weekday_tinyint), 10);
    if (!(weekday >= 1 && weekday <= 7)) {
      result.errors.push(`${label}: Invalid weekday '${text(meeting.weekday_tinyint)}'`);
      return result;
    }

    const startTime = toClock(text(meeting.start_time));
    if (!startTime) {
      result.errors.push(`${label}: Invalid start time '${text(meeting.start_time)}'`);
      return result;
    }

    const venueType = parseInt(text(meeting.venue_type), 10);
    const formatIds = new Set<number>();

    text(meeting.format_shared_id_list)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .forEach((sourceFormatId) => {
        const destinationId = options.formatIds.get(sourceFormatId);
        if (destinationId) {
          formatIds.add(destinationId);
        }
      });

    const duration = toClock(text(meeting.duration_time)) || '01:00';

    result.meeting = {
      serviceBodyId,
      formatIds: [...formatIds],
      venueType: venueType >= 1 && venueType <= 3 ? venueType : 1,
      temporarilyVirtual: false,
      day: weekday - 1,
      startTime,
      duration,
      timeZone: text(meeting.time_zone) || text(options.defaultTimeZone),
      latitude: toNumber(meeting.latitude, options.defaultLatitude),
      longitude: toNumber(meeting.longitude, options.defaultLongitude),
      published: options.forceUnpublished ? false : text(meeting.published) !== '0',
      email: text(meeting.email_contact),
      worldId: text(meeting.worldid_mixed),
      name,
      locationText: text(meeting.location_text),
      locationInfo: text(meeting.location_info),
      locationStreet: text(meeting.location_street),
      locationNeighborhood: text(meeting.location_neighborhood),
      locationCitySubsection: text(meeting.location_city_subsection),
      locationMunicipality: text(meeting.location_municipality),
      locationSubProvince: text(meeting.location_sub_province),
      locationProvince: text(meeting.location_province),
      locationPostalCode1: text(meeting.location_postal_code_1),
      locationNation: text(meeting.location_nation),
      phoneMeetingNumber: text(meeting.phone_meeting_number),
      virtualMeetingLink: text(meeting.virtual_meeting_link),
      virtualMeetingAdditionalInfo: text(meeting.virtual_meeting_additional_info),
      contactName1: text(meeting.contact_name_1),
      contactName2: text(meeting.contact_name_2),
      contactPhone1: text(meeting.contact_phone_1),
      contactPhone2: text(meeting.contact_phone_2),
      contactEmail1: text(meeting.contact_email_1),
      contactEmail2: text(meeting.contact_email_2),
      busLines: text(meeting.bus_lines),
      trainLines: text(meeting.train_lines),
      comments: text(meeting.comments)
    };

    // The server rejects a hybrid with no street address
    if (result.meeting.venueType === 3 && !result.meeting.locationStreet) {
      result.meeting.venueType = 2;
      result.warnings.push(`${label}: Hybrid meeting has no street address - importing as virtual`);
    }

    if (result.meeting.venueType === 2 && !result.meeting.virtualMeetingLink && !result.meeting.phoneMeetingNumber) {
      result.warnings.push(`${label}: Virtual meeting has no link or phone number`);
    }

    return result;
  }

  static describeMeeting(meeting: SemanticMeeting): string {
    const name = text(meeting.meeting_name) || 'Unnamed meeting';
    const id = text(meeting.id_bigint);
    return id ? `${name} (source #${id})` : name;
  }
}
