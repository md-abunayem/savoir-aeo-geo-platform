import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Same server/.env for source and dist entrypoints, independent of launch directory.
// Deployment-injected values retain precedence. Restart both processes after rotation.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
