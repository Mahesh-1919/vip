import { config } from "dotenv";
// Use the developer's .env (so seeded encrypted data decrypts); fall back to a fixed key in CI.
config({ path: ".env", quiet: true });
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
