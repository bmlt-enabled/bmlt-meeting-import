import { ResponseError, type Meeting } from 'bmlt-server-client';
import type { NAWSRow } from './SpreadsheetProcessor';
import { SpreadsheetProcessor } from './SpreadsheetProcessor';
import { NAWSMapper, type MappingOptions } from './NAWSMapper';
import { ServiceBodyCreator } from './ServiceBodyCreator';
import RootServerApi from './ServerApi';

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
    const validRows = nawsRows.filter((row) => row.delete?.toUpperCase() !== 'D' && row.committeename?.trim() && row.arearegion?.trim() && row.day?.trim() && row.time?.trim());

    // Process in batches
    for (let i = 0; i < validRows.length; i += this.BATCH_SIZE) {
      // Check for cancellation before each batch
      if (abortSignal?.aborted) {
        throw new DOMException('Import cancelled by user', 'AbortError');
      }

      const batch = validRows.slice(i, i + this.BATCH_SIZE);

      // Process batch concurrently
      const batchPromises = batch.map(async (row, batchIndex) => {
        const rowIndex = i + batchIndex + 2; // Account for header row + 1-based indexing

        try {
          // First check if this worldId already exists
          const worldId = row.committee?.trim();
          if (worldId && existingWorldIds.has(worldId.toUpperCase())) {
            return {
              success: false,
              skipped: true,
              meeting: null,
              errors: [`Row ${rowIndex}: Meeting with worldId '${worldId}' already exists - skipped`]
            };
          }

          const mappingResult = mapper.mapNAWSRowToMeeting(row, rowIndex);

          if (mappingResult.meeting) {
            const createdMeeting = await RootServerApi.createMeeting(mappingResult.meeting);
            return { success: true, skipped: false, meeting: createdMeeting, errors: mappingResult.errors };
          } else {
            return {
              success: false,
              skipped: false,
              meeting: null,
              errors: mappingResult.errors.length > 0 ? mappingResult.errors : [`Row ${rowIndex}: Failed to map meeting data`]
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
            errors: [`Row ${rowIndex}: Failed to create meeting - ${errorMessage}`]
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

        onBatchProgress?.(processedCount, validRows.length);
      });

      // Add delay between batches to be nice to the server
      if (i + this.BATCH_SIZE < validRows.length) {
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
