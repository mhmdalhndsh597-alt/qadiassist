import { randomUUID } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { Router } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { currentUser, requireAuth, requireCsrf } from '../http/security.js';
import { db } from '../db/index.js';
import { cases, documents, sourceSegments } from '../db/schema.js';
import { extractDocument, validateFile } from '../documents/extract.js';

const router = Router();
router.use(requireAuth);
const routeParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

const maxFileBytes = Math.min(
  Math.max(Number(process.env.MAX_UPLOAD_BYTES) || 15 * 1024 * 1024, 1),
  15 * 1024 * 1024,
);
const maxFiles = 5;
const maxBatchBytes = 30 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileBytes, files: maxFiles },
});

function safeFileName(input: string): string {
  const normalized = input.replace(/\\/g, '/');
  const base = path.posix
    .basename(normalized)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (base || 'document').slice(0, 255);
}

async function signedStorageUrl(method: 'put' | 'get', objectKey: string): Promise<string> {
  const apiBase = process.env.MANUS_API_URL;
  const apiKey = process.env.MANUS_API_KEY;
  if (!apiBase || !apiKey) throw new Error('STORAGE_UNAVAILABLE');

  const endpoint = new URL(`/v1/storage/presign/${method}`, apiBase);
  endpoint.searchParams.set('path', objectKey);
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` } });
  const payload = (await response.json().catch(() => ({}))) as { url?: unknown; error?: unknown };
  if (!response.ok || payload.error || typeof payload.url !== 'string' || !payload.url)
    throw new Error('STORAGE_UNAVAILABLE');
  const url = new URL(payload.url);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('INVALID_STORAGE_URL');
  return url.toString();
}

router.post(
  '/cases/:id/documents',
  requireCsrf,
  upload.array('files', maxFiles),
  async (req, res) => {
    const owner = currentUser(req).id;
    const caseId = routeParam(req.params.id);
    try {
      const [caseRecord] = await db
        .select()
        .from(cases)
        .where(and(eq(cases.id, caseId), eq(cases.accountId, owner)))
        .limit(1);
      if (!caseRecord) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'القضية غير موجودة.' } });
        return;
      }

      const incoming = (req.files ?? []) as Express.Multer.File[];
      if (!incoming.length || incoming.reduce((sum, file) => sum + file.size, 0) > maxBatchBytes) {
        res.status(413).json({
          error: {
            code: 'UPLOAD_LIMIT',
            message: 'اختر ملفات بحد أقصى 15 م.ب للملف و30 م.ب للدفعة.',
          },
        });
        return;
      }

      // Validate the complete batch before storing any file, so a bad file cannot hide earlier successes.
      const checked = incoming.map((file) => ({
        file,
        mimeType: validateFile(file),
        fileName: safeFileName(file.originalname),
      }));
      const result = [];

      for (const item of checked) {
        const id = randomUUID();
        const objectKey = `cases/${owner}/${id}`;
        let recordCreated = false;
        try {
          await db.insert(documents).values({
            id,
            accountId: owner,
            caseId: caseRecord.id,
            fileName: item.fileName,
            mimeType: item.mimeType,
            sizeBytes: item.file.size,
            objectKey,
            status: 'processing',
          });
          recordCreated = true;

          const putUrl = await signedStorageUrl('put', objectKey);
          const storageResponse = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'content-type': item.mimeType },
            body: new Uint8Array(item.file.buffer),
          });
          if (!storageResponse.ok) throw new Error('UPLOAD_FAILED');

          const extraction = await extractDocument(item.file.buffer, item.mimeType);
          if (extraction.segments.length) {
            await db.insert(sourceSegments).values(
              extraction.segments.map((segment) => ({
                id: segment.id,
                accountId: owner,
                caseId: caseRecord.id,
                documentId: id,
                pageNumber: segment.pageNumber,
                segmentNumber: segment.segmentNumber,
                content: segment.text,
              })),
            );
          }
          await db
            .update(documents)
            .set({ status: 'ready', pageCount: extraction.pageCount })
            .where(and(eq(documents.id, id), eq(documents.accountId, owner)));
          result.push({
            id,
            caseId: caseRecord.id,
            fileName: item.fileName,
            mimeType: item.mimeType,
            sizeBytes: item.file.size,
            pageCount: extraction.pageCount,
            status: 'ready',
            createdAt: new Date().toISOString(),
            sourceCount: extraction.segments.length,
          });
        } catch {
          if (recordCreated) {
            await db
              .update(documents)
              .set({ status: 'failed', errorMessage: 'تعذر رفع الملف أو استخراجه.' })
              .where(and(eq(documents.id, id), eq(documents.accountId, owner)));
          }
          result.push({
            id,
            caseId: caseRecord.id,
            fileName: item.fileName,
            mimeType: item.mimeType,
            sizeBytes: item.file.size,
            pageCount: null,
            status: 'failed',
            errorMessage: 'تعذر رفع الملف أو استخراجه.',
            createdAt: new Date().toISOString(),
            sourceCount: 0,
          });
        }
      }

      res.status(201).json(result);
    } catch {
      res.status(400).json({
        error: {
          code: 'INVALID_FILE',
          message: 'تعذر التحقق من الملفات. ارفع PDF أو DOCX صالحًا فقط.',
        },
      });
    }
  },
);

router.get('/documents/:id/sources', async (req, res) => {
  try {
    const owner = currentUser(req).id;
    const documentId = routeParam(req.params.id);
    const [document] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.accountId, owner),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!document) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'المستند غير موجود.' } });
      return;
    }
    const segments = await db
      .select()
      .from(sourceSegments)
      .where(and(eq(sourceSegments.documentId, document.id), eq(sourceSegments.accountId, owner)));
    res.json(
      segments.map((segment) => ({
        id: segment.id,
        documentId: segment.documentId,
        fileName: document.fileName,
        pageNumber: segment.pageNumber,
        segmentNumber: segment.segmentNumber,
        text: segment.content,
      })),
    );
  } catch {
    res
      .status(503)
      .json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'تعذر تحميل المصادر.' } });
  }
});

router.get('/documents/:id/download', async (req, res) => {
  try {
    const owner = currentUser(req).id;
    const documentId = routeParam(req.params.id);
    const [document] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.accountId, owner),
          isNull(documents.deletedAt),
          eq(documents.status, 'ready'),
        ),
      )
      .limit(1);
    if (!document?.objectKey) {
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'المستند غير موجود أو غير جاهز.' } });
      return;
    }
    const url = await signedStorageUrl('get', document.objectKey);
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, url);
  } catch {
    res.status(503).json({ error: { code: 'STORAGE_UNAVAILABLE', message: 'تعذر فتح المستند.' } });
  }
});

router.delete('/documents/:id', requireCsrf, async (req, res) => {
  try {
    const owner = currentUser(req).id;
    const documentId = routeParam(req.params.id);
    const [document] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.accountId, owner),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!document) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'المستند غير موجود.' } });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(sourceSegments)
        .where(
          and(eq(sourceSegments.documentId, document.id), eq(sourceSegments.accountId, owner)),
        );
      await tx
        .update(documents)
        .set({ status: 'deleted', deletedAt: new Date(), errorMessage: 'purge_required' })
        .where(and(eq(documents.id, document.id), eq(documents.accountId, owner)));
    });
    res.json({
      ok: true,
      physicalDelete: false,
      message: 'أزيل المستند ونصه من مساحة العمل. بقي كائن التخزين بحاجة إلى تطهير منفصل.',
    });
  } catch {
    res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'تعذر حذف المستند.' } });
  }
});

export default router;
