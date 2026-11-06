import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { floorToStep, isStepInput, stepAmount } from '@/lib/format/steps';

vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('wagmi', () => ({ useSwitchChain: () => ({}) }));
vi.mock('@/hooks/use-enclave', () => ({ useEnclave: () => ({}) }));
vi.mock('@/hooks/use-owner', () => ({ useOwner: () => ({}) }));
vi.mock('@/hooks/use-private-data', () => ({ useBalances: () => ({}) }));
vi.mock('@/hooks/use-session', () => ({ useSession: () => ({}) }));
vi.mock('@/lib/config', () => ({ appConfig: {} }));

const { AmountBox } = await import('@/components/simple/parts');

describe('0.01 steps', () => {
  it.each(['', '0', '0.', '.5', '0.01', '12.34'])('allows typing %s', (text) => {
    expect(isStepInput(text)).toBe(true);
  });

  it.each(['0.015', '1.234', 'abc', '1,5', '-1', '1e2', '0.0.1'])('refuses typing %s', (text) => {
    expect(isStepInput(text)).toBe(false);
  });

  it('moves up and down by exactly one step, without rounding errors', () => {
    expect(stepAmount('', 1)).toBe('0.01');
    expect(stepAmount('0.01', 1)).toBe('0.02');
    expect(stepAmount('0.07', 1)).toBe('0.08');
    expect(stepAmount('0.29', 1)).toBe('0.30');
    expect(stepAmount('0.99', 1)).toBe('1.00');
    expect(stepAmount('1', 1)).toBe('1.01');
    expect(stepAmount('0.5', -1)).toBe('0.49');
  });

  it('clears the field instead of going to zero or below', () => {
    expect(stepAmount('0.01', -1)).toBe('');
    expect(stepAmount('', -1)).toBe('');
  });

  it('rounds a balance down to whole steps', () => {
    expect(floorToStep(19_999_999_999_999_999n, 18)).toBe('0.01');
    expect(floorToStep(10n ** 16n, 18)).toBe('0.01');
    expect(floorToStep(258_268_122n, 6)).toBe('258.26');
    expect(floorToStep(9_999_999_999_999_999n, 18)).toBeNull();
  });
});

describe('amount box', () => {
  function Harness() {
    const [value, setValue] = useState('');
    return <AmountBox id="amount" label="Amount" symbol="ETH" value={value} onChange={setValue} />;
  }
  const input = () => screen.getByLabelText('Amount') as HTMLInputElement;

  it('steps with the buttons and the arrow keys', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase by 0.01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase by 0.01' }));
    expect(input().value).toBe('0.02');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().value).toBe('0.03');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('button', { name: 'Decrease by 0.01' }));
    expect(input().value).toBe('0.01');
  });

  it('ignores typing that is not a whole step', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: '0.01' } });
    expect(input().value).toBe('0.01');
    fireEvent.change(input(), { target: { value: '0.015' } });
    expect(input().value).toBe('0.01');
  });
});
