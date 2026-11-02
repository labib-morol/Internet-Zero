import '@testing-library/jest-dom/vitest';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotebookWindow } from '../src/notebook/NotebookWindow.js';
import { useSessionStore } from '@iz/ui';

it('creates an investigation claim through the runtime dispatch', async () => {
  const dispatch = vi.fn(async () => ({}));
  useSessionStore.setState({ dispatch });
  render(<NotebookWindow />);
  fireEvent.change(screen.getByLabelText('New claim'), { target: { value: 'The commit predates the mail.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add claim' }));
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'claim', text: 'The commit predates the mail.', private: false }));
});
