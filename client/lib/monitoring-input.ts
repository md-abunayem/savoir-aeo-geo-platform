export const monitoringEngines = ["openrouter", "gemini", "openai", "google_ai_overviews", "google_ai_mode"] as const;
export type MonitoringEngine = typeof monitoringEngines[number];
export interface RunSelection {
  engine: MonitoringEngine;
  promptIds: string[];
  geos: string[];
  languages: string[];
  samples: number;
}
export function runSelection(
  promptIds: string[],
  countries: string,
  languages: string,
  samples: number,
  engine: string = "gemini",
): RunSelection {
  if (!monitoringEngines.includes(engine as MonitoringEngine)) throw new Error("Choose a supported AI engine.");
  const geos = countries.split(",").map((v) => v.trim().toUpperCase());
  const locales = languages.split(",").map((v) => v.trim());
  if (
    promptIds.length < 1 ||
    promptIds.length > 100 ||
    new Set(promptIds).size !== promptIds.length
  )
    throw new Error("Select between 1 and 100 different active prompts.");
  if (!Number.isInteger(samples) || samples < 1 || samples > 5)
    throw new Error("Choose 1 to 5 samples.");
  if (
    geos.length > 10 ||
    !geos.every((v) => /^[A-Z]{2}$/.test(v)) ||
    new Set(geos).size !== geos.length
  )
    throw new Error(
      "Enter up to 10 different two-letter country codes, separated by commas.",
    );
  if (
    locales.length > 10 ||
    !locales.every((v) => /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(v)) ||
    new Set(locales).size !== locales.length
  )
    throw new Error(
      "Enter up to 10 different language codes, such as en or en-US.",
    );
  if (promptIds.length * geos.length * locales.length * samples > 500)
    throw new Error(
      "A batch can contain at most 500 runs. Reduce prompts, markets or samples.",
    );
  return {
    engine: engine as MonitoringEngine,
    promptIds: [...promptIds].sort(),
    geos,
    languages: locales,
    samples,
  };
}
export function pendingRunKey<T extends RunSelection>(
  projectId: string,
  input: T,
  storage: Pick<Storage, "getItem" | "setItem">,
  operation: "run" | "schedule" = "run",
): string {
  const storageKey = `savoir.pending-${operation}.` + projectId;
  const fingerprint = JSON.stringify(input);
  try {
    const previous = JSON.parse(storage.getItem(storageKey) ?? "null") as {
      fingerprint?: string;
      key?: string;
    } | null;
    if (
      previous?.fingerprint === fingerprint &&
      typeof previous.key === "string" &&
      /^[a-zA-Z0-9_-]{8,100}$/.test(previous.key)
    )
      return previous.key;
  } catch {
    /* Corrupt optional retry metadata is replaced. */
  }
  const key = crypto.randomUUID();
  storage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
  return key;
}
