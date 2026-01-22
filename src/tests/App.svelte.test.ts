import { describe, test, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';

// Mock the stores before importing App
vi.mock('../stores/apiCredentials', () => ({
  apiCredentials: {
    subscribe: vi.fn((callback) => {
      callback(null);
      return () => {};
    }),
    login: vi.fn(),
    logout: vi.fn(),
    isLoggedIn: false
  },
  authenticatedUser: {
    subscribe: vi.fn((callback) => {
      callback(null);
      return () => {};
    })
  },
  isLoggedIn: {
    subscribe: vi.fn((callback) => {
      callback(false);
      return () => {};
    })
  },
  currentServerUrl: {
    subscribe: vi.fn((callback) => {
      callback('https://test.bmlt.app/main_server/');
      return () => {};
    }),
    set: vi.fn()
  }
}));

vi.mock('../lib/ServerApi', () => ({
  default: {
    updateServerUrl: vi.fn(),
    handleErrors: vi.fn(),
    currentServerUrl: 'https://test.bmlt.app/main_server/'
  }
}));

vi.mock('../lib/MeetingImportService', () => ({
  MeetingImportService: {
    getSupportedFileTypes: vi.fn().mockReturnValue(['.xlsx', '.xls', '.csv', '.ods']),
    getMaxFileSize: vi.fn().mockReturnValue(10 * 1024 * 1024),
    validateFile: vi.fn(),
    importFromFile: vi.fn()
  }
}));

vi.mock('../stores/errorModal', () => ({
  errorModal: {
    show: vi.fn()
  }
}));

import App from '../App.svelte';

describe('Import Meetings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders Import Meetings heading', async () => {
    render(App);
    expect(screen.getByRole('heading', { name: /import meetings/i })).toBeInTheDocument();
  });

  test('shows server URL display', async () => {
    render(App);
    expect(screen.getByText(/server:/i)).toBeInTheDocument();
  });
});
