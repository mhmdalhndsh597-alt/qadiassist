import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createCaseSchema } from '../../shared/contracts.js';
import { currentUser, requireAuth, requireCsrf } from '../http/security.js';
import { db } from '../db/index.js';
import { analyses, cases, documents, sourceSegments } from '../db/schema.js';

const router = Router();
router.use(requireAuth);

const iso = (value: Date | string): string => new Date(value).toISOString();
const routeParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

router.get('/', async (req, res) => {
  try {
    const owner = currentUser(req).id;
    const rows = await db
      .select()
      .from(cases)
      .where(eq(cases.accountId, owner))
      .orderBy(desc(cases.updatedAt));
    const activeDocs = await db
      .select({ caseId: documents.caseId })
      .from(documents)
      .where(and(eq(documents.accountId, owner), isNull(documents.deletedAt)));
    const counts = new Map<string, number>();
    for (const document of activeDocs)
      counts.set(document.caseId, (counts.get(document.caseId) ?? 0) + 1);
    res.json(
      rows.map((item) => ({
        id: item.id,
        title: item.title,
        createdAt: iso(item.createdAt),
        updatedAt: iso(item.updatedAt),
        documentCount: counts.get(item.id) ?? 0,
      })),
    );
  } catch {
    res
      .status(503)
      .json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'تعذر تحميل القضايا.' } });
  }
});

router.post('/', requireCsrf, async (req, res) => {
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_REQUEST', message: 'أدخل عنوانًا صالحًا للقضية.' } });
    return;
  }
  try {
    const owner = currentUser(req).id;
    const id = randomUUID();
    const now = new Date();
    await db.insert(cases).values({ id, accountId: owner, title: parsed.data.title });
    res.status(201).json({
      id,
      title: parsed.data.title,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      documentCount: 0,
    });
  } catch {
    res
      .status(503)
      .json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'تعذر إنشاء القضية.' } });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const owner = currentUser(req).id;
    const caseId = routeParam(req.params.id);
    const [record] = await db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.accountId, owner)))
      .limit(1);
    if (!record) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'القضية غير موجودة.' } });
      return;
    }

    const docRows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.caseId, record.id),
          eq(documents.accountId, owner),
          isNull(documents.deletedAt),
        ),
      );
    const sourceRows = await db
      .select({ documentId: sourceSegments.documentId })
      .from(sourceSegments)
      .where(and(eq(sourceSegments.caseId, record.id), eq(sourceSegments.accountId, owner)));
    const sourceCounts = new Map<string, number>();
    for (const segment of sourceRows)
      sourceCounts.set(segment.documentId, (sourceCounts.get(segment.documentId) ?? 0) + 1);

    const [analysis] = await db
      .select()
      .from(analyses)
      .where(and(eq(analyses.caseId, record.id), eq(analyses.accountId, owner)))
      .orderBy(desc(analyses.updatedAt))
      .limit(1);

    res.json({
      case: {
        id: record.id,
        title: record.title,
        createdAt: iso(record.createdAt),
        updatedAt: iso(record.updatedAt),
        documentCount: docRows.length,
      },
      documents: docRows.map((item) => ({
        id: item.id,
        caseId: item.caseId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        pageCount: item.pageCount,
        status: item.status,
        ...(item.errorMessage ? { errorMessage: item.errorMessage } : {}),
        createdAt: iso(item.createdAt),
        sourceCount: sourceCounts.get(item.id) ?? 0,
      })),
      analysis: analysis
        ? {
            id: analysis.id,
            caseId: analysis.caseId,
            summary: analysis.summary,
            summarySources: analysis.summarySources,
            events: analysis.events,
            entities: analysis.entities,
            reviewNotes: analysis.reviewNotes,
            status: analysis.status,
            createdAt: iso(analysis.createdAt),
            updatedAt: iso(analysis.updatedAt),
          }
        : null,
    });
  } catch {
    res
      .status(503)
      .json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'تعذر تحميل القضية.' } });
  }
});

router.patch('/:id', requireCsrf, async (req, res) => {
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_REQUEST', message: 'أدخل عنوانًا صالحًا للقضية.' } });
    return;
  }
  try {
    const owner = currentUser(req).id;
    const caseId = routeParam(req.params.id);
    const [record] = await db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.accountId, owner)))
      .limit(1);
    if (!record) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'القضية غير موجودة.' } });
      return;
    }
    await db
      .update(cases)
      .set({ title: parsed.data.title })
      .where(and(eq(cases.id, record.id), eq(cases.accountId, owner)));
    res.json({
      id: record.id,
      title: parsed.data.title,
      createdAt: iso(record.createdAt),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    res
      .status(503)
      .json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'تعذر تحديث القضية.' } });
  }
});

router.delete('/:id', requireCsrf, async (req: Request, res: Response) => {
  try {
    const owner = currentUser(req).id;
    const caseId = routeParam(req.params.id);
    const [record] = await db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.accountId, owner)))
      .limit(1);
    if (!record) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'القضية غير موجودة.' } });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(sourceSegments)
        .where(and(eq(sourceSegments.caseId, record.id), eq(sourceSegments.accountId, owner)));
      await tx
        .delete(analyses)
        .where(and(eq(analyses.caseId, record.id), eq(analyses.accountId, owner)));
      // Keep object keys as purge tombstones: the runtime storage API cannot physically delete them.
      await tx
        .update(documents)
        .set({
          status: 'deleted',
          deletedAt: new Date(),
          errorMessage: 'purge_required',
        })
        .where(and(eq(documents.caseId, record.id), eq(documents.accountId, owner)));
      await tx.delete(cases).where(and(eq(cases.id, record.id), eq(cases.accountId, owner)));
    });

    res.json({
      ok: true,
      physicalDelete: false,
      message: 'أزيلت القضية ونصوصها من مساحة العمل. بقيت ملفات التخزين بحاجة إلى تطهير منفصل.',
    });
  } catch {
    res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'تعذر حذف القضية.' } });
  }
});

export default router;
