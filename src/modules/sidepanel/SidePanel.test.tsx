import axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidePanel } from './SidePanel';

describe('SidePanel', () => {
  it('introduces the product and its local-first status', () => {
    render(<SidePanel />);

    expect(
      screen.getByRole('heading', { name: 'Match My Exp' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Make the web fit you.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Local-first by design')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<SidePanel />);
    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
