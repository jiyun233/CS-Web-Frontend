/**
 * @file 答题后投稿出题 API — POST /api/tools/exam/[id]/contribute（BFF 薄转发）
 * camelCase → snake_case：options.isCorrect→is_correct；题型固定 single_choice；出题人可空。
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originErr = assertAllowedOrigin(req);
  if (originErr) return originErr;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    author?: string;
    options?: OptionIn[];
  };
  const { id } = await params;

  const proxy = await proxyBackend(req, {
    path: `/tools/exam/${encodeURIComponent(id)}/contribute`,
    method: 'POST',
    jsonBody: {
      type: 'single_choice',
      title: body.title,
      author: body.author || undefined,
      options: Array.isArray(body.options)
        ? body.options.map((o) => ({
            label: o.label,
            content: o.content,
            is_correct: Boolean(o.isCorrect),
          }))
        : [],
    },
  });

  if (proxy.status !== 200 && proxy.status !== 201) {
    const err = normalizeError(proxy.body, '出题失败');
    const res = NextResponse.json(err, { status: proxy.status });
    if (proxy.clearAuth) clearAuthCookies(res);
    return res;
  }
  const res = NextResponse.json({ question: proxy.body }, { status: 201 });
  if (proxy.authPair) setAuthCookies(res, proxy.authPair);
  return res;
}