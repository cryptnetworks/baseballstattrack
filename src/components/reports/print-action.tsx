"use client";

export function PrintAction() {
  return (
    <button
      className="print-action min-h-11 rounded-lg border border-slate-500 bg-white px-4 font-semibold text-slate-950 print:hidden"
      onClick={() => window.print()}
      type="button"
    >
      Print report
    </button>
  );
}
