export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="5" stroke="#5cc8f0" strokeWidth="1.5" />
        <path d="M8 12.5h8M12 8.5v8" stroke="#5cc8f0" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        <circle cx="12" cy="12" r="2.25" fill="#5cc8f0" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-fg">Cloakroom</span>
    </span>
  );
}
