'use client';

/**
 * @file ContributeForm — 考试答题完成后「我也出一道题」投稿表单（答题页子组件）
 *
 * 与题库录入相同出题表单（题干 + 选项 A-D + 正确答案 + 出题人），
 * 提交后写入本考试题库（后续随机抽题会抽到）；仅交卷态渲染（后端校验已完成场次）。
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Field } from '@/modules/admin/ui/shared';
import { INPUT_CLASS } from '@/shared/utils/ui-constants';
import { useToast } from '@/components/feedback/toast';
import { Button } from '@/components';
import { apiRequest } from '@/shared/hooks/use-api-request';

const LABELS = ['A', 'B', 'C', 'D'] as const;
type Label = (typeof LABELS)[number];

const EMPTY_OPTIONS: Record<Label, string> = { A: '', B: '', C: '', D: '' };

export function ContributeForm({ examId }: { examId: string }) {
  const t = useTranslations('toolsExam');
  const { pushToast } = useToast();

  const [title, setTitle] = useState('');
  const [options, setOptions] = useState<Record<Label, string>>(EMPTY_OPTIONS);
  const [correct, setCorrect] = useState<'' | Label>('');
  const [author, setAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 提交投稿题目（POST /api/tools/exam/[id]/contribute） */
  const handleSubmit = async () => {
    if (!title.trim()) {
      setError(t('contributeTitleRequired'));
      return;
    }
    if (LABELS.some((l) => !options[l].trim())) {
      setError(t('contributeOptionsRequired'));
      return;
    }
    if (!correct) {
      setError(t('contributeCorrectRequired'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const r = await apiRequest(`/api/tools/exam/${examId}/contribute`, {
        method: 'POST',
        body: {
          title: title.trim(),
          options: LABELS.map((l) => ({
            label: l,
            content: options[l].trim(),
            isCorrect: l === correct,
          })),
          author: author.trim() || undefined,
        },
      });
      if (!r.ok) {
        setError(r.error ?? t('contributeFailed'));
        return;
      }
      pushToast('success', t('contributeSuccess'));
      setDone(true);
    } catch {
      setError(t('contributeFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="border border-[var(--primary)]/40 bg-[var(--primary)]/[0.04] p-5 text-center">
        <div className="meta-mono text-[12px] text-[var(--primary)] mb-1">{t('contributeDone')}</div>
        <p className="text-[13px] text-[var(--muted-foreground)]">{t('contributeSuccess')}</p>
      </div>
    );
  }

  return (
    <div className="border border-[var(--border)] p-5 sm:p-6">
      <h3 className="display-serif text-[18px] sm:text-[20px] text-[var(--foreground)] mb-5 flex items-center gap-2">
        <span className="text-[var(--primary)]">+</span> {t('contributeTitle')}
      </h3>

      <div className="space-y-5">
        <Field label={t('contributeTitleLabel')} count={`${title.length}/255`}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 255))}
            maxLength={255}
            className={`${INPUT_CLASS} px-4 py-3 text-[14px]`}
            placeholder={t('contributeTitlePlaceholder')}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LABELS.map((label) => (
            <Field key={label} label={`${label}`}>
              <input
                type="text"
                value={options[label]}
                onChange={(e) =>
                  setOptions((f) => ({ ...f, [label]: e.target.value.slice(0, 500) }))
                }
                maxLength={500}
                className={`${INPUT_CLASS} px-3 py-2.5 text-[13px]`}
                placeholder={t('contributeOptionPlaceholder')}
              />
            </Field>
          ))}
        </div>

        <Field label={t('contributeCorrectLabel')}>
          <div className="flex flex-wrap gap-2">
            {LABELS.map((label) => {
              const selected = correct === label;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setCorrect(label)}
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

        <Field label={t('authorLabel')}>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value.slice(0, 50))}
            maxLength={50}
            className={`${INPUT_CLASS} px-4 py-3 text-[14px]`}
            placeholder={t('authorPlaceholder')}
          />
        </Field>

        {error && (
          <div className="p-3 border-l-2 border-[var(--destructive)] bg-[var(--destructive)]/[0.04] text-[12px] font-mono text-[var(--destructive)]">
            [ Error ] {error}
          </div>
        )}

        <div className="flex items-center justify-end">
          <Button
            variant="primary-outline"
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? t('contributeSubmitting') : t('contributeBtn')}
          </Button>
        </div>
      </div>
    </div>
  );
}