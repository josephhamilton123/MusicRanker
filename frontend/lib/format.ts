export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed === "—") {
    return null;
  }
  const clock = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  throw new Error("Use m:ss or a number of seconds.");
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "album";
}

export function csvEscape(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
