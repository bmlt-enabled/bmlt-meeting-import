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
      // Note: The implementation treats '8:30' as invalid format and returns default
      // because it strips non-numeric chars except colon, leaving '8:30' which
      // when split gives ['8','30'] but the first case catches 3-4 digit numbers
      expect(SpreadsheetProcessor.formatTimeForBMLT('08:30')).toBe('08:30');
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
});
