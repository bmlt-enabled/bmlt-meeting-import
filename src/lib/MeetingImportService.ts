import { ResponseError, type Meeting, type MeetingCreate } from 'bmlt-server-client';
import type { NAWSRow } from './SpreadsheetProcessor';
import { SpreadsheetProcessor } from './SpreadsheetProcessor';
import { NAWSMapper, type MappingOptions } from './NAWSMapper';
import { ServiceBodyCreator } from './ServiceBodyCreator';
import { BmltSourceClient, type BmltSource, type FetchSourceOptions } from './BmltSourceClient';
import { BmltSourceMapper, type FormatMatch, type ServiceBodyMatch } from './BmltSourceMapper';
import RootServerApi from './ServerApi';

/** One meeting ready to be created, with the label used in any message about it. */
interface PreparedMeeting {
  label: string;
  worldId: string;
  meeting: MeetingCreate | null;
  errors: string[];
}

export interface ImportProgress {
  phase: 'processing' | 'validating' | 'mapping' | 'service-bodies' | 'creating' | 'completed' | 'error';
  currentStep: number;
  totalSteps: number;
  message: string;
  percentage: number;
}

export interface ImportResult {
  success: boolean;
  totalProcessed: number;
  successfulImports: number;
  failedImports: number;
  skippedImports: number;
  servicesBodiesCreated: number;
  errors: string[];
  warnings: string[];
  createdMeetings: Meeting[];
  duration: number;
}

export type ProgressCallback = (progress: ImportProgress) => void;

/** What a BMLT-to-BMLT import will do, worked out before anything is written. */
export interface BmltSourcePreview {
  source: BmltSource;
  serviceBodyMatches: ServiceBodyMatch[];
  formatMatches: FormatMatch[];
  /** Source formats in use that the destination has no equivalent for. */
  unmatchedFormats: FormatMatch[];
  meetingCount: number;
  warnings: string[];
}

export interface BmltImportOptions {
  defaultTimeZone?: string;
  defaultLatitude?: number;
  defaultLongitude?: number;
  /** Import everything unpublished no matter what the source says. */
  forceUnpublished?: boolean;
}

export class MeetingImportService {
  private static readonly BATCH_SIZE = 5; // Process meetings in batches to avoid overwhelming the server
  private static readonly BATCH_DELAY = 500; // Delay between batches in milliseconds

  static async importFromFile(
    file: File,
    options: {
      defaultDuration?: string;
      defaultLatitude?: number;
      defaultLongitude?: number;
      defaultPublished?: boolean;
    } = {},
    onProgress?: ProgressCallback,
    abortSignal?: AbortSignal
  ): Promise<ImportResult> {
    const startTime = Date.now();

    const result: ImportResult = {
      success: false,
      totalProcessed: 0,
      successfulImports: 0,
      failedImports: 0,
      skippedImports: 0,
      servicesBodiesCreated: 0,
      errors: [],
      warnings: [],
      createdMeetings: [],
      duration: 0
    };

    try {
      // Phase 1: Process spreadsheet file
      onProgress?.({
        phase: 'processing',
        currentStep: 1,
        totalSteps: 6,
        message: 'Processing spreadsheet file...',
        percentage: 0
      });

      const processedSpreadsheet = await SpreadsheetProcessor.processFile(file, (message) => {
        onProgress?.({
          phase: 'processing',
          currentStep: 1,
          totalSteps: 6,
          message,
          percentage: 0
        });
      });

      // Check for cancellation after file processing
      if (abortSignal?.aborted) {
        throw new DOMException('Import cancelled by user', 'AbortError');
      }

      if (processedSpreadsheet.errors.length > 0) {
        result.errors.push(...processedSpreadsheet.errors);
        throw new Error('Spreadsheet processing failed');
      }

      result.warnings.push(...processedSpreadsheet.warnings);
      result.totalProcessed = processedSpreadsheet.validRows;

      // Phase 2: Fetch server data
      onProgress?.({
        phase: 'validating',
        currentStep: 2,
        totalSteps: 6,
        message: 'Fetching server configuration...',
        percentage: 15
      });

      const [serviceBodies, formats] = await Promise.all([RootServerApi.getServiceBodies(), RootServerApi.getFormats()]);

      // Check for cancellation after server data fetch
      if (abortSignal?.aborted) {
        throw new DOMException('Import cancelled by user', 'AbortError');
      }

      // Phase 3: Initialize mapper and validate
      onProgress?.({
        phase: 'mapping',
        currentStep: 3,
        totalSteps: 6,
        message: 'Validating data mapping...',
        percentage: 30
      });

      const mappingOptions: MappingOptions = {
        serviceBodies,
        formats,
        defaultDuration: options.defaultDuration || '01:00',
        defaultLatitude: options.defaultLatitude || 0,
        defaultLongitude: options.defaultLongitude || 0,
        defaultPublished: options.defaultPublished ?? true
      };

      // Phase 4: Create missing service bodies
      onProgress?.({
        phase: 'service-bodies',
        currentStep: 4,
        totalSteps: 6,
        message: 'Creating missing service bodies...',
        percentage: 45
      });

      // Extract all required areas from the data
      const requiredAreas = ServiceBodyCreator.extractUniqueAreas(processedSpreadsheet.rows);
      const missingAreas = await ServiceBodyCreator.findMissingServiceBodies(requiredAreas);

      if (missingAreas.length > 0) {
        const serviceBodyStats = await ServiceBodyCreator.createMissingServiceBodies(missingAreas, (current, total, areaName) => {
          onProgress?.({
            phase: 'service-bodies',
            currentStep: 4,
            totalSteps: 6,
            message: `Creating service body ${current} of ${total}: ${areaName}`,
            percentage: 45 + (current / total) * 10 // 45% to 55%
          });
        });

        result.servicesBodiesCreated = serviceBodyStats.servicesBodiesCreated;
        result.errors.push(...serviceBodyStats.errors);
        result.warnings.push(...serviceBodyStats.warnings);

        if (serviceBodyStats.servicesBodiesCreated > 0) {
          result.warnings.push(`Created ${serviceBodyStats.servicesBodiesCreated} service bodies (using current user as admin)`);
        }
      } else {
        result.warnings.push('All required service bodies already exist');
      }

      // Re-fetch service bodies after creation to update mapper
      const updatedServiceBodies = await RootServerApi.getServiceBodies();
      const updatedMappingOptions = { ...mappingOptions, serviceBodies: updatedServiceBodies };
      const updatedMapper = new NAWSMapper(updatedMappingOptions);

      // Check for missing formats
      const formatStats = updatedMapper.getFormatStats(processedSpreadsheet.rows);
      if (formatStats.missing.length > 0) {
        result.warnings.push(`Missing formats (these will be ignored): ${formatStats.missing.join(', ')}`);
      }

      // Phase 5: Check for duplicate worldIds before creating meetings
      onProgress?.({
        phase: 'creating',
        currentStep: 5,
        totalSteps: 6,
        message: 'Checking for duplicate meetings...',
        percentage: 55
      });

      const existingWorldIds = await this.getExistingMeetingWorldIds();

      // Check for cancellation before starting meeting creation
      if (abortSignal?.aborted) {
        throw new DOMException('Import cancelled by user', 'AbortError');
      }

      onProgress?.({
        phase: 'creating',
        currentStep: 5,
        totalSteps: 6,
        message: 'Creating meetings...',
        percentage: 60
      });

      const createdMeetings = await this.createMeetingsInBatches(
        processedSpreadsheet.rows,
        updatedMapper,
        existingWorldIds,
        (current, total) => {
          onProgress?.({
            phase: 'creating',
            currentStep: 5,
            totalSteps: 6,
            message: `Creating meeting ${current} of ${total}...`,
            percentage: 60 + (current / total) * 30 // 60% to 90%
          });
        },
        abortSignal
      );

      // Use the accurate count from batch processing
      result.successfulImports = createdMeetings.successfulCount;
      result.failedImports = createdMeetings.failed;
      result.skippedImports = createdMeetings.skipped;
      result.errors.push(...createdMeetings.errors);

      // Only keep a small sample of created meetings to prevent memory bloat
      result.createdMeetings = createdMeetings.successful; // Already limited to 10 in batch processing

      // Phase 6: Complete
      onProgress?.({
        phase: 'completed',
        currentStep: 6,
        totalSteps: 6,
        message: `Import completed: ${result.successfulImports} meetings created, ${result.failedImports} failed, ${result.skippedImports} skipped`,
        percentage: 100
      });

      result.success = result.successfulImports > 0;
      result.duration = Date.now() - startTime;

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      result.duration = Date.now() - startTime;

      // Handle cancellation differently from other errors
      if (error instanceof DOMException && error.name === 'AbortError') {
        result.errors.push('Import cancelled by user');
        onProgress?.({
          phase: 'error',
          currentStep: 0,
          totalSteps: 6,
          message: 'Import cancelled',
          percentage: 0
        });
      } else {
        result.errors.push(errorMessage);
        onProgress?.({
          phase: 'error',
          currentStep: 0,
          totalSteps: 6,
          message: `Import failed: ${errorMessage}`,
          percentage: 0
        });
      }

      return result;
    }
  }

  /**
   * Works out what a BMLT-to-BMLT import would do without changing anything:
   * reads the source server and pairs its service bodies and formats with the
   * destination's.
   */
  static async previewBmltSource(rootUrl: string, options: FetchSourceOptions = {}, onProgress?: (message: string) => void): Promise<BmltSourcePreview> {
    onProgress?.('Reading source server...');
    const source = await BmltSourceClient.fetchSource(rootUrl, options);

    if (source.meetings.length === 0) {
      throw new Error('The source server returned no meetings. Check the URL and any service body filter.');
    }

    onProgress?.('Reading destination server...');
    const [destinationServiceBodies, destinationFormats] = await Promise.all([RootServerApi.getServiceBodies(), RootServerApi.getFormats()]);

    onProgress?.('Matching service bodies and formats...');
    const serviceBodyMatches = BmltSourceMapper.matchServiceBodies(source.serviceBodies, destinationServiceBodies, source.meetings);
    const formatMatches = BmltSourceMapper.matchFormats(source.formats, destinationFormats);

    // Only formats meetings actually use are worth reporting
    const usedFormatIds = new Set<string>();
    source.meetings.forEach((meeting) => {
      (meeting.format_shared_id_list ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .forEach((id) => usedFormatIds.add(id));
    });

    const unmatchedFormats = formatMatches.filter((match) => !match.destinationId && usedFormatIds.has(String(match.source.id)) && !BmltSourceMapper.isRestrictedFormat(match.source));

    const warnings: string[] = [];

    const toCreate = serviceBodyMatches.filter((match) => !match.destination);
    if (toCreate.length > 0) {
      warnings.push(`${toCreate.length} service bodies will be created on the destination server: ${toCreate.map((match) => match.source.name).join(', ')}`);
    }

    if (unmatchedFormats.length > 0) {
      warnings.push(`The destination has no equivalent for these formats, which will be dropped: ${unmatchedFormats.map((match) => match.source.key_string).join(', ')}`);
    }

    return {
      source,
      serviceBodyMatches,
      formatMatches,
      unmatchedFormats,
      meetingCount: source.meetings.length,
      warnings
    };
  }

  /**
   * Copies meetings from a BMLT source server onto the logged-in destination,
   * keeping the fields the NAWS spreadsheet format cannot carry.
   */
  static async importFromBmltServer(preview: BmltSourcePreview, options: BmltImportOptions = {}, onProgress?: ProgressCallback, abortSignal?: AbortSignal): Promise<ImportResult> {
    const startTime = Date.now();

    const result: ImportResult = {
      success: false,
      totalProcessed: preview.meetingCount,
      successfulImports: 0,
      failedImports: 0,
      skippedImports: 0,
      servicesBodiesCreated: 0,
      errors: [],
      warnings: [...preview.warnings],
      createdMeetings: [],
      duration: 0
    };

    const throwIfAborted = () => {
      if (abortSignal?.aborted) {
        throw new DOMException('Import cancelled by user', 'AbortError');
      }
    };

    try {
      throwIfAborted();

      // Phase 1: Service bodies, parents before children
      onProgress?.({
        phase: 'service-bodies',
        currentStep: 1,
        totalSteps: 4,
        message: 'Matching service bodies...',
        percentage: 5
      });

      const serviceBodies = await ServiceBodyCreator.resolveSourceServiceBodies(preview.serviceBodyMatches, (current, total, name) => {
        onProgress?.({
          phase: 'service-bodies',
          currentStep: 1,
          totalSteps: 4,
          message: `Creating service body ${current} of ${total}: ${name}`,
          percentage: 5 + (current / total) * 20 // 5% to 25%
        });
      });

      result.servicesBodiesCreated = serviceBodies.created;
      result.errors.push(...serviceBodies.errors);
      result.warnings.push(...serviceBodies.warnings);

      throwIfAborted();

      // Phase 2: Map every meeting before writing anything
      onProgress?.({
        phase: 'mapping',
        currentStep: 2,
        totalSteps: 4,
        message: 'Mapping meetings...',
        percentage: 30
      });

      const formatIds = new Map<string, number>();
      preview.formatMatches.forEach((match) => {
        // Venue formats are applied by the destination server itself
        if (match.destinationId && !BmltSourceMapper.isRestrictedFormat(match.source)) {
          formatIds.set(String(match.source.id), match.destinationId);
        }
      });

      const mappingOptions = {
        serviceBodyIds: serviceBodies.idMap,
        formatIds,
        defaultLatitude: options.defaultLatitude ?? 0,
        defaultLongitude: options.defaultLongitude ?? 0,
        defaultTimeZone: options.defaultTimeZone,
        forceUnpublished: options.forceUnpublished
      };

      const prepared: PreparedMeeting[] = preview.source.meetings.map((meeting) => {
        const label = BmltSourceMapper.describeMeeting(meeting);
        const mapped = BmltSourceMapper.mapMeeting(meeting, mappingOptions, label);
        result.warnings.push(...mapped.warnings);

        return {
          label,
          worldId: meeting.worldid_mixed?.trim() ?? '',
          meeting: mapped.meeting,
          errors: mapped.errors
        };
      });

      throwIfAborted();

      // Phase 3: Create
      onProgress?.({
        phase: 'creating',
        currentStep: 3,
        totalSteps: 4,
        message: 'Checking for duplicate meetings...',
        percentage: 35
      });

      const existingWorldIds = await this.getExistingMeetingWorldIds();

      const created = await this.createPreparedMeetingsInBatches(
        prepared,
        existingWorldIds,
        (current, total) => {
          onProgress?.({
            phase: 'creating',
            currentStep: 3,
            totalSteps: 4,
            message: `Creating meeting ${current} of ${total}...`,
            percentage: 35 + (current / total) * 60 // 35% to 95%
          });
        },
        abortSignal
      );

      result.successfulImports = created.successfulCount;
      result.failedImports = created.failed;
      result.skippedImports = created.skipped;
      result.errors.push(...created.errors);
      result.createdMeetings = created.successful;

      // Phase 4: Complete
      onProgress?.({
        phase: 'completed',
        currentStep: 4,
        totalSteps: 4,
        message: `Import completed: ${result.successfulImports} meetings created, ${result.failedImports} failed, ${result.skippedImports} skipped`,
        percentage: 100
      });

      result.success = result.successfulImports > 0;
      result.duration = Date.now() - startTime;

      return result;
    } catch (error) {
      result.duration = Date.now() - startTime;

      if (error instanceof DOMException && error.name === 'AbortError') {
        result.errors.push('Import cancelled by user');
        onProgress?.({
          phase: 'error',
          currentStep: 0,
          totalSteps: 4,
          message: 'Import cancelled',
          percentage: 0
        });
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        result.errors.push(errorMessage);
        onProgress?.({
          phase: 'error',
          currentStep: 0,
          totalSteps: 4,
          message: `Import failed: ${errorMessage}`,
          percentage: 0
        });
      }

      return result;
    }
  }

  private static async createMeetingsInBatches(
    nawsRows: NAWSRow[],
    mapper: NAWSMapper,
    existingWorldIds: Set<string>,
    onBatchProgress?: (current: number, total: number) => void,
    abortSignal?: AbortSignal
  ): Promise<{
    successful: Meeting[];
    successfulCount: number;
    failed: number;
    skipped: number;
    errors: string[];
  }> {
    const validRows = nawsRows.filter((row) => row.delete?.toUpperCase() !== 'D' && row.committeename?.trim() && row.arearegion?.trim() && row.day?.trim() && row.time?.trim());

    const prepared: PreparedMeeting[] = validRows.map((row, index) => {
      const rowIndex = index + 2; // Account for header row + 1-based indexing
      const label = `Row ${rowIndex}`;
      const mappingResult = mapper.mapNAWSRowToMeeting(row, rowIndex);

      return {
        label,
        worldId: row.committee?.trim() ?? '',
        meeting: mappingResult.meeting,
        errors: mappingResult.errors
      };
    });

    return this.createPreparedMeetingsInBatches(prepared, existingWorldIds, onBatchProgress, abortSignal);
  }

  private static async createPreparedMeetingsInBatches(
    prepared: PreparedMeeting[],
    existingWorldIds: Set<string>,
    onBatchProgress?: (current: number, total: number) => void,
    abortSignal?: AbortSignal
  ): Promise<{
    successful: Meeting[];
    successfulCount: number;
    failed: number;
    skipped: number;
    errors: string[];
  }> {
    const result = {
      successful: [] as Meeting[],
      failed: 0,
      skipped: 0,
      errors: [] as string[]
    };

    // Limit the number of meetings stored to prevent memory bloat
    const MAX_STORED_MEETINGS = 10;
    const MAX_STORED_ERRORS = 50; // Also limit errors to prevent memory bloat
    let successfulCount = 0; // Track actual success count separately

    let processedCount = 0;

    // Process in batches
    for (let i = 0; i < prepared.length; i += this.BATCH_SIZE) {
      // Check for cancellation before each batch
      if (abortSignal?.aborted) {
        throw new DOMException('Import cancelled by user', 'AbortError');
      }

      const batch = prepared.slice(i, i + this.BATCH_SIZE);

      // Process batch concurrently
      const batchPromises = batch.map(async (item) => {
        try {
          // First check if this worldId already exists
          if (item.worldId && existingWorldIds.has(item.worldId.toUpperCase())) {
            return {
              success: false,
              skipped: true,
              meeting: null,
              errors: [`${item.label}: Meeting with worldId '${item.worldId}' already exists - skipped`]
            };
          }

          if (item.meeting) {
            const createdMeeting = await RootServerApi.createMeeting(item.meeting);
            return { success: true, skipped: false, meeting: createdMeeting, errors: item.errors };
          } else {
            return {
              success: false,
              skipped: false,
              meeting: null,
              errors: item.errors.length > 0 ? item.errors : [`${item.label}: Failed to map meeting data`]
            };
          }
        } catch (error) {
          let errorMessage = 'Unknown error';
          if (error instanceof ResponseError) {
            try {
              const body = await error.response.json();
              if (body.message) {
                errorMessage = body.message;
              } else if (body.errors) {
                // Flatten field errors into a readable message
                const fieldErrors = Object.values(body.errors).flat();
                errorMessage = fieldErrors.join(', ');
              }
            } catch {
              errorMessage = error.message;
            }
          } else if (error instanceof Error) {
            errorMessage = error.message;
          }
          return {
            success: false,
            skipped: false,
            meeting: null,
            errors: [`${item.label}: Failed to create meeting - ${errorMessage}`]
          };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process results
      batchResults.forEach((batchResult) => {
        processedCount++;

        if (batchResult.success && batchResult.meeting) {
          successfulCount++; // Always count successful imports
          // Only store a limited number of meetings to prevent memory issues
          if (result.successful.length < MAX_STORED_MEETINGS) {
            result.successful.push(batchResult.meeting);
          }
        } else if (batchResult.skipped) {
          result.skipped++;
        } else {
          result.failed++;
        }

        // Limit error storage to prevent memory bloat
        if (result.errors.length < MAX_STORED_ERRORS) {
          const errorsToAdd = batchResult.errors.slice(0, MAX_STORED_ERRORS - result.errors.length);
          result.errors.push(...errorsToAdd);
        }

        onBatchProgress?.(processedCount, prepared.length);
      });

      // Add delay between batches to be nice to the server
      if (i + this.BATCH_SIZE < prepared.length) {
        await this.delay(this.BATCH_DELAY);
      }
    }

    // Return the result with accurate count
    return {
      ...result,
      successfulCount
    };
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private static async getExistingMeetingWorldIds(): Promise<Set<string>> {
    try {
      const existingMeetings = await RootServerApi.getMeetings();
      const worldIds = new Set<string>();

      existingMeetings.forEach((meeting) => {
        if (meeting.worldId && meeting.worldId.trim()) {
          worldIds.add(meeting.worldId.trim().toUpperCase());
        }
      });

      return worldIds;
    } catch (error) {
      console.error('Failed to fetch existing meetings for duplicate check:', error);
      // Return empty set on error - better to potentially create duplicates than fail entirely
      return new Set<string>();
    }
  }

  static async validateFile(
    file: File,
    onProgress?: (message: string) => void
  ): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    preview: {
      totalRows: number;
      validRows: number;
      sampleRows: any[];
    };
  }> {
    try {
      const processed = await SpreadsheetProcessor.processFile(file, onProgress);

      return {
        valid: processed.errors.length === 0,
        errors: processed.errors,
        warnings: processed.warnings,
        preview: {
          totalRows: processed.totalRows,
          validRows: processed.validRows,
          sampleRows: processed.rows.slice(0, 5) // Show first 5 rows as preview
        }
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Unknown validation error'],
        warnings: [],
        preview: {
          totalRows: 0,
          validRows: 0,
          sampleRows: []
        }
      };
    }
  }

  static getSupportedFileTypes(): string[] {
    return [
      '.xlsx',
      '.xls', // Excel files
      '.csv', // CSV files
      '.ods' // OpenDocument Spreadsheet
    ];
  }

  static getMaxFileSize(): number {
    return 10 * 1024 * 1024; // 10MB
  }
}
