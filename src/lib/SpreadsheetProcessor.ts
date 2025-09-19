import * as XLSX from 'xlsx';

export interface NAWSRow {
  delete?: string;
  parentname?: string;
  committee?: string;
  committeename?: string;
  arearegion?: string;
  day?: string;
  time?: string;
  place?: string;
  address?: string;
  city?: string;
  locborough?: string;
  state?: string;
  zip?: string;
  country?: string;
  directions?: string;
  closed?: string;
  wheelchr?: string;
  format1?: string;
  format2?: string;
  format3?: string;
  format4?: string;
  format5?: string;
  longitude?: string;
  latitude?: string;
  room?: string;
  phonemeetingnumber?: string;
  virtualmeetinglink?: string;
  virtualmeetinginfo?: string;
  timezone?: string;
  [key: string]: string | undefined;
}

export interface ProcessedSpreadsheet {
  rows: NAWSRow[];
  totalRows: number;
  validRows: number;
  errors: string[];
  warnings: string[];
}

export class SpreadsheetProcessor {
  private static readonly EXPECTED_COLUMNS = [
    'delete',
    'parentname',
    'committee',
    'committeename',
    'arearegion',
    'day',
    'time',
    'place',
    'address',
    'city',
    'locborough',
    'state',
    'zip',
    'country',
    'directions',
    'closed',
    'wheelchr',
    'format1',
    'format2',
    'format3',
    'format4',
    'format5',
    'longitude',
    'latitude',
    'room',
    'phonemeetingnumber',
    'virtualmeetinglink',
    'virtualmeetinginfo',
    'timezone'
  ];

  private static readonly REQUIRED_COLUMNS = ['committeename', 'arearegion', 'day', 'time'];

  static async processFile(file: File, onProgress?: (message: string) => void): Promise<ProcessedSpreadsheet> {
    try {
      onProgress?.('Reading file...');
      const buffer = await file.arrayBuffer();

      onProgress?.('Parsing spreadsheet...');
      let workbook = XLSX.read(buffer, {
        type: 'array',
        dense: true
      });

      onProgress?.('Processing data...');
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];

      workbook = null as any;

      onProgress?.('Validating and processing...');
      return this.validateAndProcess(rawData);
    } catch (error) {
      throw new Error(`Error processing spreadsheet: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static validateAndProcess(rawData: string[][]): ProcessedSpreadsheet {
    const result: ProcessedSpreadsheet = {
      rows: [],
      totalRows: rawData.length - 1, // Exclude header
      validRows: 0,
      errors: [],
      warnings: []
    };

    // Get and normalize headers
    const headers = rawData[0].map((header) => (header ? header.toString().toLowerCase().trim() : ''));

    // Validate required columns are present
    const missingColumns: string[] = [];
    const columnMap: { [key: string]: number } = {};

    this.EXPECTED_COLUMNS.forEach((expectedCol) => {
      const index = headers.indexOf(expectedCol.toLowerCase());
      if (index === -1) {
        missingColumns.push(expectedCol);
      } else {
        columnMap[expectedCol] = index;
      }
    });

    if (missingColumns.length > 0) {
      result.errors.push(`Missing required columns: ${missingColumns.join(', ')}`);
      return result;
    }

    // Process each data row
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];

      // Simple empty row check
      if (!row || row.length === 0) {
        continue;
      }

      const nawsRow: NAWSRow = {};
      let hasRequiredData = true;

      // Map columns to NAWS format
      this.EXPECTED_COLUMNS.forEach((colName) => {
        const colIndex = columnMap[colName];
        if (colIndex !== undefined && colIndex < row.length) {
          const cellValue = row[colIndex];
          nawsRow[colName] = cellValue ? cellValue.toString().trim() : '';
        } else {
          nawsRow[colName] = '';
        }
      });

      // Skip deleted meetings
      if (nawsRow.delete?.toUpperCase() === 'D') {
        continue;
      }

      // Check required columns
      this.REQUIRED_COLUMNS.forEach((reqCol) => {
        if (!nawsRow[reqCol] || nawsRow[reqCol]!.trim() === '') {
          hasRequiredData = false;
          result.warnings.push(`Row ${i + 1}: Missing required field '${reqCol}'`);
        }
      });

      // Validate specific field formats
      if (nawsRow.day && !this.isValidDay(nawsRow.day)) {
        result.warnings.push(`Row ${i + 1}: Invalid day value '${nawsRow.day}'`);
        hasRequiredData = false;
      }

      if (nawsRow.time && !this.isValidTime(nawsRow.time)) {
        result.warnings.push(`Row ${i + 1}: Invalid time format '${nawsRow.time}'`);
        hasRequiredData = false;
      }

      if (nawsRow.longitude && !this.isValidCoordinate(nawsRow.longitude, -180, 180)) {
        result.warnings.push(`Row ${i + 1}: Invalid longitude '${nawsRow.longitude}'`);
      }

      if (nawsRow.latitude && !this.isValidCoordinate(nawsRow.latitude, -90, 90)) {
        result.warnings.push(`Row ${i + 1}: Invalid latitude '${nawsRow.latitude}'`);
      }

      if (hasRequiredData) {
        result.validRows++;
      }

      result.rows.push(nawsRow);
    }

    if (result.validRows === 0) {
      result.errors.push('No valid meeting data found in spreadsheet');
    }

    return result;
  }

  private static isValidDay(day: string): boolean {
    const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return validDays.includes(day.toLowerCase());
  }

  private static isValidTime(time: string): boolean {
    // Handle formats like "1930", "7:30", "730", etc.
    const timeStr = time.toString().replace(/[^0-9:]/g, '');

    // Try parsing as HHMM format (like 1930)
    if (timeStr.length === 3 || timeStr.length === 4) {
      const num = parseInt(timeStr);
      const hours = Math.floor(num / 100);
      const minutes = num % 100;
      return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
    }

    // Try parsing as HH:MM format
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      if (parts.length === 2) {
        const hours = parseInt(parts[0]);
        const minutes = parseInt(parts[1]);
        return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
      }
    }

    return false;
  }

  private static isValidCoordinate(coord: string, min: number, max: number): boolean {
    const num = parseFloat(coord);
    return !isNaN(num) && num >= min && num <= max;
  }

  static formatTimeForBMLT(time: string): string {
    const timeStr = time.toString().replace(/[^0-9:]/g, '');

    // Handle HHMM format
    if (timeStr.length === 3 || timeStr.length === 4) {
      const num = parseInt(timeStr);
      const hours = Math.floor(num / 100);
      const minutes = num % 100;
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    // Handle H:MM or HH:MM format
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      if (parts.length === 2) {
        const hours = parseInt(parts[0]);
        const minutes = parseInt(parts[1]);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      }
    }

    return '12:00'; // Default fallback
  }

  static mapDayToBMLT(day: string): number {
    const dayMap: { [key: string]: number } = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };

    return dayMap[day.toLowerCase()] ?? 0;
  }
}
