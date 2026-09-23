/**
 * @file 考试管理子面板 — 从 admin-tools-panel 拆出（GENERAL 2.4 按关注点拆分）
 * 同时承载「新建考试」与「编辑考试」：Modal 复用同一表单，按 mode 切换标题/按钮/提交动作。
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { GraduationCap, ListPlus, Pencil, Rocket } from 'lucide-react';
import { ModalShell, Field } from '@/modules/admin/ui/shared';
import { INPUT_CLASS } from '@/shared/utils/ui-constants';
import { useToast } from '@/components/feedback/toast';
import { TECH_TAGS } from '@/shared/utils/tech-tags';
import { Badge, Button } from '@/components';
import {
  formatDate,
  EXAM_PAGE_SIZE,
  type Exam,
} from './tool-types';
import { ExamImportModal } from './tool-exam-import';
import { apiRequest } from '@/shared/hooks/use-api-request';

const EMPTY_EXAM_FORM = {
  title: '',
  description: '',
  startTime: '',
  endTime: '',
  durationMinutes: '60',
  techTags: [] as string[],
};

type ExamForm = typeof EMPTY_EXAM_FORM;

/**
 * 把后端 Exam.tech_tags（可能是数组、JSON 字符串、逗号分隔字符串、null）解析为 string[]
 * 兼容多种历史形态；解析失败降级为空数组。
 */
function parseTechTags(raw: string[] | string | null | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      // 非合法 JSON，按逗号分隔降级
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * 把 UTC ISO 时间字符串转为 <input type="datetime-local"> 接受的本地格式
 * YYYY-MM-DDTHH:MM（无时区偏移，浏览器按本地时区解释）。
 */
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 解析后端返回的时间字符串为 Date：已带时区（Z / ±hh:mm）直接解析；
 * naive UTC（历史数据）补 Z；解析失败返回 null（调用方显示 -）。
 */
function parseBackendDate(iso: string | null): Date | null {
  if (!iso) return null;
  const normalized = /(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 把后端 Exam（snake_case）转表单内（camelCase），用于编辑预填。
 */
function examToForm(exam: Exam): ExamForm {
  return {
    title: exam.title,
    description: exam.description ?? '',
    startTime: exam.start_time ? toLocalDatetimeInput(exam.start_time) : '',
    endTime: exam.end_time ? toLocalDatetimeInput(exam.end_time) : '',
    durationMinutes: String(exam.duration_minutes ?? 60),
    techTags: parseTechTags(exam.tech_tags),
  };
}

/** 考试管理子面板 — 考试列表 + 新建/编辑考试模态框 */
export function ExamManagePanel() {
  const t = useTranslations('toolsAdmin');
  const tc = useTranslations('common');
  const { pushToast } = useToast();

  const [exams, setExams] = useState<Exam[]>([]);
  const [examTotal, setExamTotal] = useState(0);
  const [examPage, setExamPage] = useState(1);
  const [examLoading, setExamLoading] = useState(false);
  const [examError, setExamError] = useState<string | null>(null);

  // Modal 同时承载创建/编辑：editingExam 为 null=创建模式，非 null=编辑模式
  const [examModalOpen, setExamModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [examSubmitting, setExamSubmitting] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [examFormError, setExamFormError] = useState<string | null>(null);
  const [examForm, setExamForm] = useState<ExamForm>(EMPTY_EXAM_FORM);

  // 批量导入题库：importExam 非 null 时渲染导入模态框
  const [importExam, setImportExam] = useState<Exam | null>(null);

  // 模式派生：editingExam 非 null 即编辑模式
  const isEditMode = editingExam !== null;

  const fetchExams = useCallback(async (pg: number) => {
    setExamLoading(true);
    setExamError(null);
    try {
      const r = await apiRequest<{ exams?: Exam[]; data?: Exam[]; total?: number }>(`/api/admin/tools/exam?page=${pg}&pageSize=${EXAM_PAGE_SIZE}`);
      if (r.ok) {
        const json = r.data ?? {};
        setExams(json.exams || json.data || []);
        setExamTotal(json.total || 0);
      } else {
        setExamError(r.error ?? '加载失败');
      }
    } catch {
      setExamError('网络错误');
    } finally {
      setExamLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExams(examPage);
  }, [examPage, fetchExams]);

  /** 打开创建考试 Modal */
  const openCreateModal = () => {
    setEditingExam(null);
    setExamForm(EMPTY_EXAM_FORM);
    setExamFormError(null);
    setExamModalOpen(true);
  };

  /** 打开编辑考试 Modal：用 exam 当前值预填表单 */
  const openEditModal = (exam: Exam) => {
    setEditingExam(exam);
    setExamForm(examToForm(exam));
    setExamFormError(null);
    setExamModalOpen(true);
  };

  /** 关闭考试 Modal 并重置表单与编辑态 */
  const closeExamModal = () => {
    setExamModalOpen(false);
    setEditingExam(null);
    setExamFormError(null);
    setExamForm(EMPTY_EXAM_FORM);
  };

  /** 提交创建考试（POST /api/admin/tools/exam） */
  const handleCreateExam = async () => {
    setExamFormError(null);

    if (!examForm.title.trim()) {
      setExamFormError(t('examTitleEmpty'));
      return;
    }
    if (!examForm.startTime || !examForm.endTime) {
      setExamFormError(t('examTimeRequired'));
      return;
    }
    const duration = parseInt(examForm.durationMinutes, 10);
    if (!Number.isFinite(duration) || duration < 1 || duration > 1440) {
      setExamFormError(t('examDurationRange'));
      return;
    }

    setExamSubmitting(true);
    try {
      const r = await apiRequest('/api/admin/tools/exam', {
        method: 'POST',
        body: {
          title: examForm.title.trim(),
          description: examForm.description.trim() || undefined,
          startTime: new Date(examForm.startTime).toISOString(),
          endTime: new Date(examForm.endTime).toISOString(),
          durationMinutes: duration,
          techTags: examForm.techTags.length > 0 ? examForm.techTags : undefined,
        },
      });

      if (!r.ok) {
        setExamFormError(r.error ?? t('examCreateFailed'));
        return;
      }

      pushToast('success', t('examCreated'));
      closeExamModal();
      fetchExams(1);
      setExamPage(1);
    } catch {
      setExamFormError(t('examNetworkRetry'));
    } finally {
      setExamSubmitting(false);
    }
  };

  /** 提交编辑考试（PUT /api/admin/tools/exam/{id}） */
  const handleUpdateExam = async () => {
    if (!editingExam) return;
    setExamFormError(null);

    if (!examForm.title.trim()) {
      setExamFormError(t('examTitleEmpty'));
      return;
    }
    if (!examForm.startTime || !examForm.endTime) {
      setExamFormError(t('examTimeRequired'));
      return;
    }
    const duration = parseInt(examForm.durationMinutes, 10);
    if (!Number.isFinite(duration) || duration < 1 || duration > 1440) {
      setExamFormError(t('examDurationRange'));
      return;
    }

    setExamSubmitting(true);
    try {
      const r = await apiRequest(`/api/admin/tools/exam/${editingExam.id}`, {
        method: 'PUT',
        body: {
          // 后端 ExamInput.status 默认 draft 但 PUT 是整体替换，
          // 必须显式传 status 以避免已发布/已结束考试被误重置为 draft
          status: editingExam.status,
          title: examForm.title.trim(),
          description: examForm.description.trim() || undefined,
          startTime: new Date(examForm.startTime).toISOString(),
          endTime: new Date(examForm.endTime).toISOString(),
          durationMinutes: duration,
          techTags: examForm.techTags.length > 0 ? examForm.techTags : undefined,
        },
      });

      if (!r.ok) {
        setExamFormError(r.error ?? t('examUpdateFailed'));
        return;
      }

      pushToast('success', t('examUpdated'));
      closeExamModal();
      fetchExams(examPage);
    } catch {
      setExamFormError(t('examNetworkRetry'));
    } finally {
      setExamSubmitting(false);
    }
  };

  /** 发布考试（draft -> published）；已发布/已结束的考试不显示发布入口 */
  const handlePublishExam = async (exam: Exam) => {
    setPublishingId(exam.id);
    try {
      const r = await apiRequest(`/api/admin/tools/exam/${exam.id}/publish`, { method: 'POST' });
      if (!r.ok) {
        pushToast('error', t('examPublishFailed'));
        return;
      }
      pushToast('success', t('examPublished'));
      fetchExams(examPage);
    } catch {
      pushToast('error', t('examPublishFailed'));
    } finally {
      setPublishingId(null);
    }
  };

  const examPages = Math.ceil(examTotal / EXAM_PAGE_SIZE) || 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="meta-mono text-[11px] text-[var(--muted-foreground)]">{t('examCount', { count: examTotal })}</span>
        <div className="flex items-center gap-3">
          <Button
            variant="primary-outline"
            size="sm"
            type="button"
            onClick={openCreateModal}
          >
            {t('newExam')}
          </Button>
          <button
            type="button"
            onClick={() => fetchExams(examPage)}
            disabled={examLoading}
            className="focus-amber meta-mono text-[11px] text-[var(--muted-foreground)] hover:text-[var(--primary)] underline-grow disabled:opacity-30"
          >
            {examLoading ? tc('loading') : tc('refresh')}
          </button>
        </div>
      </div>

      {examError && (
        <div className="p-4 border-l-2 border-[var(--destructive)] bg-[var(--destructive)]/[0.04] text-[12px] font-mono text-[var(--destructive)] mb-4">
          [ Error ] {examError}
        </div>
      )}

      {examLoading && exams.length === 0 && (
        <div className="py-20 text-center meta-mono text-[var(--muted-foreground)]">{t('loading')}</div>
      )}

      {!examLoading && !examError && exams.length === 0 && (
        <div className="py-20 text-center">
          <div className="meta-mono text-[var(--muted-foreground)] mb-4">{t('noExams')}</div>
          <p className="text-[14px] text-[var(--muted-foreground)]">{t('noExamsDesc')}</p>
        </div>
      )}

      {exams.length > 0 && (
        <div className="hidden md:block">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left meta-mono py-3 pr-4">{t('colExam')}</th>
                <th className="text-left meta-mono py-3 pr-4">{t('colStatus')}</th>
                <th className="text-left meta-mono py-3 pr-4">{t('colTime')}</th>
                <th className="text-left meta-mono py-3 pr-4">{t('colDuration')}</th>
                <th className="text-left meta-mono py-3 pr-4">{t('colCreated')}</th>
                <th className="text-left meta-mono py-3">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((exam) => (
                <tr key={exam.id} className="border-b border-[var(--border)]">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/tools/exam/${exam.id}`}
                      className="text-[14px] text-[var(--foreground)] hover:text-[var(--primary)] transition-colors"
                    >
                      <GraduationCap className="w-3.5 h-3.5 inline mr-1.5 text-[var(--primary)]" />
                      {exam.title}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant={exam.status === 'published' ? 'success' : exam.status === 'draft' ? 'amber' : 'muted'}>
                      {exam.status === 'published' ? t('statusPublished') :
                       exam.status === 'draft' ? t('statusDraft') :
                       exam.status === 'ended' ? t('statusEnded') : exam.status}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 meta-mono text-[11px] text-[var(--muted-foreground)]">
                    {(() => {
                      const d = parseBackendDate(exam.start_time);
                      return d
                        ? d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '-';
                    })()}
                  </td>
                  <td className="py-3 pr-4 meta-mono text-[11px] text-[var(--muted-foreground)]">
                    {exam.duration_minutes > 0 ? `${exam.duration_minutes} min` : t('durationUnlimited')}
                  </td>
                  <td className="py-3 pr-4 meta-mono text-[11px] text-[var(--muted-foreground)]">{formatDate(exam.created_at)}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      {exam.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => handlePublishExam(exam)}
                          disabled={publishingId === exam.id}
                          className="focus-amber meta-mono text-[11px] text-[var(--primary)] underline-grow inline-flex items-center gap-1 disabled:opacity-40"
                        >
                          {publishingId === exam.id ? t('publishing') : t('publishExam')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditModal(exam)}
                        className="focus-amber meta-mono text-[11px] text-[var(--muted-foreground)] hover:text-[var(--primary)] underline-grow inline-flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" />
                        {t('editExam')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportExam(exam)}
                        className="focus-amber meta-mono text-[11px] text-[var(--muted-foreground)] hover:text-[var(--primary)] underline-grow inline-flex items-center gap-1"
                      >
                        <ListPlus className="w-3 h-3" />
                        {t('importQuestions')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {examPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              {Array.from({ length: examPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setExamPage(p)}
                  className={`text-[11px] font-mono px-3 py-1.5 border transition-colors ${
                    p === examPage
                      ? 'border-[var(--primary)] text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/40'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 移动端卡片列表 */}
      {exams.length > 0 && (
        <div className="md:hidden space-y-3">
          {exams.map((exam) => (
            <div
              key={exam.id}
              className="relative border border-[var(--border)] p-4 transition-colors hover:border-[var(--primary)]/40"
            >
              <div className="absolute top-3 right-3 flex items-center gap-3">
                {exam.status === 'draft' && (
                  <button
                    type="button"
                    onClick={() => handlePublishExam(exam)}
                    aria-label={t('publishExam')}
                    className="focus-amber text-[var(--primary)]"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openEditModal(exam)}
                  aria-label={t('editExam')}
                  className="focus-amber text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setImportExam(exam)}
                  aria-label={t('importQuestions')}
                  className="focus-amber text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                </button>
              </div>
              <Link href={`/tools/exam/${exam.id}`} className="block">
                <div className="flex items-center gap-2 mb-1">
                  <GraduationCap className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span className={`meta-mono text-[10px] px-2 py-0.5 border ${
                    exam.status === 'published' ? 'border-emerald-500/40 text-emerald-500' :
                    exam.status === 'draft' ? 'border-amber-500/40 text-amber-500' :
                    'border-[var(--border)] text-[var(--muted-foreground)]'
                  }`}>
                    {exam.status === 'published' ? '已发布' :
                     exam.status === 'draft' ? '草稿' :
                     exam.status === 'ended' ? '已结束' : exam.status}
                  </span>
                </div>
                <h3 className="text-[14px] text-[var(--foreground)]">{exam.title}</h3>
                <div className="meta-mono text-[10px] text-[var(--muted-foreground)] mt-2">
                  {(() => {
                    const d = parseBackendDate(exam.start_time);
                    return d ? d.toLocaleString('zh-CN') : '-';
                  })()} · {exam.duration_minutes}min
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* 考试创建/编辑模态框（同一表单按 mode 切换标题与提交动作） */}
      {examModalOpen && (
        <ModalShell title={isEditMode ? t('examEditModalTitle') : t('examModalTitle')} onClose={closeExamModal}>
          <div className="space-y-5">
            <Field label={t('fieldTitle')} count={`${examForm.title.length}/200`}>
              <input
                type="text"
                value={examForm.title}
                onChange={(e) => setExamForm((f) => ({ ...f, title: e.target.value.slice(0, 200) }))}
                maxLength={200}
                className={`${INPUT_CLASS} px-4 py-3 text-[14px]`}
                placeholder={t('examTitlePlaceholder')}
              />
            </Field>

            <Field label={t('fieldDesc')} count={`${examForm.description.length}/2000`}>
              <textarea
                value={examForm.description}
                onChange={(e) => setExamForm((f) => ({ ...f, description: e.target.value.slice(0, 2000) }))}
                maxLength={2000}
                rows={3}
                className={`${INPUT_CLASS} px-4 py-3 text-[13px] resize-y`}
                placeholder={t('examDescPlaceholder')}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t('fieldStartTime')}>
                <input
                  type="datetime-local"
                  value={examForm.startTime}
                  onChange={(e) => setExamForm((f) => ({ ...f, startTime: e.target.value }))}
                  className={`${INPUT_CLASS} px-3 py-2.5 text-[13px]`}
                />
              </Field>
              <Field label={t('fieldEndTime')}>
                <input
                  type="datetime-local"
                  value={examForm.endTime}
                  onChange={(e) => setExamForm((f) => ({ ...f, endTime: e.target.value }))}
                  className={`${INPUT_CLASS} px-3 py-2.5 text-[13px]`}
                />
              </Field>
            </div>

            <Field label={t('fieldDuration')}>
              <input
                type="number"
                min={1}
                max={1440}
                value={examForm.durationMinutes}
                onChange={(e) => setExamForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                className={`${INPUT_CLASS} px-4 py-3 text-[14px]`}
                placeholder="1-1440"
              />
            </Field>

            <Field label={t('fieldTechTags')}>
              <div className="flex flex-wrap gap-1.5">
                {TECH_TAGS.map((tag) => {
                  const selected = examForm.techTags.includes(tag.key);
                  return (
                    <button
                      key={tag.key}
                      type="button"
                      onClick={() => {
                        setExamForm((f) => ({
                          ...f,
                          techTags: selected ? f.techTags.filter((key) => key !== tag.key) : [...f.techTags, tag.key],
                        }));
                      }}
                      className={`meta-mono text-[10px] px-2.5 py-1 border transition-colors ${
                        selected
                          ? 'border-[var(--primary)] bg-[var(--primary)]/[0.08] text-[var(--primary)]'
                          : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50'
                      }`}
                    >
                      {tag.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            {examFormError && (
              <div className="p-3 border-l-2 border-[var(--destructive)] bg-[var(--destructive)]/[0.04] text-[12px] font-mono text-[var(--destructive)]">
                [ Error ] {examFormError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeExamModal}
                disabled={examSubmitting}
                className="focus-amber meta-mono text-[12px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {tc('cancel')}
              </button>
              <Button
                variant="primary-outline"
                type="button"
                onClick={isEditMode ? handleUpdateExam : handleCreateExam}
                disabled={examSubmitting}
              >
                {examSubmitting
                  ? (isEditMode ? t('updating') : t('creating'))
                  : (isEditMode ? t('updateExamBtn') : t('createExamBtn'))}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* 批量导入题库模态框 */}
      {importExam && (
        <ExamImportModal exam={importExam} onClose={() => setImportExam(null)} />
      )}
    </div>
  );
}