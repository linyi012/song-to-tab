export function downloadMusicXml(xml: string, filename?: string): void {
  if (!xml) return;
  const base = (filename || "score").replace(/\.[^.]+$/, "");
  const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.musicxml`;
  a.click();
  URL.revokeObjectURL(url);
}
