export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDemoData } = await import("@/db");
    await ensureDemoData();
  }
}
