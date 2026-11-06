import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClasses } from './button';

export function LinkButton({ href, children, variant = 'primary', size = 'md', className }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)}>
      {children}
    </Link>
  );
}
