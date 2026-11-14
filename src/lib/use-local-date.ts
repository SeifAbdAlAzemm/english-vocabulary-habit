"use client";

import { useSyncExternalStore } from "react";
import { localDate } from "./model";

function subscribe(onChange: () => void) {
  // Refresh across midnight and when returning to a tab or changing OS timezone.
  const interval = window.setInterval(onChange, 30000);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

const browserSnapshot = () => localDate();
const serverSnapshot = () => null;

export function useLocalDate() {
  // A stable server/hydration snapshot keeps the browser's clock and timezone
  // outside the Cache Components prerender, without disabling SSR or caching.
  return useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
}
