import "../config/load-env.js";
import { parseEnvironment } from "../config/env.js";
import { checkGeminiCredential } from "../services/monitoring/gemini-auth.js";
import { checkOpenRouterCredential } from "../services/monitoring/openrouter.adapter.js";

try {
  const env = parseEnvironment(process.env);
  const openrouter =
    process.argv.includes("--engine=openrouter") ||
    (!process.argv.includes("--engine=gemini") && Boolean(env.OPENROUTER_API_KEY));
  const engine = openrouter ? "openrouter" : "gemini";
  const apiKey = openrouter ? env.OPENROUTER_API_KEY : env.GEMINI_API_KEY;
  const model = openrouter ? env.OPENROUTER_MODEL : env.GEMINI_MODEL;
  if (!apiKey) {
    console.log(JSON.stringify({ engine, ok: false, code: "ENGINE_NOT_CONFIGURED" }));
    process.exitCode = 1;
  } else {
    const result = await (openrouter ? checkOpenRouterCredential : checkGeminiCredential)({
      apiKey,
      model,
    });
    console.log(
      JSON.stringify({
        engine,
        model,
        ...result,
        note: "Metadata check only; generation quota and web-search execution are not tested.",
      }),
    );
    if (!result.ok) process.exitCode = 1;
  }
} catch {
  console.error(
    "Monitoring check could not load the server configuration. No credentials were printed.",
  );
  process.exitCode = 1;
}
