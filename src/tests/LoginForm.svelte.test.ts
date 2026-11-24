import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import LoginForm from '../components/LoginForm.svelte';
import { ApiCredentialsStore } from '../stores/apiCredentials';
import RootServerApi from '../lib/ServerApi';

// Mock fetch for server list
const mockServers = [
  { id: '1', name: 'Test Server', rootURL: 'https://test.bmlt.app/main_server/' },
  { id: '2', name: 'Another Server', rootURL: 'https://another.bmlt.app/main_server/' }
];

// Mock the RootServerApi module
vi.mock('../lib/ServerApi', () => ({
  default: {
    updateServerUrl: vi.fn(),
    handleErrors: vi.fn(),
    // The server chosen on an earlier visit; '' when there isn't one
    currentServerUrl: ''
  }
}));

describe('LoginForm', () => {
  let mockApiCredentials: Partial<ApiCredentialsStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    (RootServerApi as { currentServerUrl: string }).currentServerUrl = '';

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

    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  test('renders server label', async () => {
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    expect(screen.getByText(/your bmlt server/i)).toBeInTheDocument();
  });

  test('starts with no server chosen and login disabled', async () => {
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    const select = await screen.findByLabelText(/your bmlt server/i);
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: /choose your server/i })).toBeInTheDocument();
    expect(screen.queryByText(/latest\.aws\.bmlt\.app/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeDisabled();
  });

  test('choosing a server enables login and logs in to that server', async () => {
    const user = userEvent.setup();
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    await user.selectOptions(await screen.findByLabelText(/your bmlt server/i), 'Another Server');
    const button = screen.getByRole('button', { name: /log in/i });
    expect(button).toBeEnabled();
    expect(RootServerApi.updateServerUrl).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/password/i), 'secret');
    await user.click(button);

    await waitFor(() => expect(mockApiCredentials.login).toHaveBeenCalledWith('admin', 'secret'));
    expect(RootServerApi.updateServerUrl).toHaveBeenCalledWith('https://another.bmlt.app/main_server/');
  });

  test('a typed-in server URL enables login', async () => {
    const user = userEvent.setup();
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    await user.selectOptions(await screen.findByLabelText(/your bmlt server/i), 'other');
    const button = screen.getByRole('button', { name: /log in/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/^server url$/i), 'https://bmlt.example.org/main_server');
    expect(button).toBeEnabled();
  });

  test('preselects the server chosen on an earlier visit', async () => {
    (RootServerApi as { currentServerUrl: string }).currentServerUrl = 'https://test.bmlt.app/main_server';
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    await waitFor(() => expect(screen.getByLabelText(/your bmlt server/i)).toHaveValue('1'));
    expect(screen.getByRole('button', { name: /log in/i })).toBeEnabled();
  });

  test('shows a remembered custom server URL in the URL field', async () => {
    (RootServerApi as { currentServerUrl: string }).currentServerUrl = 'https://bmlt.example.org/main_server';
    render(LoginForm, {
      props: {
        apiCredentials: mockApiCredentials as ApiCredentialsStore
      }
    });

    expect(await screen.findByLabelText(/^server url$/i)).toHaveValue('https://bmlt.example.org/main_server/');
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
