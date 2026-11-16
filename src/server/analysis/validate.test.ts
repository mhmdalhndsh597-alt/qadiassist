import { describe, expect, it } from 'vitest';
import { parseModelJson, validateAndEnrich } from './validate.js';

const segmentId = '41ba89bc-7dcb-4b0c-86f6-8f8d40cf034f';
const documentId = '4ee98311-45b9-49e5-a8b4-b3f721cda3d9';
const originalText = 'حُرر هذا المحضر في مدينة الرياض يوم الأحد، ووقع عليه ممثل الشركة.';

const validAnalysis = {
  summary: 'محضر افتراضي يذكر تحريره في الرياض.',
  summarySources: [{ segmentId, excerpt: 'حُرر هذا المحضر في مدينة الرياض' }],
  events: [
    {
      date: null,
      dateLabel: 'يوم الأحد — التاريخ غير محدد',
      description: 'حُرر محضر افتراضي في الرياض.',
      significance: 'تحقق من التاريخ من المستند الأصلي.',
      sources: [{ segmentId, excerpt: 'في مدينة الرياض' }],
    },
  ],
  entities: [
    {
      name: 'ممثل الشركة',
      type: 'organization' as const,
      role: 'ممثل ورد ذكره في المحضر',
      sources: [{ segmentId, excerpt: 'ممثل الشركة' }],
    },
  ],
  reviewNotes: ['بيانات اختبار اصطناعية.'],
};

const sourceMap = new Map([
  [
    segmentId,
    {
      documentId,
      fileName: 'محضر-اصطناعي.pdf',
      pageNumber: 2,
      segmentNumber: 2,
      text: originalText,
    },
  ],
]);

describe('تحقق نتائج التحليل', () => {
  it('يقبل JSON داخل سياج Markdown ويستخرج كائن JSON عند وجود تمهيد', () => {
    const text = `النتيجة المطلوبة:\n\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\``;
    expect(parseModelJson(text).summary).toBe(validAnalysis.summary);
  });

  it('يربط الاقتباس ببيانات المصدر من الخادم لا بما يرسله النموذج', () => {
    const result = validateAndEnrich(validAnalysis, sourceMap);
    expect(result.summarySources[0]).toMatchObject({
      documentId,
      fileName: 'محضر-اصطناعي.pdf',
      pageNumber: 2,
      segmentNumber: 2,
      excerpt: 'حُرر هذا المحضر في مدينة الرياض',
    });
    expect(result.events[0].reviewStatus).toBe('ai_draft');
  });

  it('يستبعد إحالة غير موجودة ويضيف ملاحظة تدقيق', () => {
    const withBadSource = {
      ...validAnalysis,
      events: [
        {
          ...validAnalysis.events[0],
          sources: [{ segmentId, excerpt: 'اقتباس غير موجود في المصدر' }],
        },
      ],
    };
    const result = validateAndEnrich(withBadSource, sourceMap);
    expect(result.events).toHaveLength(0);
    expect(result.reviewNotes.join(' ')).toContain('استُبعدت 1 إحالة');
  });

  it('يرفض الملخص عندما لا يبقى له أي مصدر مطابق', () => {
    const withBadSummary = {
      ...validAnalysis,
      summarySources: [{ segmentId, excerpt: 'نص مختلق' }],
    };
    expect(() => validateAndEnrich(withBadSummary, sourceMap)).toThrow('NO_VALID_SOURCES');
  });
});
