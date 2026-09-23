/**
 * @file 进入考试 API — POST /api/tools/exam/[id]/start（BFF 薄转发）
 * 后端随机抽 10 题建场次；已交卷则直返成绩（不可重考），未交卷续答同一组抽题。
 */
import { NextResponse } from 'next/server';
import { assertAllowedOrigin } from '@/shared/security/security';
import { clearAuthCookies, normalizeError, proxyBackend, setAuthCookies } from '@/shared/backend-client';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originErr = assertAllowedOrigin(req);
  if (originErr) return originErr;

  const { id } = await params;
  const proxy = await proxyBackend(req, {
    path: `/tools/exam/${encodeURIComponent(id)}/start`,
    method: 'POST',
  });

  if (proxy.status !== 200) {
    const err = normalizeError(proxy.body, '进入考试失败');
    const res = NextResponse.json(err, { status: proxy.status });
    if (proxy.clearAuth) clearAuthCookies(res);
    return res;
  }

  const b = (proxy.body ?? {}) as Record<string, unknown>;
  const questions = (Array.isArray(b.questions) ? b.questions : []) as Array<
    Record<string, unknown>
  >;
  const res = NextResponse.json({
    runId: String(b.run_id),
    status: b.status,
    totalQuestions: Number(b.total_questions ?? questions.length),
    startedAt: b.started_at ?? null,
    finished: Boolean(b.finished),
    correctCount: b.correct_count ?? null,
    score: b.score ?? null,
    maxScore: b.max_score ?? null,
    // 公开答题：选项不含正确答案
    questions: questions.map((q) => ({
      id: String(q.id),
      examId: String(q.exam_id),
      type: q.type,
      title: q.title,
      contentMarkdown: q.content_markdown ?? null,
      score: q.score ?? 0,
      sortOrder: q.sort_order ?? 0,
      createdAt: q.created_at ?? '',
      options: Array.isArray(q.options)
        ? q.options.map((o) => ({
            id: `${String(q.id)}-${o.label}`,
            questionId: String(q.id),
            label: o.label,
            content: o.content,
            sortOrder: o.sort_order ?? 0,
          }))
        : [],
    })),
  });
  if (proxy.authPair) setAuthCookies(res, proxy.authPair);
  return res;
}