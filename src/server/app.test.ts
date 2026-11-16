import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import app from './app.js';

describe('واجهات الصحة والجلسة وCSRF', () => {
  it('يعرض حالة صحة الخادم دون تسريب بيانات', async () => {
    const response = await supertest(app).get('/healthz').expect(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('يعيد حالة غير مسجلة الدخول دون استعلامات تعديل', async () => {
    const response = await supertest(app).get('/api/session').expect(200);
    expect(response.body).toEqual({ authenticated: false, user: null });
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('يصدر CSRF فقط لعنوان HTTPS صحيح', async () => {
    const response = await supertest(app)
      .post('/api/auth/csrf')
      .set('Origin', 'https://workspace.example')
      .expect(200);
    expect(response.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('qadi_csrf=')]),
    );
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('يرفض أصلًا غير مشفر للمتصفح العام', async () => {
    await supertest(app)
      .post('/api/auth/csrf')
      .set('Origin', 'http://workspace.example')
      .expect(403);
  });
});
