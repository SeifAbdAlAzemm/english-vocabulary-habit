import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execute = promisify(execFile);

export async function localSupabaseConfig() {
  let status;
  try {
    // Capture status privately: its JSON includes local administrative keys.
    const { stdout } = await execute(process.execPath, [resolve("node_modules/supabase/dist/supabase.js"), "status", "-o", "json"], { windowsHide: true, timeout: 20000 });
    status = JSON.parse(stdout);
  } catch {
    throw new Error("Local Supabase status is unavailable. Start the local stack before running runtime tests.");
  }
  const url = status.API_URL ?? status.api_url;
  const key = status.ANON_KEY ?? status.anon_key ?? status.PUBLISHABLE_KEY;
  const adminKey = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? status.SECRET_KEY;
  if (!url || !key || !adminKey) throw new Error(`Local CLI status did not provide the expected configuration fields (available field names: ${Object.keys(status).join(", ")}).`);
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.port !== "54321") throw new Error("Runtime tests require the local Supabase API on loopback port 54321; hosted URLs are rejected.");
  return { url, key, adminKey };
}
