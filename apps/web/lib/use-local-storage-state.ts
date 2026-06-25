"use client";

import { useCallback, useEffect, useState } from "react";

export function useLocalStorageState(
  key: string,
  defaultValue = "",
): [string, (next: string) => void] {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(stored);
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to in-memory
    }
  }, [key]);

  const set = useCallback(
    (next: string) => {
      setValue(next);
      try {
        if (!next || next === defaultValue) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, next);
        }
      } catch {
        // ignore
      }
    },
    [key, defaultValue],
  );

  return [value, set];
}
