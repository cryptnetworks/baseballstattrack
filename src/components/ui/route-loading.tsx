type RouteLoadingProps = {
  label: string;
};

export function RouteLoading({ label }: RouteLoadingProps) {
  return (
    <main
      aria-busy="true"
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      id="main-content"
      tabIndex={-1}
    >
      <div
        aria-atomic="true"
        aria-live="polite"
        className="rounded-xl border border-[var(--line)] bg-white p-6"
        role="status"
      >
        <p className="font-medium">{label}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          This page will update when current data is ready.
        </p>
        <div
          aria-hidden="true"
          className="route-loading-bar mt-4 h-2 max-w-md rounded-full bg-slate-200"
        />
      </div>
    </main>
  );
}
