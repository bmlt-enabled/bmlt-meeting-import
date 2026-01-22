import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import LoginForm from '../components/LoginForm.svelte';
import { ApiCredentialsStore } from '../stores/apiCredentials';

// Mock fetch for server list
const mockServers = [
  { id: '1', name: 'Test Server', rootURL: 'https://test.bmlt.app/main_server/' },
  { id: '2', name: 'Another Server', rootURL: 'https://another.bmlt.app/main_server/' }
];

// Mock the RootServerApi module
vi.mock('../lib/ServerApi', () => ({
  default: {
    updateServerUrl: vi.fn(),
    handleErrors: vi.fn()
  }
}));

describe('LoginForm', () => {
  let mockApiCredentials: Partial<ApiCredentialsStore>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch for server list
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockServers)
    });

    // Create mock API credentials store
    mockApiCredentials = {
      login: vi.fn().mockResolvedValue({ accessToken: 'test-token', userId: 1, expiresAt: Date.now() / 1000 + 3600 })
    };
  });

  test('renders username and password inputs', async () => {
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  test('renders login button', async () => {
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  test('renders server URL label', async () => {
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    expect(screen.getByText(/root server url/i)).toBeInTheDocument();
  });

  test('loads server list on mount', async () => {
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('https://raw.githubusercontent.com/bmlt-enabled/tomato/refs/heads/master/rootServerList.json');
    });
  });

  test('allows user to type in username field', async () => {
    const user = userEvent.setup();

    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    const usernameInput = screen.getByLabelText(/username/i);
    await user.type(usernameInput, 'testuser');

    expect(usernameInput).toHaveValue('testuser');
  });

  test('allows user to type in password field', async () => {
    const user = userEvent.setup();

    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    const passwordInput = screen.getByLabelText(/password/i);
    await user.type(passwordInput, 'testpassword');

    expect(passwordInput).toHaveValue('testpassword');
  });

  test('shows loading state while fetching servers', () => {
    // Make fetch hang
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    expect(screen.getByText(/loading servers/i)).toBeInTheDocument();
  });

  test('handles server list fetch error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    await waitFor(() => {
      expect(screen.getByText(/failed to fetch server list/i)).toBeInTheDocument();
    });
  });
});
