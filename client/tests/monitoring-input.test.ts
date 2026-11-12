import { it, expect } from "vitest";
import { runSelection, pendingRunKey } from "../lib/monitoring-input";
it("validates combinations and enforces the 500-run limit", () => {
  expect(runSelection(["p"], "us, GB", "en, fr", 2)).toMatchObject({
    geos: ["US", "GB"],
    samples: 2,
  });
  expect(() => runSelection([], "US", "en", 1)).toThrow();
  expect(() => runSelection(["p"], "US,US", "en", 1)).toThrow();
  expect(() => runSelection(["p"], "US", "english", 1)).toThrow();
  expect(() => runSelection(["p"], "US", "en", 6)).toThrow();
  expect(() =>
    runSelection(
      Array.from({ length: 100 }, (_, i) => String(i)),
      "US,GB",
      "en",
      5,
    ),
  ).toThrow("500");
});
it("persists the same idempotency key across retries and changes it for new selections", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const input = runSelection(["a", "b"], "US", "en", 3);
  const first = pendingRunKey("project", input, storage);
  expect(
    pendingRunKey("project", runSelection(["b", "a"], "US", "en", 3), storage),
  ).toBe(first);
  expect(pendingRunKey("project", { ...input, samples: 1 }, storage)).not.toBe(
    first,
  );
  expect(pendingRunKey("other-project", input, storage)).not.toBe(first);
});

it("includes engine and cadence in retry identity and separates schedules from manual runs", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const input = runSelection(["p"], "US", "en", 1, "openai");
  expect(input.engine).toBe("openai");
  expect(() => runSelection(["p"], "US", "en", 1, "unsupported")).toThrow("supported");
  const daily = { ...input, cadence: "daily" };
  const key = pendingRunKey("project", daily, storage, "schedule");
  expect(pendingRunKey("project", daily, storage, "schedule")).toBe(key);
  expect(pendingRunKey("project", daily, storage)).not.toBe(key);
  expect(pendingRunKey("project", { ...daily, engine: "gemini" }, storage, "schedule")).not.toBe(key);
  expect(pendingRunKey("project", { ...daily, cadence: "weekly" }, storage, "schedule")).not.toBe(key);
});
