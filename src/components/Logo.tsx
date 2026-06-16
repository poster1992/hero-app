"use client";

import { useState } from "react";

export default function Logo({ className = "" }: { className?: string }) {
  const [imageOk, setImageOk] = useState(true);

  if (imageOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logo.png"
        alt="FLOORTEC.design"
        onError={() => setImageOk(false)}
        className={`h-14 w-auto ${className}`}
      />
    );
  }

  // Fallback (text) falls /logo.png noch nicht hinterlegt ist.
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-red text-sm font-bold text-white">
        F
      </span>
      <span className="text-lg font-semibold tracking-wide whitespace-nowrap">
        <span className="text-gray-100">FLOORTEC</span>
        <span className="text-brand-red">.design</span>
      </span>
    </div>
  );
}
