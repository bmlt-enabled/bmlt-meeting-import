import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import MeetingImport from '../components/MeetingImport.svelte';

// Mock the stores
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
    })
  }
}));

// Mock the RootServerApi module
vi.mock('../lib/ServerApi', () => ({
  default: {
    updateServerUrl: vi.fn(),
    handleErrors: vi.fn(),
    currentServerUrl: 'https://test.bmlt.app/main_server/'
  }
}));

// Mock the MeetingImportService
vi.mock('../lib/MeetingImportService', () => ({
  MeetingImportService: {
    getSupportedFileTypes: vi.fn().mockReturnValue(['.xlsx', '.xls', '.csv', '.ods']),
    getMaxFileSize: vi.fn().mockReturnValue(10 * 1024 * 1024),
    validateFile: vi.fn(),
    importFromFile: vi.fn()
  }
}));

describe('MeetingImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders the Import Meetings heading', () => {
    render(MeetingImport);

    expect(screen.getByRole('heading', { name: /import meetings/i })).toBeInTheDocument();
  });

  test('renders login button when not logged in', () => {
    render(MeetingImport);

    expect(screen.getByRole('button', { name: /login to server/i })).toBeInTheDocument();
  });

  test('displays server URL', () => {
    render(MeetingImport);

    expect(screen.getByText(/server:/i)).toBeInTheDocument();
  });

  test('shows helper text when not logged in', () => {
    render(MeetingImport);

    expect(screen.getByText(/please log in to import meetings/i)).toBeInTheDocument();
  });
});

describe('MeetingImport - Logged In', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Override the mock for logged in state
    vi.doMock('../stores/apiCredentials', () => ({
      apiCredentials: {
        subscribe: vi.fn((callback) => {
          callback({ accessToken: 'test-token', userId: 1, expiresAt: Date.now() / 1000 + 3600 });
          return () => {};
        }),
        login: vi.fn(),
        logout: vi.fn(),
        isLoggedIn: true
      },
      authenticatedUser: {
        subscribe: vi.fn((callback) => {
          callback({ id: 1, username: 'testuser', displayName: 'Test User', type: 'admin', ownerId: null });
          return () => {};
        })
      },
      isLoggedIn: {
        subscribe: vi.fn((callback) => {
          callback(true);
          return () => {};
        })
      },
      currentServerUrl: {
        subscribe: vi.fn((callback) => {
          callback('https://test.bmlt.app/main_server/');
          return () => {};
        })
      }
    }));
  });

  test('renders the Import Meetings heading', () => {
    render(MeetingImport);

    expect(screen.getByRole('heading', { name: /import meetings/i })).toBeInTheDocument();
  });
});
