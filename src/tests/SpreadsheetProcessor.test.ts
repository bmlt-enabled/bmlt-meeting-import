import { describe, test, expect } from 'vitest';
import { SpreadsheetProcessor } from '../lib/SpreadsheetProcessor';

describe('SpreadsheetProcessor', () => {
  describe('formatTimeForBMLT', () => {
    test('formats 4-digit HHMM time correctly', () => {
      expect(SpreadsheetProcessor.formatTimeForBMLT('1930')).toBe('19:30');
      expect(SpreadsheetProcessor.formatTimeForBMLT('0830')).toBe('08:30');
      expect(SpreadsheetProcessor.formatTimeForBMLT('0000')).toBe('00:00');
      expect(SpreadsheetProcessor.formatTimeForBMLT('2359')).toBe('23:59');
    });

    test('formats 3-digit HMM time correctly', () => {
      expect(SpreadsheetProcessor.formatTimeForBMLT('930')).toBe('09:30');
      expect(SpreadsheetProcessor.formatTimeForBMLT('800')).toBe('08:00');
      expect(SpreadsheetProcessor.formatTimeForBMLT('115')).toBe('01:15');
    });

    test('formats HH:MM time correctly', () => {
      expect(SpreadsheetProcessor.formatTimeForBMLT('19:30')).toBe('19:30');
      expect(SpreadsheetProcessor.formatTimeForBMLT('12:00')).toBe('12:00');
      expect(SpreadsheetProcessor.formatTimeForBMLT('0:00')).toBe('00:00');
    });

    test('formats single digit hour with colon', () => {
      expect(SpreadsheetProcessor.formatTimeForBMLT('08:30')).toBe('08:30');
      expect(SpreadsheetProcessor.formatTimeForBMLT('8:30')).toBe('08:30');
      expect(SpreadsheetProcessor.formatTimeForBMLT('7:05')).toBe('07:05');
      expect(SpreadsheetProcessor.formatTimeForBMLT('9:00:00')).toBe('09:00');
    });

    test('formats a fraction of a day, as an Excel time cell arrives', () => {
      expect(SpreadsheetProcessor.formatTimeForBMLT('0.8125')).toBe('19:30');
      expect(SpreadsheetProcessor.formatTimeForBMLT('0.375')).toBe('09:00');
      expect(SpreadsheetProcessor.formatTimeForBMLT('0.9993055555555556')).toBe('23:59');
      expect(SpreadsheetProcessor.formatTimeForBMLT('0.99999')).toBe('12:00');
    });

    test('returns default for out-of-range time', () => {
      expect(SpreadsheetProcessor.formatTimeForBMLT('2460')).toBe('12:00');
      expect(SpreadsheetProcessor.formatTimeForBMLT('25:00')).toBe('12:00');
      expect(SpreadsheetProcessor.formatTimeForBMLT('12345')).toBe('12:00');
    });

    test('returns default for invalid time', () => {
      expect(SpreadsheetProcessor.formatTimeForBMLT('')).toBe('12:00');
      expect(SpreadsheetProcessor.formatTimeForBMLT('invalid')).toBe('12:00');
    });
  });

  describe('mapDayToBMLT', () => {
    test('maps days correctly', () => {
      expect(SpreadsheetProcessor.mapDayToBMLT('Sunday')).toBe(0);
      expect(SpreadsheetProcessor.mapDayToBMLT('Monday')).toBe(1);
      expect(SpreadsheetProcessor.mapDayToBMLT('Tuesday')).toBe(2);
      expect(SpreadsheetProcessor.mapDayToBMLT('Wednesday')).toBe(3);
      expect(SpreadsheetProcessor.mapDayToBMLT('Thursday')).toBe(4);
      expect(SpreadsheetProcessor.mapDayToBMLT('Friday')).toBe(5);
      expect(SpreadsheetProcessor.mapDayToBMLT('Saturday')).toBe(6);
    });

    test('handles case insensitivity', () => {
      expect(SpreadsheetProcessor.mapDayToBMLT('SUNDAY')).toBe(0);
      expect(SpreadsheetProcessor.mapDayToBMLT('sunday')).toBe(0);
      expect(SpreadsheetProcessor.mapDayToBMLT('SuNdAy')).toBe(0);
    });

    test('returns 0 for unknown days', () => {
      expect(SpreadsheetProcessor.mapDayToBMLT('InvalidDay')).toBe(0);
      expect(SpreadsheetProcessor.mapDayToBMLT('')).toBe(0);
    });
  });

  describe('parseDuration', () => {
    test('parses clock formats', () => {
      expect(SpreadsheetProcessor.parseDuration('1:30')).toBe('01:30');
      expect(SpreadsheetProcessor.parseDuration('01:30')).toBe('01:30');
      expect(SpreadsheetProcessor.parseDuration('01:30:00')).toBe('01:30');
      expect(SpreadsheetProcessor.parseDuration('02:00')).toBe('02:00');
    });

    test('parses a bare number as minutes', () => {
      expect(SpreadsheetProcessor.parseDuration('90')).toBe('01:30');
      expect(SpreadsheetProcessor.parseDuration('60')).toBe('01:00');
      expect(SpreadsheetProcessor.parseDuration('45')).toBe('00:45');
    });

    test('parses a fraction of a day, as an Excel time cell arrives', () => {
      expect(SpreadsheetProcessor.parseDuration('0.0625')).toBe('01:30');
      expect(SpreadsheetProcessor.parseDuration('0.04166666666666674')).toBe('01:00');
    });

    test('returns undefined for values it cannot understand', () => {
      expect(SpreadsheetProcessor.parseDuration('')).toBeUndefined();
      expect(SpreadsheetProcessor.parseDuration('an hour')).toBeUndefined();
      expect(SpreadsheetProcessor.parseDuration('1:75')).toBeUndefined();
      expect(SpreadsheetProcessor.parseDuration('0')).toBeUndefined();
      expect(SpreadsheetProcessor.parseDuration('2000')).toBeUndefined();
    });
  });

  describe('parseVenueType', () => {
    test('parses numeric and named venue types', () => {
      expect(SpreadsheetProcessor.parseVenueType('1')).toBe(1);
      expect(SpreadsheetProcessor.parseVenueType('In-Person')).toBe(1);
      expect(SpreadsheetProcessor.parseVenueType('2')).toBe(2);
      expect(SpreadsheetProcessor.parseVenueType('VIRTUAL')).toBe(2);
      expect(SpreadsheetProcessor.parseVenueType('3')).toBe(3);
      expect(SpreadsheetProcessor.parseVenueType('hybrid')).toBe(3);
    });

    test('returns undefined for unknown venue types', () => {
      expect(SpreadsheetProcessor.parseVenueType('4')).toBeUndefined();
      expect(SpreadsheetProcessor.parseVenueType('somewhere')).toBeUndefined();
      expect(SpreadsheetProcessor.parseVenueType('')).toBeUndefined();
    });
  });

  describe('parseBoolean', () => {
    test('parses truthy and falsy spellings', () => {
      expect(SpreadsheetProcessor.parseBoolean('TRUE')).toBe(true);
      expect(SpreadsheetProcessor.parseBoolean('yes')).toBe(true);
      expect(SpreadsheetProcessor.parseBoolean('1')).toBe(true);
      expect(SpreadsheetProcessor.parseBoolean('false')).toBe(false);
      expect(SpreadsheetProcessor.parseBoolean('N')).toBe(false);
      expect(SpreadsheetProcessor.parseBoolean('0')).toBe(false);
    });

    test('returns undefined for unrecognized values', () => {
      expect(SpreadsheetProcessor.parseBoolean('maybe')).toBeUndefined();
      expect(SpreadsheetProcessor.parseBoolean('')).toBeUndefined();
    });
  });

  describe('processFile', () => {
    test('reads Excel time cells in an .xlsx file', async () => {
      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.aoa_to_sheet([
        HEADER.split(','),
        // Time and Duration as real Excel times: 19:30 and 1:30.
        [
          '',
          'A',
          'Area Test',
          'AR1',
          'Monday',
          0.8125,
          0.0625,
          2,
          false,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'CLOSED',
          false,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'https://example.com/j/1',
          '',
          'Europe/Rome',
          ''
        ]
      ]);
      sheet['F2'].z = 'hh:mm';
      sheet['G2'].z = 'hh:mm';
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
      const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
      const result = await SpreadsheetProcessor.processFile(new File([bytes], 'meetings.xlsx'));

      expect(result.warnings).toEqual([]);
      expect(SpreadsheetProcessor.formatTimeForBMLT(result.rows[0].time!)).toBe('19:30');
      expect(SpreadsheetProcessor.parseDuration(result.rows[0].duration!)).toBe('01:30');
      expect(SpreadsheetProcessor.parseBoolean(result.rows[0].published!)).toBe(false);
    });

    const HEADER =
      'Committee,CommitteeName,ParentName,AreaRegion,Day,Time,Duration,VenueType,Published,Place,Address,City,LocBorough,State,Zip,Country,Directions,Room,Closed,WheelChr,Format1,Format2,Format3,Format4,Format5,Longitude,Latitude,PhoneMeetingNumber,VirtualMeetingLink,VirtualMeetingInfo,TimeZone,Delete';

    const row = (name: string, duration: string, published: string, zip = '') =>
      `,${name},Area Test,AR1,Sunday,0900,${duration},2,${published},,,,,,${zip},,,,CLOSED,FALSE,,,,,,,,,https://example.com/j/1,,Europe/Rome,`;

    const csvFile = (lines: string[], { bom = false, encoding = 'utf-8' } = {}) => {
      const text = lines.join('\r\n');
      let bytes: Uint8Array<ArrayBuffer>;
      if (encoding === 'windows-1252') {
        // Every character used here is in Latin-1, which matches 1252 for them.
        bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
      } else {
        bytes = new TextEncoder().encode(text);
      }
      const parts: BlobPart[] = bom ? [new Uint8Array([0xef, 0xbb, 0xbf]), bytes] : [bytes];
      return new File(parts, 'meetings.csv', { type: 'text/csv' });
    };

    test('reads UTF-8 without a BOM', async () => {
      const result = await SpreadsheetProcessor.processFile(csvFile([HEADER, row("Roma c'è!", '90', 'yes'), row('Группа МилАН', '90', 'yes')]));
      expect(result.rows.map((r) => r.committeename)).toEqual(["Roma c'è!", 'Группа МилАН']);
    });

    test('reads UTF-8 with a BOM without mangling the first header', async () => {
      const result = await SpreadsheetProcessor.processFile(csvFile([HEADER, row("Roma c'è!", '90', 'yes')], { bom: true }));
      expect(result.errors).toEqual([]);
      expect(result.rows[0].committeename).toBe("Roma c'è!");
    });

    test('falls back to Windows-1252 when the bytes are not UTF-8', async () => {
      const result = await SpreadsheetProcessor.processFile(csvFile([HEADER, row('Libertà Online', '90', 'yes')], { encoding: 'windows-1252' }));
      expect(result.rows[0].committeename).toBe('Libertà Online');
    });

    test('keeps cells as literal text', async () => {
      const result = await SpreadsheetProcessor.processFile(csvFile([HEADER, row('A', '01:30', 'TRUE', '00185'), row('B', '01:00', 'FALSE')]));
      expect(result.warnings).toEqual([]);
      expect(result.rows[0]).toMatchObject({ time: '0900', duration: '01:30', published: 'TRUE', zip: '00185' });
      expect(result.rows[1]).toMatchObject({ duration: '01:00', published: 'FALSE' });
      expect(SpreadsheetProcessor.parseBoolean(result.rows[1].published!)).toBe(false);
    });

    test('imports a sheet without a ParentName column', async () => {
      const dropParent = (line: string) =>
        line
          .split(',')
          .filter((_, i) => i !== 2)
          .join(',');
      const result = await SpreadsheetProcessor.processFile(csvFile([dropParent(HEADER), dropParent(row('A', '90', 'yes'))]));
      expect(result.errors).toEqual([]);
      expect(result.validRows).toBe(1);
      expect(result.rows[0].parentname).toBeUndefined();
    });
  });
});
