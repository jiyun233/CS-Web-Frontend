/**
 * @file 交卷 API — POST /api/tools/exam/[id]/finish（BFF 薄转发）
 * 后端判分并统计过题数量（答对数）。
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

  const body = (await req.json().catch(() => ({}))) as {
    runId?: string;
    answers?: Array<{ questionId?: string; answer?: string }>;
  };
  const { id } = await params;

  const proxy = await proxyBackend(req, {
    path: `/tools/exam/${encodeURIComponent(id)}/finish`,
    method: 'POST',
    jsonBody: {
      run_id: Number(body.runId),
      answers: Array.isArray(body.answers)
        ? body.answers.map((a) => ({
            question_id: Number(a.questionId),
            answer: a.answer,
          }))
        : [],
    },
  });

  if (proxy.status !== 200) {
    const err = normalizeError(proxy.body, '交卷失败');
    const res = NextResponse.json(err, { status: proxy.status });
    if (proxy.clearAuth) clearAuthCookies(res);
    return res;
  }
  const b = (proxy.body ?? {}) as Record<string, unknown>;
  const results = (Array.isArray(b.results) ? b.results : []) as Array<
    Record<string, unknown>
  >;
  const res = NextResponse.json({
    runId: String(b.run_id),
    correctCount: Number(b.correct_count ?? 0),
    totalQuestions: Number(b.total_questions ?? results.length),
    score: Number(b.score ?? 0),
    maxScore: Number(b.max_score ?? 0),
    results: results.map((r) => ({
      questionId: String(r.question_id),
      answer: r.answer ?? null,
      isCorrect: r.is_correct ?? null,
      score: r.score ?? null,
    })),
  });
  if (proxy.authPair) setAuthCookies(res, proxy.authPair);
  return res;
}