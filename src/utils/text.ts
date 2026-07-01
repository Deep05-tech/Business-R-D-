export function compactText(value: string): string {
  return value
    .replace(/[\uE000-\uF8FF\uF000-\uFFFF]/g, "") // strip private-use Unicode (icon fonts like FontAwesome)
    .replace(/\s+/g, " ")
    .trim();
}

export function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const rawValue of values) {
    const value = compactText(rawValue);
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  }

  return output;
}

export function firstSentence(value: string, maxLength = 220): string | null {
  const text = compactText(value);
  if (!text) return null;
  const match = text.match(/^(.{40,}?[.!?])\s/);
  const sentence = match?.[1] ?? text.slice(0, maxLength);
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1).trim()}...` : sentence;
}

export function keywordHits(text: string, keywords: string[]): string[] {
  const lowerText = text.toLowerCase();
  return keywords.filter((keyword) => lowerText.includes(keyword.toLowerCase()));
}

export function scoreFromSignals(signals: unknown[], total: number): number {
  return Math.max(0, Math.min(100, Math.round((signals.length / total) * 100)));
}
