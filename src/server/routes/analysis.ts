import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  aiConsentSchema,
  sourceRefSchema,
  updateAnalysisSchema,
  type SourceRef,
} from '../../shared/contracts.js';
import { currentUser, requireAuth, requireCsrf } from '../http/security.js';
import { db } from '../db/index.js';
import { analyses, cases, documents, sourceSegments } from '../db/schema.js';
import { validateAndEnrich } from '../analysis/validate.js';
import {
  createManusAgentCall,
  RequiredAgentUnavailableError,
  runParallelAnalysis,
} from '../analysis/agents/orchestrator.js';

const router = Router();
router.use(requireAuth);

const iso = (value: Date | string): string => new Date(value).toISOString();
const routeParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

function analysisError(res: import('express').Response, status: number, message: string): void {
  res.status(status).json({ error: { code: 'ANALYSIS_FAILED', message } });
}

router.post('/:caseId/analyze', requireCsrf, async (req, res) => {
  if (!aiConsentSchema.safeParse(req.body).success) {
    analysisError(res, 400, 'يلزم تأكيد الموافقة على معالجة النص.');
    return;
  }

  try {
    const owner = currentUser(req).id;
    const caseId = routeParam(req.params.caseId);
    const [caseRecord] = await db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.accountId, owner)))
      .limit(1);
    if (!caseRecord) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'القضية غير موجودة.' } });
      return;
    }

    const segments = await db
      .select({
        id: sourceSegments.id,
        documentId: sourceSegments.documentId,
        pageNumber: sourceSegments.pageNumber,
        segmentNumber: sourceSegments.segmentNumber,
        text: sourceSegments.content,
        fileName: documents.fileName,
      })
      .from(sourceSegments)
      .innerJoin(documents, eq(sourceSegments.documentId, documents.id))
      .where(
        and(
          eq(sourceSegments.caseId, caseRecord.id),
          eq(sourceSegments.accountId, owner),
          eq(documents.accountId, owner),
          isNull(documents.deletedAt),
          eq(documents.status, 'ready'),
        ),
      );

    const maximum = Math.min(
      Math.max(Number(process.env.MAX_ANALYSIS_CHARS) || 60_000, 1_000),
      120_000,
    );
    const sourceMap = new Map<
      string,
      {
        documentId: string;
        fileName: string;
        pageNumber: number | null;
        segmentNumber: number;
        text: string;
      }
    >();
    const excerpts: string[] = [];
    let used = 0;
    for (const segment of segments) {
      const heading = `[SOURCE:${segment.id}]\n`;
      const remaining = maximum - used - heading.length;
      if (remaining <= 0) break;
      const text = segment.text.slice(0, remaining);
      sourceMap.set(segment.id, {
        documentId: segment.documentId,
        fileName: segment.fileName,
        pageNumber: segment.pageNumber,
        segmentNumber: segment.segmentNumber,
        text,
      });
      excerpts.push(`${heading}${text}`);
      used += heading.length + text.length;
    }
    if (!excerpts.length) {
      analysisError(res, 400, 'لا يوجد نص جاهز للتحليل في هذه القضية.');
      return;
    }

    const apiBase = process.env.MANUS_API_URL;
    const apiKey = process.env.MANUS_API_KEY;
    if (!apiBase || !apiKey) {
      analysisError(res, 503, 'خدمة التحليل غير متاحة حاليًا.');
      return;
    }

    const agentSources = Array.from(sourceMap.entries()).map(([segmentId, source]) => ({
      segmentId,
      ...source,
    }));
    const parallelResult = await runParallelAnalysis(
      agentSources,
      createManusAgentCall({
        apiBase,
        apiKey,
        model: process.env.CASE_ANALYSIS_MODEL || 'gpt-6.1-sol',
      }),
    ).catch((error: unknown) => {
      if (error instanceof RequiredAgentUnavailableError) {
        analysisError(
          res,
          error.httpStatus,
          'تعذر إعداد الملخص الأساسي من مصادر قابلة للتحقق. بقيت الملفات محفوظة ويمكنك إعادة المحاولة.',
        );
        return null;
      }
      throw error;
    });
    if (!parallelResult) return;

    const validated = validateAndEnrich(parallelResult.raw, sourceMap);

    const id = randomUUID();
    await db.insert(analyses).values({ id, accountId: owner, caseId: caseRecord.id, ...validated });
    const now = new Date().toISOString();
    res
      .status(201)
      .json({ id, caseId: caseRecord.id, ...validated, createdAt: now, updatedAt: now });
  } catch {
    analysisError(res, 503, 'تعذر إعداد المسودة. لم تُحذف الملفات؛ تحقق من الحالة ثم أعد المحاولة.');
  }
});

router.patch('/:caseId/analysis', requireCsrf, async (req, res) => {
  const parsed = updateAnalysisSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_REVIEW', message: 'تعذر التحقق من حقول المراجعة.' } });
    return;
  }

  try {
    const owner = currentUser(req).id;
    const caseId = routeParam(req.params.caseId);
    const [caseRecord] = await db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.accountId, owner)))
      .limit(1);
    if (!caseRecord) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'القضية غير موجودة.' } });
      return;
    }

    const [existing] = await db
      .select()
      .from(analyses)
      .where(and(eq(analyses.caseId, caseRecord.id), eq(analyses.accountId, owner)))
      .orderBy(desc(analyses.updatedAt))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'لا توجد مسودة لهذه القضية.' } });
      return;
    }

    const allRefs: SourceRef[] = [
      ...parsed.data.summarySources,
      ...parsed.data.events.flatMap((event) => event.sources),
      ...parsed.data.entities.flatMap((entity) => entity.sources),
    ];
    const sourceRows = await db
      .select({
        id: sourceSegments.id,
        documentId: sourceSegments.documentId,
        pageNumber: sourceSegments.pageNumber,
        segmentNumber: sourceSegments.segmentNumber,
        text: sourceSegments.content,
        fileName: documents.fileName,
      })
      .from(sourceSegments)
      .innerJoin(documents, eq(sourceSegments.documentId, documents.id))
      .where(
        and(
          eq(sourceSegments.caseId, caseRecord.id),
          eq(sourceSegments.accountId, owner),
          eq(documents.accountId, owner),
          isNull(documents.deletedAt),
        ),
      );
    const allowed = new Map(sourceRows.map((source) => [source.id, source]));
    const refsMatch = allRefs.every((ref) => {
      const source = allowed.get(ref.segmentId);
      return Boolean(
        source &&
        source.documentId === ref.documentId &&
        source.fileName === ref.fileName &&
        source.pageNumber === ref.pageNumber &&
        source.segmentNumber === ref.segmentNumber &&
        source.text.includes(ref.excerpt),
      );
    });
    if (!refsMatch) {
      res.status(400).json({
        error: {
          code: 'INVALID_SOURCE',
          message: 'إحدى الإحالات لا تطابق مصدرًا نشطًا في القضية.',
        },
      });
      return;
    }

    const data = parsed.data;
    await db
      .update(analyses)
      .set({ ...data, status: 'edited' })
      .where(
        and(
          eq(analyses.id, existing.id),
          eq(analyses.caseId, caseRecord.id),
          eq(analyses.accountId, owner),
        ),
      );
    const now = new Date().toISOString();
    res.json({
      id: existing.id,
      caseId: existing.caseId,
      ...data,
      status: 'edited',
      createdAt: iso(existing.createdAt),
      updatedAt: now,
    });
  } catch {
    res
      .status(503)
      .json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'تعذر حفظ المراجعة.' } });
  }
});

export default router;
