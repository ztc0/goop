/** Downloads a URL into memory over https, refusing a body larger than `maxBytes`. */
export async function downloadBytes(url: string, maxBytes: number): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new Error("only https:// URLs are downloaded");
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(`larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
