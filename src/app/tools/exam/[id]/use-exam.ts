'use client';

/**
 * @file useExam — 考试答题页共享状态与逻辑 Hook（随机抽题场次版）
 *
 * 从 `app/tools/exam/[id]/page.tsx` 拆出（GENERAL 2.2「展示与容器分离」、
 * 2.4「逻辑 > 150 行提为 Hook / 组件 > 500 行拆分」）。各渲染子组件复用本 Hook 返回值。
 *
 * 流程：未登录跳登录 → 拉考试元信息 → POST /start（后端随机抽 10 题建场次）；
 * 已交卷不可重考（直返成绩）；作答中刷新续答同一组抽题、beforeunload 拦截离开；
 * 交卷 POST /finish，后端判分并统计过题数量（答对数）。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/shared/hooks/use-api-request';

export interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'ended';
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  techTags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamQuestion {
  id: string;
  examId: string;
  type: 'single_choice' | 'coding';
  title: string;
  contentMarkdown: string | null;
  score: number;
  sortOrder: number;
  createdAt: string;
  options?: ExamOption[];
}

export interface ExamOption {
  id: string;
  questionId: string;
  label: string;
  content: string;
  /** 公开答题不返回正确答案，交卷后也不泄露 */
  isCorrect?: boolean;
  sortOrder: number;
}

interface AttemptResult {
  questionId: string;
  isCorrect: boolean | null;
  score: number | null;
}

interface StartResponse {
  runId: string;
  status: string;
  totalQuestions: number;
  startedAt: string | null;
  finished: boolean;
  correctCount: number | null;
  score: number | null;
  maxScore: number | null;
  questions: ExamQuestion[];
}

interface FinishResponse {
  runId: string;
  correctCount: number;
  totalQuestions: number;
  score: number;
  maxScore: number;
  results: {
    questionId: string;
    answer: string | null;
    isCorrect: boolean | null;
    score: number | null;
  }[];
}

/** 场次结果（后端统计） */
export interface RunResult {
  correctCount: number;
  totalQuestions: number;
  score: number;
  maxScore: number;
}

export function useExam(id: string) {
  const router = useRouter();

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, AttemptResult>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // 加载：登录校验 → 考试元信息 → 进入考试（后端随机抽题/续答/直返成绩）
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await apiRequest<{ user: { id: string; role: string } | null }>(
          '/api/auth/me',
        );
        if (cancelled) return;
        if (!me.ok || !me.data?.user) {
          router.replace(`/login?redirect=${encodeURIComponent(`/tools/exam/${id}`)}`);
          return;
        }
        setIsLoggedIn(true);

        const detail = await apiRequest<{ exam: ExamDetail }>(`/api/tools/exam/${id}`);
        if (!detail.ok) throw new Error(detail.error ?? '加载失败');
        if (cancelled) return;
        setExam(detail.data!.exam);

        const start = await apiRequest<StartResponse>(
          `/api/tools/exam/${id}/start`,
          { method: 'POST' },
        );
        if (!start.ok) throw new Error(start.error ?? '进入考试失败');
        if (cancelled) return;
        const s = start.data!;
        if (s.finished) {
          // 已完成不可重考：直接显示成绩
          setRunResult({
            correctCount: s.correctCount ?? 0,
            totalQuestions: s.totalQuestions ?? 0,
            score: s.score ?? 0,
            maxScore: s.maxScore ?? 0,
          });
          setSubmitted(true);
        } else {
          setRunId(s.runId);
          setQuestions(s.questions ?? []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  // 作答中拦截离开（刷新会由后端续答同一组抽题，不重抽）
  useEffect(() => {
    if (submitted || !runId) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [submitted, runId]);

  // 计时器（依据考试结束时间）
  useEffect(() => {
    if (!exam || !exam.endTime || exam.status !== 'published') return;

    const updateTimer = () => {
      const now = new Date();
      const end = new Date(exam.endTime!);
      const remaining = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [exam]);

  const selectOption = useCallback(
    (questionId: string, label: string) => {
      if (submitted) return;
      setAnswers((prev) => ({ ...prev, [questionId]: label }));
    },
    [submitted],
  );

  const setCodingAnswer = useCallback(
    (questionId: string, value: string) => {
      if (submitted) return;
      setAnswers((prev) => ({ ...prev, [questionId]: value }));
    },
    [submitted],
  );

  /** 交卷：提交本场次全部作答，后端判分并返回过题数量 */
  const handleSubmit = useCallback(async () => {
    if (!isLoggedIn) {
      router.push(`/login?redirect=${encodeURIComponent(`/tools/exam/${id}`)}`);
      return;
    }
    if (submitting || submitted || !runId) return;

    const unanswered = questions.filter((q) => !answers[q.id]);
    if (unanswered.length > 0) {
      setError(`还有 ${unanswered.length} 道题未作答`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const r = await apiRequest<FinishResponse>(`/api/tools/exam/${id}/finish`, {
        method: 'POST',
        body: {
          runId,
          answers: Object.entries(answers).map(([questionId, answer]) => ({
            questionId,
            answer,
          })),
        },
      });

      if (!r.ok) {
        throw new Error(r.error ?? '交卷失败');
      }

      const data = r.data!;
      const newResults: Record<string, AttemptResult> = {};
      for (const item of data.results) {
        newResults[item.questionId] = {
          questionId: item.questionId,
          isCorrect: item.isCorrect,
          score: item.score,
        };
      }
      setResults(newResults);
      setRunResult({
        correctCount: data.correctCount,
        totalQuestions: data.totalQuestions,
        score: data.score,
        maxScore: data.maxScore,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '交卷失败');
    } finally {
      setSubmitting(false);
    }
  }, [isLoggedIn, submitting, submitted, runId, answers, questions, id, router]);

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const currentQuestion = questions[currentQuestionIdx];
  // 结果优先取后端统计的场次结果，回退到逐题结果聚合（兼容编程题场景）
  const totalScore = useMemo(
    () => runResult?.score ?? Object.values(results).reduce((sum, r) => sum + (r.score ?? 0), 0),
    [runResult, results],
  );
  const maxScore = useMemo(
    () => runResult?.maxScore ?? questions.reduce((sum, q) => sum + q.score, 0),
    [runResult, questions],
  );
  const correctCount = useMemo(
    () =>
      runResult?.correctCount ??
      Object.values(results).filter((r) => r.isCorrect).length,
    [runResult, results],
  );

  return {
    router,
    id,
    exam,
    questions,
    answers,
    results,
    runId,
    runResult,
    loading,
    submitting,
    submitted,
    error,
    setError,
    currentQuestionIdx,
    setCurrentQuestionIdx,
    sidebarOpen,
    setSidebarOpen,
    timeRemaining,
    isLoggedIn,
    selectOption,
    setCodingAnswer,
    handleSubmit,
    formatTime,
    currentQuestion,
    totalScore,
    maxScore,
    correctCount,
  };
}

export type ExamState = ReturnType<typeof useExam>;