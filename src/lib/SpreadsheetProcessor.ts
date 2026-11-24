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
  duration?: string;
  venuetype?: string;
  published?: string;
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

  // parentname is only used to name service bodies that need creating, so a
  // sheet without it still imports. duration/venuetype/published are not part
  // of the NAWS export format: when supplied they override the per-import
  // defaults; when absent nothing changes.
  private static readonly OPTIONAL_COLUMNS = ['parentname', 'duration', 'venuetype', 'published'];

  private static readonly REQUIRED_COLUMNS = ['committeename', 'arearegion', 'day', 'time'];

  static async processFile(file: File, onProgress?: (message: string) => void): Promise<ProcessedSpreadsheet> {
    try {
      onProgress?.('Reading file...');
      const buffer = await file.arrayBuffer();

      onProgress?.('Parsing spreadsheet...');
      // Text files are decoded here instead of by SheetJS, which reads a CSV
      // without a BOM as Latin-1. raw keeps every cell as the literal text, so
      // 01:30 stays 01:30, FALSE stays FALSE and 0900 keeps its leading zero.
      let workbook = this.isTextFile(file) ? XLSX.read(this.decodeText(buffer), { type: 'string', raw: true, dense: true }) : XLSX.read(buffer, { type: 'array', dense: true });

      onProgress?.('Processing data...');
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];

      workbook = null as any;

      onProgress?.('Validating and processing...');
      return this.validateAndProcess(rawData);
    } catch (error) {
      throw new Error(`Error processing spreadsheet: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  private static isTextFile(file: File): boolean {
    return /\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith('text/');
  }

  /** UTF-8 (BOM optional), falling back to Windows-1252 for bytes that aren't valid UTF-8. */
  private static decodeText(buffer: ArrayBuffer): string {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return new TextDecoder('windows-1252').decode(buffer);
    }
  }

  private static validateAndProcess(rawData: string[][]): ProcessedSpreadsheet {
    // Filter out empty rows first
    const nonEmptyRows = rawData.filter((row, index) => {
      if (index === 0) return true; // Always include header
      return row && row.some((cell) => cell !== undefined && cell !== null && cell.toString().trim() !== '');
    });

    const result: ProcessedSpreadsheet = {
      rows: [],
      totalRows: nonEmptyRows.length - 1, // Exclude header
      validRows: 0,
      errors: [],
      warnings: []
    };

    // Get and normalize headers
    const headers = nonEmptyRows[0].map((header) => (header ? header.toString().toLowerCase().trim() : ''));

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

    this.OPTIONAL_COLUMNS.forEach((optionalCol) => {
      const index = headers.indexOf(optionalCol);
      if (index !== -1) {
        columnMap[optionalCol] = index;
      }
    });

    const presentColumns = [...this.EXPECTED_COLUMNS, ...this.OPTIONAL_COLUMNS.filter((col) => columnMap[col] !== undefined)];

    // Process each data row
    for (let i = 1; i < nonEmptyRows.length; i++) {
      const row = nonEmptyRows[i];

      // Simple empty row check
      if (!row || row.length === 0) {
        continue;
      }

      const nawsRow: NAWSRow = {};
      let hasRequiredData = true;

      // Map columns to NAWS format
      presentColumns.forEach((colName) => {
        const colIndex = columnMap[colName];
        if (colIndex !== undefined && colIndex < row.length) {
          const cellValue = row[colIndex];
          // Not a truthiness check: boolean false and 0 are real values.
          nawsRow[colName] = cellValue === undefined || cellValue === null ? '' : String(cellValue).trim();
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

      // Optional overrides fall back to the import defaults when unusable, so
      // these only warn.
      if (nawsRow.duration && !this.parseDuration(nawsRow.duration)) {
        result.warnings.push(`Row ${i + 1}: Invalid duration '${nawsRow.duration}' - using the default duration`);
      }

      if (nawsRow.venuetype && !this.parseVenueType(nawsRow.venuetype)) {
        result.warnings.push(`Row ${i + 1}: Invalid venue type '${nawsRow.venuetype}' - venue type will be detected from the row`);
      }

      if (nawsRow.published && this.parseBoolean(nawsRow.published) === undefined) {
        result.warnings.push(`Row ${i + 1}: Invalid published value '${nawsRow.published}' - using the default`);
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
    return this.parseTime(time) !== undefined;
  }

  private static isValidCoordinate(coord: string, min: number, max: number): boolean {
    const num = parseFloat(coord);
    return !isNaN(num) && num >= min && num <= max;
  }

  static formatTimeForBMLT(time: string): string {
    return this.parseTime(time) ?? '12:00'; // Default fallback
  }

  /**
   * Accepts 'HH:MM' / 'H:MM' (optionally with seconds or am/pm), 'HHMM' / 'HMM',
   * or a fraction of a day ('0.8125'), which is how an Excel time cell arrives.
   * Returns 'HH:MM', or undefined when the value can't be understood.
   */
  private static parseTime(time: string): string | undefined {
    const value = time.toString().trim();

    let hours: number;
    let minutes: number;

    const fraction = this.dayFractionToMinutes(value);
    if (fraction !== undefined) {
      hours = Math.floor(fraction / 60);
      minutes = fraction % 60;
    } else {
      // Drop anything but digits and colons (e.g. a trailing 'pm' is ignored).
      const timeStr = value.replace(/[^0-9:]/g, '');

      // The colon check must come first: '7:30' is four characters long and
      // would otherwise be read as HHMM.
      const clockMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (clockMatch) {
        hours = parseInt(clockMatch[1], 10);
        minutes = parseInt(clockMatch[2], 10);
      } else if (/^\d{3,4}$/.test(timeStr)) {
        const num = parseInt(timeStr, 10);
        hours = Math.floor(num / 100);
        minutes = num % 100;
      } else {
        return undefined;
      }
    }

    if (hours > 23 || minutes > 59) {
      return undefined;
    }

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  /** '0.0625' -> 90. Undefined unless the value is a fraction of a day below 1. */
  private static dayFractionToMinutes(value: string): number | undefined {
    if (!/^0?\.\d+$/.test(value)) {
      return undefined;
    }

    const minutes = Math.round(parseFloat(value) * 24 * 60);
    // Rounding can push a value just under 1 up to a full day.
    return minutes < 24 * 60 ? minutes : undefined;
  }

  /**
   * Accepts 'HH:MM', 'HH:MM:SS', a whole number of minutes ('90'), or a
   * fraction of a day ('0.0625'), which is how an Excel time cell arrives.
   * Returns 'HH:MM', or undefined when the value can't be understood.
   */
  static parseDuration(duration: string): string | undefined {
    const value = duration.toString().trim();
    if (!value) {
      return undefined;
    }

    const clockMatch = value.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
    if (clockMatch) {
      return `${clockMatch[1].padStart(2, '0')}:${clockMatch[2]}`;
    }

    let minutes: number | undefined;
    if (/^\d+$/.test(value)) {
      minutes = parseInt(value, 10);
    } else {
      minutes = this.dayFractionToMinutes(value);
    }

    if (minutes !== undefined) {
      // Anything past a day is a typo, not a meeting.
      if (minutes > 0 && minutes < 24 * 60) {
        return `${Math.floor(minutes / 60)
          .toString()
          .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
      }
    }

    return undefined;
  }

  /** Accepts 1/2/3 or in-person/virtual/hybrid. */
  static parseVenueType(venueType: string): number | undefined {
    const value = venueType.toString().trim().toLowerCase();

    const named: { [key: string]: number } = {
      '1': 1,
      'in-person': 1,
      inperson: 1,
      'in person': 1,
      face_to_face: 1,
      '2': 2,
      virtual: 2,
      online: 2,
      '3': 3,
      hybrid: 3
    };

    return named[value];
  }

  /** Accepts TRUE/FALSE, 1/0, yes/no. Undefined when unrecognized. */
  static parseBoolean(value: string): boolean | undefined {
    const normalized = value.toString().trim().toLowerCase();

    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }

    return undefined;
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
