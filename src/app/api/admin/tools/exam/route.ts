/**
 * @file 管理端考试 API — GET/POST /api/tools/admin/exam（BFF 薄转发）
 *
 * 字段映射约定：前端表单用 camelCase 提交（startTime/endTime/durationMinutes/techTags），
 * 后端 ExamInput 用 snake_case 接收；BFF 在此做转换。列表返回字段对齐后端 ExamOut，
 * 前端 tool-types.ts 的 Exam 类型同形（snake_case），编辑 Modal 直接消费列表项数据预填表单。
 */
import { NextResponse } from 'next/server';
import { assertAllowedOrigin } from '@/shared/security/security';
import { clearAuthCookies, normalizeError, proxyBackend, setAuthCookies } from '@/shared/backend-client';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Math.min(Number(url.searchParams.get('pageSize')) || 20, 50);

  const skip = (page - 1) * pageSize;
  const params = new URLSearchParams({ skip: String(skip), limit: String(pageSize) });
  if (status) params.set('status', status);

  const proxy = await proxyBackend(req, { path: `/tools/admin/exam?${params.toString()}` });
  const body = (proxy.body ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(body.items) ? body.items : []) as Array<Record<string, unknown>>;
  // 字段对齐后端 ExamOut（snake_case）：编辑 Modal 直接消费列表项数据预填表单，无需再调详情接口
  const res = NextResponse.json({
    exams: items.map((e) => ({
      id: String(e.id),
      title: e.title,
      description: e.description ?? null,
      status: e.status,
      start_time: e.start_time ?? null,
      end_time: e.end_time ?? null,
      duration_minutes: e.duration_minutes ?? 0,
      tech_tags: e.tech_tags ?? null,
      created_by: e.created_by ?? null,
      created_at: e.created_at ?? '',
      updated_at: e.updated_at ?? '',
    })),
    total: Number(body.total ?? 0),
    page,
    pageSize,
    totalPages: Number(body.total_pages ?? 1),
  });
  if (proxy.authPair) setAuthCookies(res, proxy.authPair);
  return res;
}

export async function POST(req: Request) {
  const originErr = assertAllowedOrigin(req);
  if (originErr) return originErr;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // 字段对齐后端 ExamInput（snake_case）：组卷走独立 /admin/exam/{id}/questions 接口，不在此处传 questions
  const proxy = await proxyBackend(req, {
    path: '/tools/admin/exam',
    method: 'POST',
    jsonBody: {
      title: body.title,
      description: body.description,
      status: body.status ?? 'draft',
      start_time: body.startTime,
      end_time: body.endTime,
      duration_minutes: body.durationMinutes,
      tech_tags: Array.isArray(body.techTags) ? body.techTags : undefined,
    },
  });

  if (proxy.status !== 200 && proxy.status !== 201) {
    const err = normalizeError(proxy.body, '创建失败');
    const res = NextResponse.json(err, { status: proxy.status });
    if (proxy.clearAuth) clearAuthCookies(res);
    return res;
  }
  const res = NextResponse.json({ exam: proxy.body }, { status: 201 });
  if (proxy.authPair) setAuthCookies(res, proxy.authPair);
  return res;
}