"use client";

import { Loader2 } from "lucide-react";

/**
 * Generic loading skeleton for the entity workspace.
 * Provides immediate visual feedback during route transitions.
 */
export default function EntityLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Loader2 className="w-10 h-10 animate-spin text-primary opacity-20" />
      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-[0.2em] animate-pulse">
        Chargement de l'espace...
      </p>
    </div>
  );
}
