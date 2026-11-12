import { console } from "node:console";
import process from "node:process";
import { startTunnel } from "untun";

async function run() {
  console.log("Starting Cloudflare tunnel for http://127.0.0.1:8000...");
  const tunnel = await startTunnel({
    url: "http://127.0.0.1:8000",
  });
  if (!tunnel) {
    console.error("Failed to start tunnel.");
    process.exit(1);
  }
  const url = await tunnel.getURL();
  console.log(">>> TUNNEL_URL:", url);
}

run().catch(console.error);
