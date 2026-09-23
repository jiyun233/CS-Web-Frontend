/**
 * @file 考试题库批量导入 — 解析器 + 导入模态框（从 tool-exam-manage 按关注点拆出）
 *
 * 两种录入模式：
 * 1. 逐个录入（默认）：填写题目 → 填写选项 A-D 内容 → 选择正确答案 → 出题人（选填）→
 *    「下一题」继续录入 / 「填写完毕」一次提交；
 * 2. 粘贴导入：粘贴约定格式文本 → 解析预览 → 一次请求原子写入。
 * 粘贴解析支持从题干括号提取出题人昵称（如“…是谁（linge）”），并剔除单字符答案提示如 (c)。
 * 统一走 BFF POST /api/admin/tools/exam/[id]/questions/batch（后端单事务，任一失败整体回滚）。
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ModalShell, Field } from '@/modules/admin/ui/shared';
import { INPUT_CLASS } from '@/shared/utils/ui-constants';
import { useToast } from '@/components/feedback/toast';
import { Button } from '@/components';
import { apiRequest } from '@/shared/hooks/use-api-request';
import type { Exam } from './tool-types';

/** 解析后的单道选择题（含正确答案标记与可选出题人） */
export interface ParsedQuestion {
  title: string;
  options: { label: string; content: string; isCorrect: boolean }[];
  author?: string;
}

/** 结构化解析错误：qNo 定位题目，key/values 供 i18n 渲染 */
export interface QuestionParseError {
  qNo: number;
  key:
    | 'qErrTitle'
    | 'qErrOptions'
    | 'qErrMissingOption'
    | 'qErrAnswer'
    | 'qErrAnswerInvalid';
  values?: Record<string, string | number>;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  errors: QuestionParseError[];
}

/** 选项行：A. / A、 / A) 开头（仅支持 A-D） */
const OPTION_LINE = /^([A-D])[.、)]\s*(.*)$/;
/** 答案行：答案 / answer + 中英冒号 + 单个 A-D 字母 */
const ANSWER_LINE = /^(?:答案|answer)\s*[:：]?\s*([A-Da-d])(?:\s|$)/i;
/** 题号前缀：1. / 1、 / 1) */
const QUESTION_NUM = /^\d+[.、)]\s*/;
/** 单选四选项固定 A-D */
const REQUIRED_LABELS = ['A', 'B', 'C', 'D'] as const;

/** 逐个录入模式的选项标签（固定 A-D） */
const FORM_LABELS = ['A', 'B', 'C', 'D'] as const;
type OptionLabel = (typeof FORM_LABELS)[number];

/** 出题人昵称的最大长度（超过视为题干限定语，不当作出题人） */
const AUTHOR_MAX_LEN = 6;

const EMPTY_FORM_OPTIONS: Record<OptionLabel, string> = {
  A: '',
  B: '',
  C: '',
  D: '',
};

/**
 * 提取首行题干中的出题人昵称并剔除答案提示括号（防泄题）。
 * 规则：从行尾逐层剥离括号组——
 * - 空括号 `（）`/`( )`：答案留白，剔除；
 * - 单字符 `(c)`/`（a）`：答案提示，剔除；
 * - 短昵称（≤6 字符）括号：记为出题人并剔除（如 “（linge）”“（紫薯喵）”）。
 */
function extractQuestionMeta(raw: string): { title: string; author?: string } {
  let t = raw.trim();
  let author: string | undefined;
  for (;;) {
    const m = t.match(/([（(][^（）()]*[）)])\s*$/);
    if (!m) break;
    const content = m[1].slice(1, -1).trim();
    if (content.length === 0 || content.length === 1) {
      // 答案留白 / 答案提示：直接剔除
      t = t.slice(0, -m[0].length).replace(/\s+$/, '');
    } else if (content.length <= AUTHOR_MAX_LEN && !author) {
      author = content;
      t = t.slice(0, -m[0].length).replace(/\s+$/, '');
    } else {
      // 多字符且超长（题干限定语等）：保留不动
      break;
    }
  }
  return { title: t.replace(/[：:。]\s*$/, '').trim(), author };
}

/** 把粘贴文本按空行分块；块内再按新题号行细分（未用空行分隔也能解析） */
function splitBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const blocks: string[] = [];
  for (const chunk of normalized.split(/\n\s*\n+/)) {
    let current: string[] = [];
    for (const line of chunk.split('\n')) {
      // 遇到新题号行且当前块已有内容 → 切块（首行题号不切）
      if (/^\d+[.、)]\s*\S/.test(line.trim()) && current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
      current.push(line);
    }
    if (current.length) blocks.push(current.join('\n'));
  }
  return blocks.filter((b) => b.trim());
}

/**
 * 解析批量导入文本为选择题数组（每题恰好 4 个选项 A-D + 1 个有效答案）。
 * 容错：题干可多行、题号可有可无、答案行中英冒号均可；出题人从首行括号提取；
 * 不合规的题记入 errors 不入 questions。
 */
export function parseChoiceQuestions(text: string): ParseResult {
  const questions: ParsedQuestion[] = [];
  const errors: QuestionParseError[] = [];

  splitBlocks(text).forEach((block, idx) => {
    const qNo = idx + 1;
    const titleLines: string[] = [];
    const options: { label: string; content: string }[] = [];
    let answer: string | null = null;
    let author: string | undefined;

    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const optionMatch = line.match(OPTION_LINE);
      if (optionMatch) {
        options.push({ label: optionMatch[1], content: optionMatch[2].trim() });
        continue;
      }
      const answerMatch = line.match(ANSWER_LINE);
      if (answerMatch) {
        answer = answerMatch[1].toUpperCase();
        continue;
      }
      // 选项行之前的内容归题干（首行剥掉题号前缀并提取出题人）；选项之后的杂行忽略（容错）
      if (options.length === 0) {
        if (titleLines.length === 0) {
          const meta = extractQuestionMeta(line.replace(QUESTION_NUM, ''));
          titleLines.push(meta.title);
          if (meta.author) author = meta.author;
        } else {
          titleLines.push(line);
        }
      }
    }

    const title = titleLines.join(' ').trim();
    const labels = new Set(options.map((o) => o.label));
    if (!title) errors.push({ qNo, key: 'qErrTitle' });
    if (options.length !== 4) {
      errors.push({ qNo, key: 'qErrOptions', values: { n: options.length } });
    }
    for (const label of REQUIRED_LABELS) {
      if (!labels.has(label)) {
        errors.push({ qNo, key: 'qErrMissingOption', values: { opt: label } });
      }
    }
    if (answer === null) {
      errors.push({ qNo, key: 'qErrAnswer' });
    } else if (!labels.has(answer)) {
      errors.push({ qNo, key: 'qErrAnswerInvalid', values: { ans: answer } });
    }

    if (title && options.length === 4 && answer !== null && labels.has(answer)) {
      questions.push({
        title,
        options: options.map((o) => ({ ...o, isCorrect: o.label === answer })),
        ...(author ? { author } : {}),
      });
    }
  });

  return { questions, errors };
}

/** 批量导入题库模态框：逐个录入（默认）/ 粘贴导入，切换录入方式 */
export function ExamImportModal({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const t = useTranslations('toolsAdmin');
  const tc = useTranslations('common');
  const { pushToast } = useToast();

  // 录入方式：form=逐个录入（默认） / paste=粘贴导入
  const [mode, setMode] = useState<'form' | 'paste'>('form');

  // ---- 粘贴模式 ----
  const [rawText, setRawText] = useState('');
  const [scorePerQuestion, setScorePerQuestion] = useState('5');
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  // ---- 逐个录入模式 ----
  const [fTitle, setFTitle] = useState('');
  const [fOptions, setFOptions] = useState<Record<OptionLabel, string>>(EMPTY_FORM_OPTIONS);
  const [fCorrect, setFCorrect] = useState<'' | OptionLabel>('');
  const [fAuthor, setFAuthor] = useState('');
  const [draft, setDraft] = useState<ParsedQuestion[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canImport = parsed !== null && parsed.questions.length > 0 && parsed.errors.length === 0;
  const canFinishForm = draft.length > 0;

  /** 通用批量提交：POST /api/admin/tools/exam/[id]/questions/batch */
  const submitBatch = async (questions: ParsedQuestion[]): Promise<boolean> => {
    const score = parseInt(scorePerQuestion, 10);
    if (!Number.isFinite(score) || score < 1 || score > 100) {
      setError(t('importScoreRange'));
      return false;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await apiRequest<{ count?: number }>(
        `/api/admin/tools/exam/${exam.id}/questions/batch`,
        {
          method: 'POST',
          body: {
            scorePerQuestion: score,
            questions: questions.map((q, i) => ({
              title: q.title,
              orderIndex: i,
              options: q.options,
              author: q.author ?? undefined,
            })),
          },
        },
      );
      if (!r.ok) {
        setError(r.error ?? t('importFailed'));
        return false;
      }
      pushToast(
        'success',
        t('importSuccess', { count: r.data?.count ?? questions.length }),
      );
      return true;
    } catch {
      setError(t('importNetworkRetry'));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  /** 粘贴模式：解析通过后确认导入 */
  const handleImport = async () => {
    if (!parsed || parsed.questions.length === 0 || parsed.errors.length > 0) {
      setError(t('importNoQuestions'));
      return;
    }
    if (await submitBatch(parsed.questions)) onClose();
  };

  /** 录入模式：当前题加入草稿并清空表单（下一题） */
  const handleAddQuestion = () => {
    const title = fTitle.trim();
    if (!title) {
      setFormError(t('formTitleRequired'));
      return;
    }
    if (FORM_LABELS.some((l) => !fOptions[l].trim())) {
      setFormError(t('formOptionsRequired'));
      return;
    }
    if (!fCorrect) {
      setFormError(t('formCorrectRequired'));
      return;
    }
    setDraft((d) => [
      ...d,
      {
        title,
        options: FORM_LABELS.map((l) => ({
          label: l,
          content: fOptions[l].trim(),
          isCorrect: l === fCorrect,
        })),
        ...(fAuthor.trim() ? { author: fAuthor.trim().slice(0, 50) } : {}),
      },
    ]);
    setFTitle('');
    setFOptions(EMPTY_FORM_OPTIONS);
    setFCorrect('');
    setFAuthor('');
    setFormError(null);
  };

  /** 录入模式：把草稿某题回填到表单编辑（编辑后重新「下一题」入库） */
  const editDraftItem = (idx: number) => {
    const q = draft[idx];
    if (!q) return;
    setFTitle(q.title);
    const next = { ...EMPTY_FORM_OPTIONS } as Record<OptionLabel, string>;
    for (const o of q.options) {
      if (o.label in next) next[o.label as OptionLabel] = o.content;
    }
    setFOptions(next);
    setFCorrect((q.options.find((o) => o.isCorrect)?.label as OptionLabel) ?? '');
    setFAuthor(q.author ?? '');
    setDraft((d) => d.filter((_, i) => i !== idx));
    setFormError(null);
  };

  /** 录入模式：从草稿删除某题 */
  const removeDraftItem = (idx: number) => {
    setDraft((d) => d.filter((_, i) => i !== idx));
  };

  /** 录入模式：填写完毕提交全部草稿 */
  const handleFinishForm = async () => {
    if (draft.length === 0) {
      setFormError(t('formDraftEmpty'));
      return;
    }
    if (await submitBatch(draft)) onClose();
  };

  return (
    <ModalShell title={t('importModalTitle')} onClose={onClose}>
      <div className="space-y-5">
        {/* 目标考试 */}
        <div className="meta-mono text-[11px] text-[var(--muted-foreground)]">
          {t('importTarget')}: {exam.title}
        </div>

        {/* 录入方式切换 */}
        <div className="flex items-center gap-5 border-b border-[var(--border)] pb-3">
          <button
            type="button"
            onClick={() => setMode('form')}
            className={`focus-amber meta-mono text-[12px] tracking-wider transition-colors ${
              mode === 'form' ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {t('importModeForm')}
          </button>
          <button
            type="button"
            onClick={() => setMode('paste')}
            className={`focus-amber meta-mono text-[12px] tracking-wider transition-colors ${
              mode === 'paste' ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {t('importModePaste')}
          </button>
        </div>

        {mode === 'form' ? (
          <>
            {/* 题目 */}
            <Field label={t('formQuestionTitle')} count={`${fTitle.length}/255`}>
              <input
                type="text"
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value.slice(0, 255))}
                maxLength={255}
                className={`${INPUT_CLASS} px-4 py-3 text-[14px]`}
                placeholder={t('formQuestionPlaceholder')}
              />
            </Field>

            {/* 选项 A-D */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FORM_LABELS.map((label) => (
                <Field key={label} label={`${label}`}>
                  <input
                    type="text"
                    value={fOptions[label]}
                    onChange={(e) =>
                      setFOptions((f) => ({ ...f, [label]: e.target.value.slice(0, 500) }))
                    }
                    maxLength={500}
                    className={`${INPUT_CLASS} px-3 py-2.5 text-[13px]`}
                    placeholder={t('formOptionPlaceholder')}
                  />
                </Field>
              ))}
            </div>

            {/* 选择正确答案 */}
            <Field label={t('formCorrectOption')}>
              <div className="flex flex-wrap gap-2">
                {FORM_LABELS.map((label) => {
                  const selected = fCorrect === label;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setFCorrect(label)}
                      className={`meta-mono text-[11px] px-3 py-1.5 border transition-colors ${
                        selected
                          ? 'border-[var(--primary)] bg-[var(--primary)]/[0.08] text-[var(--primary)]'
                          : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* 出题人（选填） */}
            <Field label={t('formAuthor')}>
              <input
                type="text"
                value={fAuthor}
                onChange={(e) => setFAuthor(e.target.value.slice(0, 50))}
                maxLength={50}
                className={`${INPUT_CLASS} px-4 py-3 text-[14px]`}
                placeholder={t('formAuthorPlaceholder')}
              />
            </Field>

            <div className="flex items-center justify-end">
              <Button
                variant="primary-outline"
                type="button"
                onClick={handleAddQuestion}
                disabled={submitting}
              >
                {t('formAddNextBtn')}
              </Button>
            </div>

            {/* 已录入草稿 */}
            <Field label={t('formDraftCount', { count: draft.length })}>
              {draft.length === 0 ? (
                <p className="text-[12px] text-[var(--muted-foreground)] border border-dashed border-[var(--border)] p-3">
                  {t('formDraftEmpty')}
                </p>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-2 border border-[var(--border)] p-3">
                  {draft.map((q, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-b-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] text-[var(--foreground)] truncate">
                          {i + 1}. {q.title}
                        </div>
                        <div className="mt-0.5 meta-mono text-[11px] text-[var(--muted-foreground)] truncate">
                          {q.options.map((o) => `${o.label}.${o.content}`).join('  ')}
                          {q.author ? `  · 出题人 ${q.author}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => editDraftItem(i)}
                          className="focus-amber meta-mono text-[10px] text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                        >
                          {t('formEdit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeDraftItem(i)}
                          className="focus-amber meta-mono text-[10px] text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                        >
                          {t('formDelete')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Field>
          </>
        ) : (
          <>
            {/* 格式说明 + 示例 */}
            <div className="text-[12px] text-[var(--muted-foreground)] leading-relaxed">
              {t('importFormatHint')}
              <pre className="mt-2 p-3 border border-[var(--border)] bg-[var(--primary)]/[0.04] text-[11px] whitespace-pre-wrap font-mono">
                {t('importExample')}
              </pre>
            </div>

            {/* 粘贴区 */}
            <Field label={t('fieldQuestions')}>
              <textarea
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  setParsed(null); // 内容变更后预览失效，需重新解析
                }}
                rows={10}
                className={`${INPUT_CLASS} px-4 py-3 text-[13px] resize-y`}
                placeholder={t('importPlaceholder')}
              />
            </Field>

            {/* 解析结果 */}
            {parsed && (
              <div className="space-y-3">
                <div className="meta-mono text-[11px] text-[var(--muted-foreground)]">
                  {t('parsedCount', { count: parsed.questions.length })}
                </div>

                {parsed.errors.length > 0 && (
                  <div className="p-3 border-l-2 border-[var(--destructive)] bg-[var(--destructive)]/[0.04] text-[12px] font-mono text-[var(--destructive)] space-y-1">
                    {parsed.errors.map((e, i) => (
                      <div key={i}>{t(e.key, e.values ?? {})}</div>
                    ))}
                  </div>
                )}

                {parsed.questions.length > 0 && (
                  <div className="max-h-48 overflow-y-auto space-y-3 border border-[var(--border)] p-3">
                    {parsed.questions.map((q, i) => (
                      <div key={i} className="border-b border-[var(--border)] last:border-b-0 pb-3 last:pb-0">
                        <div className="text-[13px] text-[var(--foreground)]">
                          {i + 1}. {q.title}
                          {q.author ? (
                            <span className="meta-mono text-[10px] text-[var(--muted-foreground)] ml-2">
                              出题人 {q.author}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 meta-mono text-[11px]">
                          {q.options.map((o) => (
                            <div
                              key={o.label}
                              className={
                                o.isCorrect
                                  ? 'text-[var(--primary)]'
                                  : 'text-[var(--muted-foreground)]'
                              }
                            >
                              {o.label}. {o.content}{o.isCorrect ? ' ✓' : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* 每题分数（两种模式共用） */}
        <Field label={t('fieldScorePerQuestion')}>
          <input
            type="number"
            min={1}
            max={100}
            value={scorePerQuestion}
            onChange={(e) => setScorePerQuestion(e.target.value)}
            className={`${INPUT_CLASS} px-4 py-3 text-[14px]`}
            placeholder="1-100"
          />
        </Field>

        {(error || formError) && (
          <div className="p-3 border-l-2 border-[var(--destructive)] bg-[var(--destructive)]/[0.04] text-[12px] font-mono text-[var(--destructive)]">
            [ Error ] {error ?? formError}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="focus-amber meta-mono text-[12px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            {tc('cancel')}
          </button>
          {mode === 'paste' ? (
            <>
              <Button
                variant="primary-outline"
                type="button"
                onClick={() => setParsed(parseChoiceQuestions(rawText))}
                disabled={submitting || !rawText.trim()}
              >
                {t('parseBtn')}
              </Button>
              <Button
                variant="primary"
                type="button"
                onClick={handleImport}
                disabled={submitting || !canImport}
              >
                {submitting ? t('importing') : t('importBtn')}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              type="button"
              onClick={handleFinishForm}
              disabled={submitting || !canFinishForm}
            >
              {submitting ? t('importing') : t('formFinishBtn')}
            </Button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}