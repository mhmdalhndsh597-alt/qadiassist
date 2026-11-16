import { describe, expect, it } from 'vitest';
import { validateFile } from './extract.js';

const pdfMime = 'application/pdf';
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function file(originalname: string, mimetype: string, buffer: Buffer) {
  return { originalname, mimetype, buffer, size: buffer.length };
}

describe('تحقق الملفات قبل التخزين', () => {
  it('يقبل ملف PDF مطابقًا للامتداد وMIME والترويسة', () => {
    expect(validateFile(file('sample.pdf', pdfMime, Buffer.from('%PDF-1.7\n')))).toBe(pdfMime);
  });

  it('يرفض امتداد PDF مزيفًا أو محتوى غير مطابق', () => {
    expect(() => validateFile(file('malware.pdf', pdfMime, Buffer.from('MZ')))).toThrow();
    expect(() => validateFile(file('sample.pdf', 'text/plain', Buffer.from('%PDF-1.7')))).toThrow();
  });

  it('يقبل DOCX فقط عند تطابق MIME والامتداد وترويسة ZIP', () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(validateFile(file('sample.docx', docxMime, zipHeader))).toBe(docxMime);
    expect(() => validateFile(file('sample.docx', docxMime, Buffer.from('not a zip')))).toThrow();
  });

  it('يرفض الملفات الفارغة والكبيرة', () => {
    expect(() => validateFile(file('empty.pdf', pdfMime, Buffer.alloc(0)))).toThrow();
    expect(() =>
      validateFile(file('large.pdf', pdfMime, Buffer.alloc(15 * 1024 * 1024 + 1))),
    ).toThrow();
  });
});
