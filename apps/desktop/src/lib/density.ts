import { useCallback, useEffect, useState } from "react";

const DENSITY_KEY = "omni-sql:density";

export type Density = "comfortable" | "compact";

function loadDensity(): Density {
  try {
    const raw = localStorage.getItem(DENSITY_KEY);
    if (raw === "comfortable" || raw === "compact") return raw;
  } catch {
    // localStorage indisponível
  }
  return "comfortable";
}

export function useDensity(): { density: Density; setDensity: (density: Density) => void } {
  const [density, setDensityState] = useState<Density>(loadDensity);

  useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // localStorage indisponível/cheio
    }
  }, [density]);

  const setDensity = useCallback((next: Density) => setDensityState(next), []);
  return { density, setDensity };
}
