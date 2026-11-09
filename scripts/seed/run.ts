import { seedMaster } from "./master";
import { runScenario } from "./scenario";
import type { SeedApi, SeedOptions, SeedSummary } from "./types";

export async function runSeed(api: SeedApi, opts: SeedOptions): Promise<SeedSummary> {
  const log = opts.log ?? (() => {});
  log("Master data & pengguna");
  const ref = await seedMaster(api, log);
  const summary: SeedSummary = {
    master: {
      users: Object.keys(ref.user).length,
      items: Object.keys(ref.item).length,
      locations: Object.keys(ref.loc).length,
    },
    demo: null,
  };
  if (opts.demo) {
    log("Skenario transaksi demo");
    summary.demo = await runScenario(api, ref, log);
  }
  return summary;
}
