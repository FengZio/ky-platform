export function normalizeMarkdownMath(text: string): string {
  let result = text
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, "")
    .replace(/[\u2800-\u28FF]/g, "")
    .replace(/[\uFFF0-\uFFFF]/g, "")
    .replace(/[\u202A-\u202E]/g, "");

  result = result.replace(/([^\n])\n(\|[^\n]+\|\n\|[:\- ]+\|)/g, "$1\n\n$2");
  result = result.replace(/^(\|[ :\-]+\|[ :\-]+):$/gm, "$1|");

  result = result.replace(/\\\[([\s\S]*?)\\\]/g, (_, content) => {
    const cleaned = String(content).trim();
    return `\n\n$$\n${cleaned}\n$$\n\n`;
  });

  result = result.replace(/\\\(([\s\S]*?)\\\)/g, (_, content) => {
    const cleaned = String(content).replace(/\s+/g, " ").trim();
    return `$${cleaned}$`;
  });

  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_, content) => {
    const cleaned = String(content).trim();
    return `\n\n$$\n${cleaned}\n$$\n\n`;
  });

  return result;
}

export const katexOptions = {
  throwOnError: false,
  strict: false,
};
