export type MusicXmlVariant = "staff" | "tab" | "dual";

const VARIANT_SUFFIX: Record<MusicXmlVariant, string> = {
  staff: "-staff",
  tab: "-tab",
  dual: "-dual",
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
