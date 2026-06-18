export type MusicXmlVariant = "staff" | "tab" | "dual" | "tab-chords";

const VARIANT_SUFFIX: Record<MusicXmlVariant, string> = {
  staff: "-staff",
  tab: "-tab",
  dual: "-dual",
  "tab-chords": "-tab-chords",
};

export function downloadMusicXml(
  xml: string,
  filename?: string,
  variant: MusicXmlVariant = "staff"
): void {
  if (!xml) return;
  const base = (filename || "score").replace(/\.[^.]+$/, "");
  const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}${VARIANT_SUFFIX[variant]}.musicxml`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(
  content: string,
  filename?: string,
  suffix = ""
): void {
  if (!content) return;
  const base = (filename || "tab").replace(/\.[^.]+$/, "");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}${suffix}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
