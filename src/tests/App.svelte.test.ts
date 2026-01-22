import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import App from '../App.svelte';

describe('Import Meetings', () => {
  test('initial screen', async () => {
    render(App);
    expect(screen.getByText('Server')).toBeInTheDocument();
  });
});
