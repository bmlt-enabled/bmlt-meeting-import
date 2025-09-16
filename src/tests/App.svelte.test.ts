import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import App from '../App.svelte';

describe('Time Machine', () => {
  test('initial screen', async () => {
    render(App);
    expect(screen.getByText('Great Scott!')).toBeInTheDocument();
  });

  test('select dropdown', async () => {
    render(App);
    const characterBox = screen.getByRole('combobox', { name: 'Choose your character...' }) as HTMLSelectElement;
    expect(characterBox.item(0)?.label).toBe('Choose character ...');
    await userEvent.selectOptions(characterBox, ['Marty McFly']);
  });

  test('input text', async () => {
    render(App);
    const timeTextBox = screen.getByLabelText('HH:MM:SS') as HTMLInputElement;
    expect(timeTextBox).toBeInTheDocument();
  });
});
