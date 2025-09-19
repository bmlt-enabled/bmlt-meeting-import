import type { MeetingCreate, Format, ServiceBody } from 'bmlt-server-client';
import type { NAWSRow } from './SpreadsheetProcessor';
import { SpreadsheetProcessor } from './SpreadsheetProcessor';

export interface MappingOptions {
  serviceBodies: ServiceBody[];
  formats: Format[];
  defaultDuration: string;
  defaultLatitude: number;
  defaultLongitude: number;
  defaultPublished: boolean;
}

export interface MappingResult {
  meeting: MeetingCreate | null;
  errors: string[];
  warnings: string[];
}

export interface ImportStats {
  totalProcessed: number;
  successfullyMapped: number;
  errors: string[];
  warnings: string[];
}

export class NAWSMapper {
  private serviceBodies: ServiceBody[];
  private formats: Format[];
  private formatWorldIdMap: Map<string, number[]>;
  private serviceBodyWorldIdMap: Map<string, number>;
  private options: MappingOptions;

  constructor(options: MappingOptions) {
    this.options = options;
    this.serviceBodies = options.serviceBodies;
    this.formats = options.formats;
    this.formatWorldIdMap = this.buildFormatWorldIdMap();
    this.serviceBodyWorldIdMap = this.buildServiceBodyWorldIdMap();
  }

  private buildFormatWorldIdMap(): Map<string, number[]> {
    const map = new Map<string, number[]>();

    this.formats.forEach((format) => {
      if (format.worldId) {
        const worldId = format.worldId.toUpperCase();
        if (!map.has(worldId)) {
          map.set(worldId, []);
        }
        map.get(worldId)!.push(format.id);
      }
    });

    return map;
  }

  private buildServiceBodyWorldIdMap(): Map<string, number> {
    const map = new Map<string, number>();

    this.serviceBodies.forEach((serviceBody) => {
      if (serviceBody.worldId) {
        const worldId = serviceBody.worldId.toUpperCase();
        map.set(worldId, serviceBody.id);
      }
    });

    return map;
  }

  mapNAWSRowToMeeting(nawsRow: NAWSRow, rowIndex: number): MappingResult {
    const result: MappingResult = {
      meeting: null,
      errors: [],
      warnings: []
    };

    // Skip deleted meetings
    if (nawsRow.delete?.toUpperCase() === 'D') {
      return result;
    }

    // Validate required fields
    if (!nawsRow.committeename?.trim()) {
      result.errors.push(`Row ${rowIndex}: Missing meeting name (committeename)`);
      return result;
    }

    if (!nawsRow.arearegion?.trim()) {
      result.errors.push(`Row ${rowIndex}: Missing area/region (arearegion)`);
      return result;
    }

    if (!nawsRow.day?.trim()) {
      result.errors.push(`Row ${rowIndex}: Missing day`);
      return result;
    }

    if (!nawsRow.time?.trim()) {
      result.errors.push(`Row ${rowIndex}: Missing time`);
      return result;
    }

    // Find service body
    const serviceBodyId = this.serviceBodyWorldIdMap.get(nawsRow.arearegion.toUpperCase());
    if (!serviceBodyId) {
      result.errors.push(`Row ${rowIndex}: Service body not found for area/region '${nawsRow.arearegion}'`);
      return result;
    }

    try {
      // Create the meeting object
      const meeting: MeetingCreate = {
        serviceBodyId: serviceBodyId,
        formatIds: this.mapFormats(nawsRow, rowIndex, result),
        venueType: this.determineVenueType(nawsRow),
        temporarilyVirtual: false,
        day: SpreadsheetProcessor.mapDayToBMLT(nawsRow.day),
        startTime: SpreadsheetProcessor.formatTimeForBMLT(nawsRow.time),
        duration: this.options.defaultDuration,
        timeZone: nawsRow.timezone || '',
        latitude: this.parseCoordinate(nawsRow.latitude, this.options.defaultLatitude),
        longitude: this.parseCoordinate(nawsRow.longitude, this.options.defaultLongitude),
        published: this.options.defaultPublished,
        email: '',
        worldId: nawsRow.committee || '',
        name: nawsRow.committeename,
        locationText: nawsRow.place || '',
        locationInfo: this.buildLocationInfo(nawsRow),
        locationStreet: nawsRow.address || '',
        locationNeighborhood: nawsRow.locborough || '',
        locationCitySubsection: '',
        locationMunicipality: nawsRow.city || '',
        locationSubProvince: '',
        locationProvince: nawsRow.state || '',
        locationPostalCode1: nawsRow.zip || '',
        locationNation: nawsRow.country || '',
        phoneMeetingNumber: nawsRow.phonemeetingnumber || '',
        virtualMeetingLink: nawsRow.virtualmeetinglink || '',
        virtualMeetingAdditionalInfo: nawsRow.virtualmeetinginfo || '',
        contactName1: '',
        contactName2: '',
        contactPhone1: '',
        contactPhone2: '',
        contactEmail1: '',
        contactEmail2: '',
        busLines: '',
        trainLines: '',
        comments: ''
      };

      result.meeting = meeting;
    } catch (error) {
      result.errors.push(`Row ${rowIndex}: Error mapping meeting data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  private mapFormats(nawsRow: NAWSRow, rowIndex: number, result: MappingResult): number[] {
    const formatIds = new Set<number>();

    // Handle wheelchair accessibility
    if (nawsRow.wheelchr?.toLowerCase() === 'true' || nawsRow.wheelchr === '1') {
      const wchrFormats = this.formatWorldIdMap.get('WCHR');
      if (wchrFormats) {
        wchrFormats.forEach((id) => formatIds.add(id));
      } else {
        result.warnings.push(`Row ${rowIndex}: Wheelchair format (WCHR) not found`);
      }
    }

    // Handle format columns (closed, format1-5)
    const formatColumns = ['closed', 'format1', 'format2', 'format3', 'format4', 'format5'];

    formatColumns.forEach((column) => {
      const formatValue = nawsRow[column];
      if (formatValue && formatValue.trim()) {
        const formats = this.formatWorldIdMap.get(formatValue.toUpperCase());
        if (formats) {
          formats.forEach((id) => formatIds.add(id));
        } else {
          result.warnings.push(`Row ${rowIndex}: Format '${formatValue}' not found in ${column}`);
        }
      }
    });

    return Array.from(formatIds);
  }

  private determineVenueType(nawsRow: NAWSRow): number {
    const VENUE_TYPE_IN_PERSON = 1;
    const VENUE_TYPE_VIRTUAL = 2;
    const VENUE_TYPE_HYBRID = 3;

    const hasPhysicalLocation = !!(nawsRow.address?.trim() || nawsRow.city?.trim());
    const hasVirtualInfo = !!(nawsRow.virtualmeetinglink?.trim() || nawsRow.phonemeetingnumber?.trim());

    if (hasPhysicalLocation && hasVirtualInfo) {
      return VENUE_TYPE_HYBRID;
    } else if (hasVirtualInfo) {
      return VENUE_TYPE_VIRTUAL;
    } else {
      return VENUE_TYPE_IN_PERSON;
    }
  }

  private buildLocationInfo(nawsRow: NAWSRow): string {
    const parts: string[] = [];

    // Add room first if present
    if (nawsRow.room?.trim()) {
      parts.push(nawsRow.room.trim());
    }

    // Add directions if present
    if (nawsRow.directions?.trim()) {
      parts.push(nawsRow.directions.trim());
    }

    return parts.join(', ');
  }

  private parseCoordinate(coord: string | undefined, defaultValue: number): number {
    if (!coord?.trim()) {
      return defaultValue;
    }

    const parsed = parseFloat(coord);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  mapAllRows(nawsRows: NAWSRow[]): ImportStats {
    const stats: ImportStats = {
      totalProcessed: 0,
      successfullyMapped: 0,
      errors: [],
      warnings: []
    };

    const mappedMeetings: MeetingCreate[] = [];

    nawsRows.forEach((row, index) => {
      const rowNum = index + 2; // Account for header row + 1-based indexing
      stats.totalProcessed++;

      const mappingResult = this.mapNAWSRowToMeeting(row, rowNum);

      if (mappingResult.meeting) {
        mappedMeetings.push(mappingResult.meeting);
        stats.successfullyMapped++;
      }

      stats.errors.push(...mappingResult.errors);
      stats.warnings.push(...mappingResult.warnings);
    });

    return stats;
  }

  async validateServiceBodiesExist(nawsRows: NAWSRow[]): Promise<string[]> {
    const missingServiceBodies: string[] = [];
    const uniqueAreaRegions = new Set<string>();

    nawsRows.forEach((row) => {
      if (row.arearegion?.trim() && row.delete?.toUpperCase() !== 'D') {
        uniqueAreaRegions.add(row.arearegion.toUpperCase());
      }
    });

    uniqueAreaRegions.forEach((areaRegion) => {
      if (!this.serviceBodyWorldIdMap.has(areaRegion)) {
        missingServiceBodies.push(areaRegion);
      }
    });

    return missingServiceBodies;
  }

  getFormatStats(nawsRows: NAWSRow[]): { found: string[]; missing: string[] } {
    const foundFormats = new Set<string>();
    const missingFormats = new Set<string>();
    const formatColumns = ['closed', 'format1', 'format2', 'format3', 'format4', 'format5'];

    nawsRows.forEach((row) => {
      if (row.delete?.toUpperCase() === 'D') return;

      // Check wheelchair format
      if (row.wheelchr?.toLowerCase() === 'true' || row.wheelchr === '1') {
        if (this.formatWorldIdMap.has('WCHR')) {
          foundFormats.add('WCHR');
        } else {
          missingFormats.add('WCHR');
        }
      }

      // Check other format columns
      formatColumns.forEach((column) => {
        const formatValue = row[column];
        if (formatValue?.trim()) {
          const upperValue = formatValue.toUpperCase();
          if (this.formatWorldIdMap.has(upperValue)) {
            foundFormats.add(upperValue);
          } else {
            missingFormats.add(upperValue);
          }
        }
      });
    });

    return {
      found: Array.from(foundFormats),
      missing: Array.from(missingFormats)
    };
  }
}
