/**
 * @file 考试详情 API — GET /api/tools/exam/[id]（BFF 薄转发）
 * 仅返回考试元信息；随机抽的题目由 POST /start 提供（公开答题不泄露答案）。
 */
import { NextResponse } from 'next/server';
import { proxyBackend, setAuthCookies } from '@/shared/backend-client';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const proxy = await proxyBackend(req, {
    path: `/tools/exam/${encodeURIComponent(id)}`,
  });

  if (proxy.status !== 200) {
    return NextResponse.json({ exam: null });
  }
  const e = proxy.body as Record<string, unknown>;
  const res = NextResponse.json({
    exam: {
      id: String(e.id),
      title: e.title,
      description: e.description ?? null,
      status: e.status,
      startTime: e.start_time ?? null,
      endTime: e.end_time ?? null,
      durationMinutes: e.duration_minutes ?? 0,
      techTags: Array.isArray(e.tech_tags) ? e.tech_tags : [],
      createdBy: String(e.created_by),
      createdAt: e.created_at ?? '',
      updatedAt: e.updated_at ?? '',
    },
  });
  if (proxy.authPair) setAuthCookies(res, proxy.authPair);
  return res;
}