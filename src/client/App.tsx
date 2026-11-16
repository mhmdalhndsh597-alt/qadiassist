import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  CircleHelp,
  Clock3,
  FilePlus2,
  FileText,
  Files,
  FolderOpen,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react';

type SourceRef = {
  documentId: string;
  fileName: string;
  segmentId: string;
  pageNumber: number | null;
  segmentNumber: number;
  excerpt: string;
};
type CaseRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
};
type Document = {
  id: string;
  caseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  status: 'processing' | 'ready' | 'failed' | 'deleted';
  errorMessage?: string;
  createdAt: string;
  sourceCount: number;
};
type Event = {
  id: string;
  date: string | null;
  dateLabel: string;
  description: string;
  significance?: string;
  sources: SourceRef[];
  reviewStatus: 'ai_draft' | 'edited' | 'approved';
};
type Entity = {
  id: string;
  name: string;
  type: string;
  role?: string;
  sources: SourceRef[];
  reviewStatus: 'ai_draft' | 'edited' | 'approved';
};
type Analysis = {
  id: string;
  caseId: string;
  summary: string;
  summarySources: SourceRef[];
  events: Event[];
  entities: Entity[];
  reviewNotes: string[];
  status: 'ai_draft' | 'edited' | 'approved';
  createdAt: string;
  updatedAt: string;
};
type Session = { authenticated: boolean; user: { name: string; email?: string } | null };
type Detail = { case: CaseRecord; documents: Document[]; analysis: Analysis | null };
const API = '/api';
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (mutating && path !== '/auth/csrf' && !headers.has('x-csrf-token')) {
    const csrfResponse = await fetch(`${API}/auth/csrf`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const csrfBody = (await csrfResponse.json().catch(() => null)) as {
      csrfToken?: string;
      error?: { message?: string };
    } | null;
    if (!csrfResponse.ok || !csrfBody?.csrfToken) {
      throw new Error(csrfBody?.error?.message || 'تعذر التحقق من الطلب. أعد تحميل الصفحة.');
    }
    headers.set('x-csrf-token', csrfBody.csrfToken);
  }
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json() : null;
  if (!response.ok) {
    const err = body?.error;
    throw new Error(err?.message || `تعذر إتمام الطلب (${response.status})`);
  }
  return body as T;
}
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(value),
  );
const formatSize = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} ك.ب`
    : `${(n / 1024 / 1024).toFixed(1)} م.ب`;
function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <b />
    </span>
  );
}
function Notice() {
  return (
    <div className="notice" role="note">
      <AlertTriangle size={19} />
      <div>
        <strong>تنبيه مهم</strong>
        <span>
          النتائج آلية وغير نهائية، ولا تمثل رأيًا أو بحثًا قانونيًا. لا ترفع مستندات حقيقية إلى النسخة
          التجريبية؛ النص ينتقل إلى Manus للمعالجة. حذف التطبيق لا يمحو كائن التخزين نهائيًا.
        </span>
      </div>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        ref={ref}
      >
        <button className="icon-btn dialog-close" onClick={onClose} aria-label="إغلاق">
          <X size={18} />
        </button>
        <h2 id="dialog-title">{title}</h2>
        <div>{children}</div>
        {actions && <footer className="dialog-actions">{actions}</footer>}
      </section>
    </div>
  );
}
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<
    'newcase' | 'deletecase' | 'deletedoc' | 'source' | 'consent' | 'edit-title' | null
  >(null);
  const [source, setSource] = useState<SourceRef | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [summary, setSummary] = useState('');
  const [events, setEvents] = useState<Event[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [saveState, setSaveState] = useState('');
  const [fileError, setFileError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const route = useLocation();
  const loadCases = useCallback(async () => {
    const data = await request<CaseRecord[]>('/cases');
    setCases(data);
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    setError('');
    try {
      const data = await request<Detail>(`/cases/${id}`);
      setDetail(data);
      setSelectedId(id);
      setTitle(data.case.title);
      setSummary(data.analysis?.summary || '');
      setEvents(data.analysis?.events || []);
      setEntities(data.analysis?.entities || []);
    } catch (e) {
      setError((e as Error).message);
      setDetail(null);
    }
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await request<Session>('/session');
        if (!live) return;
        setSession(s);
        if (s.authenticated) {
          const list = await request<CaseRecord[]>('/cases');
          if (!live) return;
          setCases(list);
        }
      } catch (e) {
        if (live) setSessionError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    const requestedId = route.pathname.match(/^\/cases\/([^/]+)\/?$/)?.[1];
    if (requestedId && !cases.some((item) => item.id === requestedId)) {
      navigate('/');
      return;
    }
    const id = requestedId || cases[0]?.id;
    if (id && id !== selectedId) void loadDetail(id);
    if (!id && selectedId) {
      setDetail(null);
      setSelectedId('');
    }
  }, [cases, loadDetail, navigate, route.pathname, selectedId, session?.authenticated]);
  const active = detail?.case;
  const docs = detail?.documents || [];
  const analysis = detail?.analysis || null;
  const filtered = useMemo(
    () =>
      cases.filter((c) => c.title.toLocaleLowerCase('ar').includes(search.toLocaleLowerCase('ar'))),
    [cases, search],
  );
  const updateEvent = (id: string, changes: Partial<Event>) => {
    setEvents((current) =>
      current.map((event) =>
        event.id === id ? { ...event, ...changes, reviewStatus: 'edited' } : event,
      ),
    );
  };
  const updateEntity = (id: string, changes: Partial<Entity>) => {
    setEntities((current) =>
      current.map((entity) =>
        entity.id === id ? { ...entity, ...changes, reviewStatus: 'edited' } : entity,
      ),
    );
  };
  const startLogin = async () => {
    setBusy(true);
    setSessionError('');
    try {
      const csrf = await request<{ csrfToken: string }>('/auth/csrf', { method: 'POST' });
      const result = await request<{ authorizationUrl: string }>('/auth/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf.csrfToken },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      window.location.assign(result.authorizationUrl);
    } catch (e) {
      setSessionError((e as Error).message);
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      const csrf = await request<{ csrfToken: string }>('/auth/csrf', { method: 'POST' });
      await request('/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf.csrfToken },
      });
      setSession({ authenticated: false, user: null });
      setCases([]);
      setDetail(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const createCase = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const created = await request<CaseRecord>('/cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      await loadCases();
      setModal(null);
      setTitle('');
      setSelectedId(created.id);
      await loadDetail(created.id);
      navigate(`/cases/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const renameCase = async (e: FormEvent) => {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    try {
      await request(`/cases/${active.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      await loadCases();
      await loadDetail(active.id);
      setModal(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteCase = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await request(`/cases/${active.id}`, { method: 'DELETE' });
      const rest = cases.filter((c) => c.id !== active.id);
      setCases(rest);
      setModal(null);
      if (rest[0]) {
        await loadDetail(rest[0].id);
        navigate(`/cases/${rest[0].id}`);
      } else {
        setDetail(null);
        setSelectedId('');
        navigate('/');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!active) return;
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const invalid = files.find((f) => !(/\.pdf$/i.test(f.name) || /\.docx$/i.test(f.name)));
    if (invalid) {
      setFileError(`«${invalid.name}»: يُقبل PDF أو DOCX فقط.`);
      return;
    }
    setFileError('');
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    setBusy(true);
    try {
      await request(`/cases/${active.id}/documents`, { method: 'POST', body: fd });
      await loadDetail(active.id);
      await loadCases();
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const removeDoc = async (doc: Document) => {
    setBusy(true);
    try {
      const result = await request<{ ok: true; physicalDelete: false; message: string }>(
        `/documents/${doc.id}`,
        { method: 'DELETE' },
      );
      setError(result.message);
      setModal(null);
      if (active) await loadDetail(active.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const showSource = async (ref: SourceRef) => {
    setSource(ref);
    setSourceText(ref.excerpt);
    setModal('source');
    try {
      const list = await request<
        Array<{
          id: string;
          documentId: string;
          fileName: string;
          pageNumber: number | null;
          segmentNumber: number;
          text: string;
        }>
      >(`/documents/${ref.documentId}/sources`);
      const match = list.find((s) => s.id === ref.segmentId);
      if (match) setSourceText(match.text);
    } catch (e) {
      setSourceText(ref.excerpt || `تعذر تحميل المقتطف: ${(e as Error).message}`);
    }
  };
  const download = (doc: Document) => {
    const link = document.createElement('a');
    link.href = `${API}/documents/${doc.id}/download`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };
  const saveAnalysis = async () => {
    if (!analysis || !active) return;
    setBusy(true);
    setSaveState('جاري الحفظ…');
    try {
      await request(`/cases/${active.id}/analysis`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          summary,
          summarySources: analysis.summarySources,
          events,
          entities,
          reviewNotes: analysis.reviewNotes,
        }),
      });
      await loadDetail(active.id);
      setSaveState('حُفظت التعديلات');
      setTimeout(() => setSaveState(''), 2600);
    } catch (e) {
      setSaveState((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runAnalysis = async () => {
    if (!active) return;
    setAnalyzing(true);
    setModal(null);
    setError('');
    try {
      await request(`/cases/${active.id}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consentToAiProcessing: true }),
      });
      await loadDetail(active.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };
  if (loading)
    return (
      <div className="center-state">
        <LoaderCircle className="spin" />
        <span>جارٍ التحقق من الجلسة…</span>
      </div>
    );
  if (sessionError && !session)
    return (
      <main className="auth-page">
        <div className="auth-card">
          <Mark />
          <h1>تعذر الاتصال</h1>
          <p>{sessionError}</p>
          <button className="primary" onClick={() => location.reload()}>
            <RefreshCw size={17} /> إعادة المحاولة
          </button>
        </div>
      </main>
    );
  if (!session?.authenticated)
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <Mark />
            <span>مِعيار</span>
          </div>
          <span className="eyebrow">مساحة مراجعة المستندات</span>
          <h1>
            كل نتيجة،
            <br />
            <em>تعود إلى مصدرها.</em>
          </h1>
          <p className="auth-copy">
            نظّم وثائق القضايا، وتتبّع الإحالات، وراجع مسودة آلية في مساحة واحدة.
          </p>
          <button className="primary wide" onClick={startLogin} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowLeft size={18} />} المتابعة
            عبر Manus
          </button>
          {sessionError && (
            <p className="inline-error" role="alert">
              {sessionError}
            </p>
          )}
          <div className="auth-assurance">
            <ShieldCheck size={17} /> لا تُعرض بياناتك قبل التحقق من الجلسة
          </div>
          <Notice />
          <p className="auth-foot">منصة تنظيم ومراجعة — ليست أداة لاتخاذ قرارات قانونية.</p>
        </div>
        <div className="auth-side">
          <div className="side-lines">
            <span />
            <span />
            <span />
            <b />
          </div>
          <div>
            <p>شبكة الإحالات</p>
            <h2>
              اقرأ المستند.
              <br />
              راجع النتيجة.
              <br />
              <i>افتح المصدر.</i>
            </h2>
            <div className="side-citation">
              <span>إحالة 01</span>
              <div />
              كل نتيجة تقودك إلى موضعها في المستند.
            </div>
          </div>
          <span className="side-index">مِعيار · مساحة عمل للمستندات</span>
        </div>
      </main>
    );
  return (
    <>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            onClick={() => setMobileNav(!mobileNav)}
            aria-label="القائمة"
          >
            <Menu />
          </button>
          <Link to="/" className="brand">
            <Mark />
            <span>مِعيار</span>
          </Link>
          <div className="topbar-center">
            <span>مساحة العمل</span>
            <ChevronLeft size={15} />
            <b>{active?.title || 'القضايا'}</b>
          </div>
          <div className="top-actions">
            <span className="user-chip">
              <span className="avatar">
                <UserRound size={16} />
              </span>
              {session.user?.name || 'المستخدم'}
            </span>
            <button
              className="icon-btn"
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <Notice />
        <div className="layout">
          <aside className={`sidebar ${mobileNav ? 'nav-open' : ''}`}>
            <div className="side-heading">
              <span>مساحة العمل</span>
              <button
                className="icon-btn"
                aria-label="إغلاق القائمة"
                onClick={() => setMobileNav(false)}
              >
                <X size={17} />
              </button>
            </div>
            <button
              className="new-case"
              onClick={() => {
                setTitle('');
                setModal('newcase');
              }}
            >
              <Plus size={17} /> قضية جديدة <kbd>+</kbd>
            </button>
            <label className="search">
              <Search size={16} />
              <input
                placeholder="ابحث في القضايا"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span>/</span>
            </label>
            <div className="list-label">
              قضاياك <span>{cases.length}</span>
            </div>
            <nav className="case-list" aria-label="القضايا">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  className={`case-item ${c.id === selectedId ? 'selected' : ''}`}
                  onClick={() => {
                    loadDetail(c.id);
                    navigate(`/cases/${c.id}`);
                    setMobileNav(false);
                  }}
                >
                  <span className="case-dot" />
                  <span className="case-item-text">
                    <b>{c.title}</b>
                    <small>{c.documentCount ?? 0} مستندات</small>
                  </span>
                  <ChevronLeft size={15} />
                </button>
              ))}
              {!filtered.length && (
                <p className="empty-list">
                  {cases.length ? 'لا نتائج مطابقة' : 'لا توجد قضايا بعد'}
                </p>
              )}
            </nav>
            <div className="sidebar-foot">
              <BookOpen size={16} />
              <span>كل إحالة قابلة للفتح والمراجعة</span>
            </div>
          </aside>
          <main className="main-area">
            {error && (
              <div className="error-banner" role="alert">
                <AlertTriangle size={17} />
                {error}
                <button className="icon-btn" onClick={() => setError('')} aria-label="إغلاق">
                  <X size={15} />
                </button>
              </div>
            )}
            {!active ? (
              <section className="empty-work">
                <div className="empty-icon">
                  <Files size={26} />
                </div>
                <span className="eyebrow">ابدأ مساحة منظمة</span>
                <h1>
                  القضية الأولى،
                  <br />
                  <em>تبدأ من هنا.</em>
                </h1>
                <p>أنشئ قضية لإضافة مستنداتك وربط كل ملخص أو حدث بمصدره.</p>
                <button
                  className="primary"
                  onClick={() => {
                    setTitle('');
                    setModal('newcase');
                  }}
                >
                  <Plus size={17} /> إنشاء قضية
                </button>
                <div className="empty-rule">
                  <span />
                  لا تستخدم مستندات حقيقية في النسخة التجريبية
                </div>
              </section>
            ) : (
              <>
                <div className="case-header">
                  <div>
                    <div className="breadcrumbs">
                      <span>القضايا</span>
                      <ChevronLeft size={14} />
                      <span>مساحة مراجعة</span>
                    </div>
                    <div className="title-row">
                      <h1>{active.title}</h1>
                      <button
                        className="icon-btn"
                        onClick={() => {
                          setTitle(active.title);
                          setModal('edit-title');
                        }}
                        aria-label="تعديل عنوان القضية"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => setModal('deletecase')}
                        aria-label="حذف القضية"
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </div>
                    <p className="case-meta">
                      أُنشئت {formatDate(active.createdAt)} <span>·</span> {docs.length} مستندات
                    </p>
                  </div>
                  <button
                    className="outline-button"
                    onClick={() => uploadRef.current?.click()}
                    disabled={busy}
                  >
                    <FilePlus2 size={17} /> إضافة مستند
                  </button>
                  <input
                    ref={uploadRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    multiple
                    hidden
                    onChange={upload}
                  />
                </div>
                {fileError && (
                  <div className="error-banner" role="alert">
                    {fileError}
                    <button
                      className="icon-btn"
                      onClick={() => setFileError('')}
                      aria-label="إغلاق"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                <div className="content-grid">
                  <div className="review-column">
                    <section className="panel docs-panel">
                      <div className="section-head">
                        <div>
                          <span className="section-kicker">المواد الأصلية</span>
                          <h2>
                            المستندات <span className="count-pill">{docs.length}</span>
                          </h2>
                        </div>
                        <button className="text-button" onClick={() => uploadRef.current?.click()}>
                          <Plus size={16} /> رفع ملفات
                        </button>
                      </div>
                      {!docs.length ? (
                        <div className="docs-empty">
                          <UploadCloud size={24} />
                          <div>
                            <b>ابدأ بإضافة مستندات القضية</b>
                            <span>PDF أو DOCX · يمكنك اختيار أكثر من ملف</span>
                          </div>
                          <button
                            className="small-button"
                            onClick={() => uploadRef.current?.click()}
                          >
                            اختيار الملفات
                          </button>
                        </div>
                      ) : (
                        <div className="doc-list">
                          {docs
                            .filter((d) => d.status !== 'deleted')
                            .map((doc) => (
                              <div className="doc-row" key={doc.id}>
                                <div
                                  className={`file-icon ${doc.mimeType === 'application/pdf' ? 'pdf' : ''}`}
                                >
                                  <FileText size={18} />
                                </div>
                                <div className="doc-info">
                                  <b>{doc.fileName}</b>
                                  <span>
                                    {formatSize(doc.sizeBytes)}
                                    {doc.pageCount ? ` · ${doc.pageCount} صفحة` : ''} ·{' '}
                                    {doc.sourceCount} إحالة
                                  </span>
                                </div>
                                <span className={`status status-${doc.status}`}>
                                  {doc.status === 'ready'
                                    ? 'جاهز'
                                    : doc.status === 'processing'
                                      ? 'قيد المعالجة'
                                      : doc.status === 'failed'
                                        ? 'تعذر المعالجة'
                                        : 'محذوف'}
                                </span>
                                {doc.errorMessage && (
                                  <span className="doc-error">{doc.errorMessage}</span>
                                )}
                                <button
                                  className="icon-btn"
                                  aria-label={`تنزيل ${doc.fileName}`}
                                  title="فتح المستند"
                                  onClick={() => download(doc)}
                                >
                                  <ArrowDownToLine size={16} />
                                </button>
                                <button
                                  className="icon-btn danger-icon"
                                  aria-label={`حذف ${doc.fileName}`}
                                  title="حذف المستند"
                                  onClick={() => {
                                    setSource({
                                      documentId: doc.id,
                                      fileName: doc.fileName,
                                      segmentId: '',
                                      pageNumber: null,
                                      segmentNumber: 0,
                                      excerpt: '',
                                    });
                                    setModal('deletedoc');
                                  }}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            ))}
                        </div>
                      )}
                      {busy && (
                        <div className="upload-progress">
                          <LoaderCircle className="spin" size={16} /> جاري رفع الملفات ومعالجتها…
                        </div>
                      )}
                    </section>
                    <section className="panel analysis-panel">
                      <div className="section-head">
                        <div>
                          <span className="section-kicker">مسودة للمراجعة</span>
                          <h2>الملخص</h2>
                        </div>
                        <div className="analysis-head-actions">
                          {analysis && (
                            <button
                              className="text-button rerun-button"
                              disabled={analyzing || docs.every((doc) => doc.status !== 'ready')}
                              onClick={() => setModal('consent')}
                            >
                              {analyzing ? (
                                <LoaderCircle className="spin" size={14} />
                              ) : (
                                <RefreshCw size={14} />
                              )}
                              إعادة التحليل
                            </button>
                          )}
                          <span className={`draft-label ${analysis ? '' : 'muted'}`}>
                            <span />{' '}
                            {analysis?.status === 'edited' ? 'مُعدّل للمراجعة' : 'مسودة آلية'}
                          </span>
                        </div>
                      </div>
                      {analysis ? (
                        <>
                          <p className="editor-hint">
                            <Pencil size={14} /> حرّر الملخص والأحداث والأسماء ثم احفظ المراجعة؛ تبقى
                            الإحالات مرتبطة بالمصدر.
                          </p>
                          <textarea
                            className="summary-editor"
                            value={summary}
                            maxLength={12000}
                            onChange={(e) => setSummary(e.target.value)}
                            aria-label="تحرير ملخص القضية"
                          />
                          <div className="citation-row">
                            <span className="citation-label">مصادر الملخص</span>
                            {analysis.summarySources.map((s, i) => (
                              <button
                                key={`${s.segmentId}-${i}`}
                                className="citation"
                                onClick={() => showSource(s)}
                              >
                                <span>{String(i + 1).padStart(2, '0')}</span>
                                {s.fileName}
                                <small>
                                  {s.pageNumber ? `ص ${s.pageNumber}` : `مقطع ${s.segmentNumber}`}
                                </small>
                                <ArrowUpRight size={13} />
                              </button>
                            ))}
                          </div>
                          <div className="save-row">
                            <span className="save-state" aria-live="polite">
                              {saveState}
                            </span>
                            <button
                              className="primary small-primary"
                              onClick={saveAnalysis}
                              disabled={busy || !summary.trim()}
                            >
                              {busy ? (
                                <LoaderCircle className="spin" size={16} />
                              ) : (
                                <Check size={16} />
                              )}{' '}
                              حفظ المراجعة
                            </button>
                          </div>
                          {analysis.reviewNotes.length > 0 && (
                            <div className="review-warnings" role="note">
                              <strong>حدود المراجعة</strong>
                              <ul>
                                {analysis.reviewNotes.map((note, index) => (
                                  <li key={`${index}-${note}`}>{note}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="analysis-empty">
                          <div className="sparkle-icon">
                            <Sparkles size={21} />
                          </div>
                          <div>
                            <b>لا توجد مسودة تحليل بعد</b>
                            <p>بعد إضافة المستندات، يمكنك طلب مسودة آلية بموافقتك الصريحة.</p>
                          </div>
                          <button
                            className="primary"
                            disabled={
                              !docs.length || analyzing || docs.every((d) => d.status !== 'ready')
                            }
                            onClick={() => setModal('consent')}
                          >
                            {analyzing ? (
                              <>
                                <LoaderCircle className="spin" size={16} /> جارٍ إعداد المسودة
                              </>
                            ) : (
                              <>
                                <Sparkles size={16} /> إعداد مسودة
                              </>
                            )}
                          </button>
                        </div>
                      )}
                      {analysis && (
                        <div className="review-note">
                          <CircleHelp size={15} />
                          <span>راجع كل إحالة في المستند الأصلي؛ لا تعتمد على الملخص وحده.</span>
                        </div>
                      )}
                    </section>
                    {analysis && (
                      <section className="panel timeline-panel">
                        <div className="section-head">
                          <div>
                            <span className="section-kicker">ترتيب حسب ما ورد في المصادر</span>
                            <h2>
                              <Clock3 size={19} /> خط زمني{' '}
                              <span className="count-pill">{events.length}</span>
                            </h2>
                          </div>
                        </div>
                        {events.length ? (
                          <div className="timeline">
                            {events.map((event, index) => (
                              <article className="timeline-item" key={event.id}>
                                <div className="timeline-marker">
                                  {String(index + 1).padStart(2, '0')}
                                </div>
                                <div className="timeline-body">
                                  <div className="event-meta">
                                    <input
                                      className="inline-edit event-date"
                                      aria-label={`تحرير مرجع تاريخ الحدث ${index + 1}`}
                                      value={event.dateLabel}
                                      maxLength={250}
                                      onChange={(e) =>
                                        updateEvent(event.id, {
                                          dateLabel: e.target.value,
                                          date: null,
                                        })
                                      }
                                    />
                                    <span className={`review-status status-${event.reviewStatus}`}>
                                      {event.reviewStatus === 'approved'
                                        ? 'مراجع'
                                        : event.reviewStatus === 'edited'
                                          ? 'معدّل'
                                          : 'مسودة'}
                                    </span>
                                  </div>
                                  <textarea
                                    className="inline-edit event-description"
                                    aria-label={`تحرير وصف الحدث ${index + 1}`}
                                    value={event.description}
                                    maxLength={4000}
                                    rows={2}
                                    onChange={(e) =>
                                      updateEvent(event.id, { description: e.target.value })
                                    }
                                  />
                                  <textarea
                                    className="inline-edit event-significance"
                                    aria-label={`تحرير ملاحظة الحدث ${index + 1}`}
                                    value={event.significance || ''}
                                    placeholder="ملاحظة للمراجعة (اختيارية)"
                                    maxLength={2500}
                                    rows={2}
                                    onChange={(e) =>
                                      updateEvent(event.id, { significance: e.target.value })
                                    }
                                  />
                                  <div className="inline-citations">
                                    {event.sources.map((s, i) => (
                                      <button
                                        className="citation mini"
                                        key={`${s.segmentId}-${i}`}
                                        onClick={() => showSource(s)}
                                      >
                                        <span>{i + 1}</span>
                                        {s.fileName}
                                        <small>
                                          {s.pageNumber
                                            ? `ص ${s.pageNumber}`
                                            : `مقطع ${s.segmentNumber}`}
                                        </small>
                                        <ArrowUpRight size={12} />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className="sub-empty">لم تُسجل أحداث في هذه المسودة.</div>
                        )}
                      </section>
                    )}
                    {analysis && (
                      <section className="panel entities-panel">
                        <div className="section-head">
                          <div>
                            <span className="section-kicker">أسماء وكيانات وردت في النص</span>
                            <h2>
                              <UserRound size={19} /> الأسماء{' '}
                              <span className="count-pill">{entities.length}</span>
                            </h2>
                          </div>
                        </div>
                        {entities.length ? (
                          <div className="entity-list">
                            {entities.map((ent) => (
                              <div className="entity-row" key={ent.id}>
                                <span className="entity-avatar">
                                  <UserRound size={16} />
                                </span>
                                <div className="entity-info">
                                  <input
                                    className="inline-edit entity-name"
                                    aria-label={`تحرير اسم ${ent.name}`}
                                    value={ent.name}
                                    maxLength={200}
                                    onChange={(e) => updateEntity(ent.id, { name: e.target.value })}
                                  />
                                  <small className="entity-kind">
                                    {{
                                      person: 'شخص',
                                      organization: 'جهة',
                                      place: 'مكان',
                                      document: 'مستند',
                                      other: 'كيان',
                                    }[ent.type] || 'كيان'}
                                  </small>
                                  <input
                                    className="inline-edit entity-role"
                                    aria-label={`تحرير صفة ${ent.name}`}
                                    value={ent.role || ''}
                                    placeholder="صفة أو دور (اختياري)"
                                    maxLength={500}
                                    onChange={(e) => updateEntity(ent.id, { role: e.target.value })}
                                  />
                                </div>
                                <span className={`review-status status-${ent.reviewStatus}`}>
                                  {ent.reviewStatus === 'approved'
                                    ? 'مراجع'
                                    : ent.reviewStatus === 'edited'
                                      ? 'معدّل'
                                      : 'مسودة'}
                                </span>
                                <div className="inline-citations">
                                  {ent.sources.map((s, i) => (
                                    <button
                                      className="citation mini"
                                      key={`${s.segmentId}-${i}`}
                                      onClick={() => showSource(s)}
                                    >
                                      <span>{i + 1}</span>
                                      {s.fileName}
                                      <small>
                                        {s.pageNumber
                                          ? `ص ${s.pageNumber}`
                                          : `مقطع ${s.segmentNumber}`}
                                      </small>
                                      <ArrowUpRight size={12} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="sub-empty">لم تُستخرج أسماء لهذه المسودة.</div>
                        )}
                      </section>
                    )}
                  </div>
                  <aside className="insights-column">
                    <div className="sticky-aside">
                      <section className="aside-card">
                        <div className="aside-card-head">
                          <span className="aside-number">01</span>
                          <span>شبكة الإحالات</span>
                        </div>
                        <h3>المصدر قبل الاستنتاج.</h3>
                        <p>
                          كل ملخص أو حدث أو اسم مرتبط بمقتطف محدد. افتح الإحالة للتحقق من موضعها.
                        </p>
                        <div className="aside-stat">
                          <span className="stat-value">
                            {docs.reduce((n, d) => n + d.sourceCount, 0)}
                          </span>
                          <span>موضع مصدر متاح</span>
                        </div>
                        <div className="aside-foot">
                          <span className="teal-dot" /> الإحالات تفتح المصدر المرتبط مباشرة
                        </div>
                      </section>
                      <section className="aside-card integrity-card">
                        <ShieldCheck size={19} />
                        <h3>مراجعة بشرية مطلوبة</h3>
                        <p>
                          المخرجات مسودات آلية؛ قد تخطئ أو تُسقط سياقًا. تحقّق من كل اقتباس في المستند.
                        </p>
                      </section>
                      <button
                        className="help-link"
                        onClick={() =>
                          setError('تُحمّل المصادر من واجهة المستندات المحمية بجلسة المستخدم.')
                        }
                      >
                        <CircleHelp size={16} /> كيف تعمل الإحالات؟
                      </button>
                    </div>
                  </aside>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
      {modal === 'newcase' && (
        <Modal title="إنشاء قضية" onClose={() => setModal(null)}>
          <p className="dialog-copy">اختر عنوانًا يسهل تمييز مساحة المستندات.</p>
          <form onSubmit={createCase}>
            <label className="field-label">
              عنوان القضية
              <input
                autoFocus
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: ملف تجريبي"
                required
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="outline-button" onClick={() => setModal(null)}>
                إلغاء
              </button>
              <button className="primary" disabled={busy || !title.trim()}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} إنشاء
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'edit-title' && (
        <Modal title="تعديل عنوان القضية" onClose={() => setModal(null)}>
          <form onSubmit={renameCase}>
            <label className="field-label">
              العنوان
              <input
                autoFocus
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="outline-button" onClick={() => setModal(null)}>
                إلغاء
              </button>
              <button className="primary" disabled={busy || !title.trim()}>
                <Check size={16} /> حفظ
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'deletecase' && (
        <Modal title="حذف القضية؟" onClose={() => setModal(null)}>
          <p className="dialog-copy">
            سيؤدي ذلك إلى حذف القضية ومستنداتها وبياناتها من التطبيق. لا يمحو هذا كائنات التخزين
            نهائيًا.
          </p>
          <div className="dialog-actions">
            <button className="outline-button" onClick={() => setModal(null)}>
              إبقاء القضية
            </button>
            <button className="danger-button" disabled={busy} onClick={deleteCase}>
              <Trash2 size={16} /> حذف القضية
            </button>
          </div>
        </Modal>
      )}
      {modal === 'deletedoc' && (
        <Modal title="حذف المستند؟" onClose={() => setModal(null)}>
          <p className="dialog-copy">
            سيُزال النص المستخرج والإحالات من التطبيق. حذف التطبيق لا يمحو كائن التخزين نهائيًا، ولا
            يُضمن الحذف المادي.
          </p>
          <p className="delete-file">
            <FileText size={17} />
            {source?.fileName}
          </p>
          <div className="dialog-actions">
            <button className="outline-button" onClick={() => setModal(null)}>
              إلغاء
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                source &&
                docs.find((d) => d.id === source.documentId) &&
                removeDoc(docs.find((d) => d.id === source.documentId)!)
              }
            >
              <Trash2 size={16} /> حذف من التطبيق
            </button>
          </div>
        </Modal>
      )}
      {modal === 'consent' && (
        <Modal title="موافقة على معالجة النص" onClose={() => setModal(null)}>
          <div className="consent-box">
            <AlertTriangle size={20} />
            <p>
              عند المتابعة، ستُرسل نصوص المستندات الجاهزة إلى Manus لمعالجتها وإنشاء{' '}
              <strong>مسودة آلية</strong> للملخص والأحداث والأسماء.
            </p>
          </div>
          <ul className="consent-list">
            <li>لا تُرفع مستندات حقيقية أو حساسة إلى النسخة التجريبية.</li>
            <li>النتائج غير نهائية ولا تمثل رأيًا أو بحثًا قانونيًا.</li>
            <li>يمكنك مراجعة النتائج ومصادرها قبل حفظ أي تعديل.</li>
          </ul>
          <div className="dialog-actions">
            <button className="outline-button" onClick={() => setModal(null)}>
              ليس الآن
            </button>
            <button className="primary" onClick={runAnalysis}>
              <ShieldCheck size={16} /> أوافق، ابدأ إعداد المسودة
            </button>
          </div>
        </Modal>
      )}
      {modal === 'source' && source && (
        <Modal title="مقتطف المصدر" onClose={() => setModal(null)}>
          <div className="source-meta">
            <span className="file-icon">
              <FileText size={17} />
            </span>
            <div>
              <b>{source.fileName}</b>
              <small>
                {source.pageNumber
                  ? `الصفحة ${source.pageNumber}`
                  : `المقطع ${source.segmentNumber}`}
              </small>
            </div>
          </div>
          <blockquote className="source-excerpt">
            {sourceText || 'لا يتوفر مقتطف لهذا المرجع.'}
          </blockquote>
          <p className="source-note">
            هذا هو النص المرتبط بالإحالة. راجع المستند الأصلي للتأكد من السياق.
          </p>
          <div className="dialog-actions">
            <button className="outline-button" onClick={() => setModal(null)}>
              إغلاق
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export default App;
