import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import analysisRouter from './routes/analysis.js';
import authRouter from './routes/auth.js';
import casesRouter from './routes/cases.js';
import documentsRouter from './routes/documents.js';
import { resolveUser } from './http/security.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/healthz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
app.get('/api/session', async (req, res) => {
  try {
    const user = await resolveUser(req);
    res.json({
      authenticated: Boolean(user),
      user: user ? { name: user.name, ...(user.email ? { email: user.email } : {}) } : null,
    });
  } catch {
    res.status(503).json({
      error: { code: 'AUTH_UNAVAILABLE', message: 'تعذر التحقق من الجلسة.' },
    });
  }
});
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/cases', casesRouter);
app.use('/api/cases', analysisRouter);
app.use('/api', documentsRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'المسار غير موجود.' } });
});

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const detail = error as { code?: string; type?: string };
  if (
    detail?.code === 'LIMIT_FILE_SIZE' ||
    detail?.code === 'LIMIT_FILE_COUNT' ||
    detail?.type === 'entity.too.large'
  ) {
    res
      .status(413)
      .json({ error: { code: 'UPLOAD_LIMIT', message: 'تجاوز الملف أو الطلب حد الرفع المسموح.' } });
    return;
  }
  if (detail?.code === 'LIMIT_UNEXPECTED_FILE') {
    res
      .status(400)
      .json({ error: { code: 'INVALID_UPLOAD', message: 'تعذر قراءة حقول الملفات.' } });
    return;
  }
  res.status(500).json({ error: { code: 'INTERNAL', message: 'حدث خطأ غير متوقع.' } });
};
app.use(errorHandler);

export default app;
