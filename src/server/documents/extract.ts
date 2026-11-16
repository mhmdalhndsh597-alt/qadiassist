import { randomUUID } from 'node:crypto';
export type ExtractedSegment = {
  id: string;
  pageNumber: number | null;
  segmentNumber: number;
  text: string;
};
export async function extractDocument(
  bytes: Buffer,
  mime: string,
): Promise<{ segments: ExtractedSegment[]; pageCount: number | null }> {
  let segments: ExtractedSegment[] = [];
  if (mime === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
      .promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const text = tc.items
        .map((x: any) => (typeof x.str === 'string' ? x.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) segments.push({ id: randomUUID(), pageNumber: n, segmentNumber: n, text });
    }
    if (!segments.length) throw new Error('EMPTY_DOCUMENT');
    return { segments, pageCount: doc.numPages };
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: bytes });
    const paragraphs = result.value
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    paragraphs.forEach((text, i) =>
      segments.push({ id: randomUUID(), pageNumber: null, segmentNumber: i + 1, text }),
    );
    if (!segments.length) throw new Error('EMPTY_DOCUMENT');
    return { segments, pageCount: null };
  }
  throw new Error('UNSUPPORTED_TYPE');
}
export function validateFile(file: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}): string {
  const ext = file.originalname.toLowerCase().split('.').pop();
  if (file.size < 1 || file.size > 15 * 1024 * 1024) throw new Error('INVALID_SIZE');
  if (
    ext === 'pdf' &&
    file.mimetype === 'application/pdf' &&
    file.buffer.subarray(0, 5).toString() === '%PDF-'
  )
    return file.mimetype;
  if (
    ext === 'docx' &&
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
    file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  )
    return file.mimetype;
  throw new Error('INVALID_FILE');
}
