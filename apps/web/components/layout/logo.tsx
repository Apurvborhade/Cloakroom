export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="#8b9bff" />
        <path d="M10.5 23v-7.5a5.5 5.5 0 0 1 11 0V23" stroke="#131313" strokeWidth="3.4" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-fg">
        nony<span className="text-fg-subtle">.money</span>
      </span>
    </span>
  );
}
