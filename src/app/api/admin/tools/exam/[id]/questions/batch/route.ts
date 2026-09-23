/**
 * @file 考试题目批量导入 API — POST /api/tools/admin/exam/[id]/questions/batch（BFF 薄转发）
 *
 * 字段映射约定：前端提交 camelCase（orderIndex/isCorrect/scorePerQuestion），
 * 后端 QuestionInput 用 snake_case（sort_order/is_correct）；BFF 在此做转换。
 * 后端单事务写入，任一题失败整体回滚。
 */
import { NextResponse } from 'next/server';
import { assertAllowedOrigin } from '@/shared/security/security';
import { clearAuthCookies, normalizeError, proxyBackend, setAuthCookies } from '@/shared/backend-client';

export const runtime = 'nodejs';

interface OptionIn {
  label: string;
  content: string;
  isCorrect: boolean;
}

interface QuestionIn {
  title: string;
  orderIndex?: number;
  author?: string;
  options: OptionIn[];
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originErr = assertAllowedOrigin(req);
  if (originErr) return originErr;

  const body = (await req.json().catch(() => ({}))) as {
    scorePerQuestion?: number;
    questions?: QuestionIn[];
  };
  const { id } = await params;

  const questions = Array.isArray(body.questions) ? body.questions : [];
  if (questions.length === 0) {
    return NextResponse.json({ error: '题目列表不能为空' }, { status: 400 });
  }

  // camelCase → snake_case 对齐后端 QuestionInput；type 固定 single_choice（批量导入仅支持选择题）
  const proxy = await proxyBackend(req, {
    path: `/tools/admin/exam/${encodeURIComponent(id)}/questions/batch`,
    method: 'POST',
    jsonBody: {
      questions: questions.map((q) => ({
        type: 'single_choice',
        title: q.title,
        score: body.scorePerQuestion ?? 5,
        sort_order: q.orderIndex ?? 0,
        author: q.author ?? undefined,
        options: Array.isArray(q.options)
          ? q.options.map((o) => ({
              label: o.label,
              content: o.content,
              is_correct: Boolean(o.isCorrect),
            }))
          : [],
      })),
    },
  });

  if (proxy.status !== 200 && proxy.status !== 201) {
    const err = normalizeError(proxy.body, '导入失败');
    const res = NextResponse.json(err, { status: proxy.status });
    if (proxy.clearAuth) clearAuthCookies(res);
    return res;
  }
  const data = (proxy.body ?? {}) as Record<string, unknown>;
  const res = NextResponse.json(
    { count: Number(data.count ?? 0), questions: data.questions ?? [] },
    { status: 201 },
  );
  if (proxy.authPair) setAuthCookies(res, proxy.authPair);
  return res;
}