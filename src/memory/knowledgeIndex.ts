import type { StructuredMemory } from "../types.js";

/**
 * Lightweight in-process knowledge index.
 *
 * Maintains a map of { websiteUrl → StructuredMemory } so previously
 * analysed sites can be queried without re-crawling.
 */
export class KnowledgeIndex {
  private readonly index = new Map<string, StructuredMemory>();

  /** Add or update an entry in the index */
  add(memory: StructuredMemory): void {
    const key = this.normalizeUrl(memory.input.websiteUrl);
    this.index.set(key, memory);
  }

  /** Retrieve a stored memory by website URL */
  get(websiteUrl: string): StructuredMemory | undefined {
    return this.index.get(this.normalizeUrl(websiteUrl));
  }

  /** Check whether a site has already been analysed */
  has(websiteUrl: string): boolean {
    return this.index.has(this.normalizeUrl(websiteUrl));
  }

  /** Remove a site from the index */
  remove(websiteUrl: string): void {
    this.index.delete(this.normalizeUrl(websiteUrl));
  }

  /** Return all stored site URLs */
  listSites(): string[] {
    return [...this.index.keys()];
  }

  /**
   * Full-text search across all stored memories.
   *
   * Returns sites where at least one of the `keywords` appears
   * in any of the specified field groups.
   */
  search(
    keywords: string[],
    fields: ("offerings" | "industry" | "audience" | "brand" | "all") = "all",
  ): Array<{ url: string; name: string | null; matchCount: number }> {
    const results: Array<{ url: string; name: string | null; matchCount: number }> = [];

    for (const [url, memory] of this.index.entries()) {
      const haystack = this.buildHaystack(memory, fields);
      const matchCount = keywords.filter((kw) => haystack.includes(kw.toLowerCase())).length;
      if (matchCount > 0) {
        results.push({ url, name: memory.businessIdentity.officialName, matchCount });
      }
    }

    return results.sort((a, b) => b.matchCount - a.matchCount);
  }

  /** Summarise index stats */
  stats(): { totalSites: number; sitesWithName: number; industries: Record<string, number> } {
    const memories = [...this.index.values()];
    const industries: Record<string, number> = {};

    for (const m of memories) {
      const ind = m.businessIdentity.industry ?? "Unknown";
      industries[ind] = (industries[ind] ?? 0) + 1;
    }

    return {
      totalSites: memories.length,
      sitesWithName: memories.filter((m) => m.businessIdentity.officialName).length,
      industries,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname.replace(/\/$/, "")}`;
    } catch {
      return url.toLowerCase().trim();
    }
  }

  private buildHaystack(memory: StructuredMemory, fields: "offerings" | "industry" | "audience" | "brand" | "all"): string {
    if (fields === "all") return JSON.stringify(memory).toLowerCase();

    const parts: string[] = [];
    if (fields === "offerings") {
      parts.push(...memory.offerings.products.map(p => p.name), ...memory.offerings.services.map(s => s.name));
    } else if (fields === "industry") {
      parts.push(memory.businessIdentity.industry ?? "", memory.businessIdentity.subIndustry ?? "");
    } else if (fields === "audience") {
      parts.push(...memory.audience.buyerPersonas, ...memory.audience.targetIndustries);
    } else if (fields === "brand") {
      parts.push(memory.brandPositioning.tone ?? "", memory.brandPositioning.positioning ?? "", ...memory.brandPositioning.usps);
    }
    return parts.join(" ").toLowerCase();
  }
}

/** Singleton shared across the server process */
export const knowledgeIndex = new KnowledgeIndex();
