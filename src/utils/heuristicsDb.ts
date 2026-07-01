import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// We assume data folder is at the project root (one level above src/utils)
const DB_PATH = join(__dirname, "..", "..", "data", "noise_blacklist.json");

export class HeuristicsDb {
  static async getBlacklist(): Promise<string[]> {
    try {
      const data = await fs.readFile(DB_PATH, "utf-8");
      return JSON.parse(data) as string[];
    } catch {
      return [];
    }
  }

  static async addNoise(noise: string): Promise<void> {
    const list = await this.getBlacklist();
    const cleanNoise = noise.trim().toLowerCase();
    
    if (cleanNoise && !list.includes(cleanNoise)) {
      list.push(cleanNoise);
      await fs.mkdir(dirname(DB_PATH), { recursive: true });
      await fs.writeFile(DB_PATH, JSON.stringify(list, null, 2), "utf-8");
    }
  }
}
