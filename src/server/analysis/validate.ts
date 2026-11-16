import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sourceRefSchema, type SourceRef } from '../../shared/contracts.js';

const rawSourceSchema = z.object({
  segmentId: z.string().uuid(),
  excerpt: z.string().trim().min(1).max(1200),
});

const rawSchema = z.object({
  summary: z.string().trim().min(1).max(12000),
  summarySources: z.array(rawSourceSchema).min(1).max(40),
  events: z
    .array(
      z.object({
        date: z.string().nullable().optional(),
        dateLabel: z.string().max(250),
        description: z.string().max(4000),
        significance: z.string().max(2500).optional(),
        sources: z.array(rawSourceSchema).min(1).max(20),
      }),
    )
    .max(250),
  entities: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        type: z.enum(['person', 'organization', 'place', 'document', 'other']),
        role: z.string().max(500).optional(),
        sources: z.array(rawSourceSchema).min(1).max(20),
      }),
    )
    .max(250),
  reviewNotes: z.array(z.string().trim().min(1).max(1000)).max(80),
});

export type RawAnalysis = z.infer<typeof rawSchema>;
export type SourceLookup = Map<
  string,
  {
    documentId: string;
    fileName: string;
    pageNumber: number | null;
    segmentNumber: number;
    text: string;
  }
>;

export function parseModelJson(text: string): RawAnalysis {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('INVALID_JSON');
    parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  }
  return rawSchema.parse(parsed);
}

export function validateAndEnrich(raw: RawAnalysis, segments: SourceLookup) {
  let rejectedReferences = 0;
  const enrich = (candidate: z.infer<typeof rawSourceSchema>): SourceRef | null => {
    const source = segments.get(candidate.segmentId);
    if (!source || !source.text.includes(candidate.excerpt)) {
      rejectedReferences += 1;
      return null;
    }
    return sourceRefSchema.parse({
      documentId: source.documentId,
      fileName: source.fileName,
      segmentId: candidate.segmentId,
      pageNumber: source.pageNumber,
      segmentNumber: source.segmentNumber,
      excerpt: candidate.excerpt,
    });
  };
  const validRefs = (refs: z.infer<typeof rawSourceSchema>[]): SourceRef[] =>
    refs.map(enrich).filter((ref): ref is SourceRef => ref !== null);

  const summarySources = validRefs(raw.summarySources);
  if (!summarySources.length) throw new Error('NO_VALID_SOURCES');

  const events = raw.events
    .map((event) => ({
      ...event,
      id: randomUUID(),
      date: event.date ?? null,
      sources: validRefs(event.sources),
      reviewStatus: 'ai_draft' as const,
    }))
    .filter((event) => event.sources.length > 0);
  const entities = raw.entities
    .map((entity) => ({
      ...entity,
      id: randomUUID(),
      sources: validRefs(entity.sources),
      reviewStatus: 'ai_draft' as const,
    }))
    .filter((entity) => entity.sources.length > 0);
  const reviewNotes = [...raw.reviewNotes];
  if (rejectedReferences > 0 && reviewNotes.length < 80) {
    reviewNotes.push(`استُبعدت ${rejectedReferences} إحالة لم يمكن مطابقتها حرفيًا بمصدر نشط.`);
  }

  return {
    summary: raw.summary,
    summarySources,
    events,
    entities,
    reviewNotes,
    status: 'ai_draft' as const,
  };
}
