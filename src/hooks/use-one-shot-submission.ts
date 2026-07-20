"use client";

import { useCallback, useRef } from "react";

export function useOneShotSubmission() {
  const startedRef = useRef(false);

  const tryStartSubmission = useCallback(() => {
    if (startedRef.current) {
      return false;
    }

    startedRef.current = true;
    return true;
  }, []);

  const resetSubmission = useCallback(() => {
    startedRef.current = false;
  }, []);

  return {
    tryStartSubmission,
    resetSubmission,
  };
}
