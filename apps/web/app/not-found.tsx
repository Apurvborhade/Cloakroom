import { LinkButton } from '@/components/ui/link-button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="font-mono text-sm text-fg-subtle">404</p>
      <h1 className="text-xl font-semibold text-fg">Page not found</h1>
      <LinkButton href="/" variant="secondary">Back to dashboard</LinkButton>
    </div>
  );
}
