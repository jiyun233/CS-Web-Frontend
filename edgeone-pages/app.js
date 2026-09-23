const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");

const state = {
  route: parseRoute(),
  user: null,
  authChecked: false,
  exams: [],
  examsLoading: true,
  examsError: null,
  activeTab: "ongoing",
  runnerLoadingId: null,
  exam: null,
  run: null,
  questions: [],
  answers: {},
  currentQuestion: 0,
  result: null,
  submitting: false,
  timerId: null,
  timeRemaining: null,
  login: {
    loading: false,
    error: null,
    twoFactorToken: null,
    email: "",
  },
  contribute: {
    done: false,
    submitting: false,
    error: null,
  },
};

const icons = {
  arrowLeft:
    '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  check:
    '<path d="M20 6 9 17l-5-5"/>',
  clock:
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  graduation:
    '<path d="M22 10v6"/><path d="M2 10l10-5 10 5-10 5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  logout:
    '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
  refresh:
    '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  send:
    '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  user:
    '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  warning:
    '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

init();

function init() {
  window.addEventListener("hashchange", handleRouteChange);
  window.addEventListener("beforeunload", handleBeforeUnload);
  document.addEventListener("click", handleDocumentClick);

  if (!window.location.hash) {
    window.location.hash = "#/";
  }

  render();
  loadSession();
  loadExams();
  if (state.route.name === "exam") {
    loadExamRunner(state.route.params.id);
  }
}

async function loadSession() {
  try {
    const data = await api("/api/v1/auth/me");
    state.user = data.user;
  } catch (error) {
    state.user = null;
    if (error instanceof ApiError && error.status >= 500) {
      toast(error.message, "error");
    }
  } finally {
    state.authChecked = true;
    render();
  }
}

async function loadExams() {
  state.examsLoading = true;
  state.examsError = null;
  if (state.route.name === "home") render();

  try {
    const data = await api("/api/v1/tools/exam?page=1&page_size=50");
    state.exams = Array.isArray(data.items)
      ? data.items.map(normalizeExamSummary)
      : [];
  } catch (error) {
    state.exams = [];
    state.examsError = error.message || "考试列表加载失败";
  } finally {
    state.examsLoading = false;
    render();
  }
}

function handleRouteChange() {
  stopTimer();
  state.route = parseRoute();
  state.currentQuestion = 0;
  state.exam = null;
  state.run = null;
  state.questions = [];
  state.answers = {};
  state.result = null;
  state.contribute = { done: false, submitting: false, error: null };

  if (state.route.name === "exam") {
    loadExamRunner(state.route.params.id);
  } else {
    render();
  }
}

function handleBeforeUnload(event) {
  if (state.run && !state.result && state.questions.length > 0) {
    event.preventDefault();
    event.returnValue = "";
  }
}

function handleDocumentClick(event) {
  const navigation = event.target.closest("[data-nav]");
  if (navigation) {
    event.preventDefault();
    navigate(navigation.dataset.nav);
  }
}

function navigate(hash) {
  const next = hash.startsWith("#") ? hash : `#${hash}`;
  if (window.location.hash === next) {
    handleRouteChange();
    return;
  }
  window.location.hash = next;
}

function parseRoute() {
  const raw = window.location.hash.slice(1) || "/";
  const [path, queryString = ""] = raw.split("?");
  const query = Object.fromEntries(new URLSearchParams(queryString));
  const examMatch = path.match(/^\/exam\/([^/]+)$/);

  if (examMatch) {
    return { name: "exam", params: { id: decodeURIComponent(examMatch[1]) }, query };
  }
  if (path === "/login") return { name: "login", params: {}, query };
  return { name: "home", params: {}, query };
}

function render() {
  if (!state.authChecked && !state.examsLoading) {
    app.innerHTML = bootScreen();
    return;
  }

  if (state.route.name === "login") {
    renderLogin();
    return;
  }

  if (state.route.name === "exam") {
    renderExamRoute();
    return;
  }

  renderHome();
}

function renderHome() {
  app.innerHTML = `
    ${header()}
    <main class="page">
      <section class="hero">
        <div>
          <p class="eyebrow">CS-WEB / EXAM EDGE</p>
          <h1>考试控制台<span>答题、交卷、结果，一条链路。</span></h1>
        </div>
        <div>
          <p class="hero-copy">
            这是独立部署到 EdgeOne Pages 的考试入口。浏览器只访问当前站点，
            API 由同源边缘函数转发到后端。
          </p>
          <div class="hero-metrics">
            <div class="hero-metric">
              <strong>${state.exams.length}</strong>
              <span>可读取考试</span>
            </div>
            <div class="hero-metric">
              <strong>10</strong>
              <span>每场随机抽题</span>
            </div>
            <div class="hero-metric">
              <strong>${state.user ? "ON" : "OFF"}</strong>
              <span>登录状态</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <p class="section-kicker">[ 01 ] EXAMS</p>
            <h2>${tabTitle(state.activeTab)}</h2>
          </div>
          ${tabs()}
        </div>
        ${examList()}
      </section>
    </main>
    ${footer()}
  `;

  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  });
}

function renderLogin() {
  if (state.login.twoFactorToken) {
    app.innerHTML = `
      ${header()}
      <main class="page narrow">
        <section class="auth-card">
          <p class="eyebrow">ACCOUNT / 2FA</p>
          <h1>输入验证码</h1>
          <p>你的账号启用了两步验证。请输入认证器中的 6 位动态验证码。</p>
          ${state.login.error ? `<div class="form-error">${escapeHtml(state.login.error)}</div>` : ""}
          <form id="two-factor-form">
            <div class="field">
              <label for="two-factor-code">验证码</label>
              <input
                id="two-factor-code"
                name="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                placeholder="000000"
                required
              />
            </div>
            <button class="button signal full" type="submit" ${state.login.loading ? "disabled" : ""}>
              ${state.login.loading ? "验证中..." : "验证并登录"}
            </button>
          </form>
          <p style="margin: 18px 0 0">
            <button class="text-button" type="button" data-reset-2fa>返回密码登录</button>
          </p>
        </section>
      </main>
      ${footer()}
    `;

    document.querySelector("#two-factor-form").addEventListener("submit", handleTwoFactorSubmit);
    document.querySelector("[data-reset-2fa]").addEventListener("click", () => {
      state.login.twoFactorToken = null;
      state.login.error = null;
      render();
    });
    return;
  }

  app.innerHTML = `
    ${header()}
    <main class="page narrow">
      <section class="auth-card">
        <p class="eyebrow">ACCOUNT / SIGN IN</p>
        <h1>登录考试站</h1>
        <p>使用 CS-Web 账号登录。令牌仅保存在当前站点的 HttpOnly Cookie 中。</p>
        ${state.login.error ? `<div class="form-error">${escapeHtml(state.login.error)}</div>` : ""}
        <form id="login-form">
          <div class="field">
            <label for="login-email">邮箱</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autocomplete="username"
              value="${escapeAttribute(state.login.email)}"
              placeholder="name@example.com"
              required
            />
          </div>
          <div class="field">
            <label for="login-password">密码</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              required
            />
          </div>
          <button class="button signal full" type="submit" ${state.login.loading ? "disabled" : ""}>
            ${state.login.loading ? "登录中..." : "登录"}
          </button>
        </form>
      </section>
    </main>
    ${footer()}
  `;

  document.querySelector("#login-form").addEventListener("submit", handleLoginSubmit);
}

async function renderExamRoute() {
  const id = state.route.params.id;

  if (state.runnerLoadingId === id) {
    app.innerHTML = `
      ${header()}
      <main class="page">
        <div class="skeleton" style="height:130px"></div>
        <div class="runner-layout">
          <div class="skeleton" style="height:320px"></div>
          <div class="skeleton" style="height:560px"></div>
        </div>
      </main>
      ${footer()}
    `;
    return;
  }

  if (state.exam && state.questions.length > 0 && !state.result) {
    renderRunner();
    return;
  }

  if (state.result) {
    renderResult();
    return;
  }

  if (state.runnerLoadingId === null && !state.exam) {
    app.innerHTML = `
      ${header()}
      <main class="page">
        <div class="error-state">
          <h3>考试不存在或无法访问</h3>
          <p>当前路由无法加载考试数据。可以返回列表重试。</p>
          <button class="button" type="button" data-nav="#/">返回考试列表</button>
        </div>
      </main>
      ${footer()}
    `;
    return;
  }

  app.innerHTML = `
    ${header()}
    <main class="page">
      <div class="skeleton" style="height:560px"></div>
    </main>
    ${footer()}
  `;
}

async function loadExamRunner(id) {
  if (state.runnerLoadingId === id) return;
  state.runnerLoadingId = id;
  render();

  try {
    if (!state.user) {
      try {
        const me = await api("/api/v1/auth/me");
        state.user = me.user;
      } catch {
        const redirect = encodeURIComponent(`/exam/${id}`);
        navigate(`#/login?redirect=${redirect}`);
        return;
      }
    }

    const detailResponse = await api(`/api/v1/tools/exam/${encodeURIComponent(id)}`);
    const exam = normalizeExamDetail(detailResponse);
    const startResponse = await api(
      `/api/v1/tools/exam/${encodeURIComponent(id)}/start`,
      { method: "POST" },
    );
    const run = normalizeRun(startResponse, exam);

    state.exam = exam;
    state.run = run;
    state.questions = run.finished ? [] : run.questions;
    state.answers = loadSavedAnswers(run.runId);

    if (run.finished) {
      state.result = {
        correctCount: run.correctCount,
        totalQuestions: run.totalQuestions,
        score: run.score,
        maxScore: run.maxScore,
      };
    } else {
      startTimer(exam, run);
    }
  } catch (error) {
    toast(error.message || "进入考试失败", "error");
  } finally {
    state.runnerLoadingId = null;
    render();
  }
}

function renderRunner() {
  const question = state.questions[state.currentQuestion];
  if (!question) return;

  const answeredCount = state.questions.filter((item) => Boolean(state.answers[item.id])).length;
  const progress = state.questions.length
    ? Math.round((answeredCount / state.questions.length) * 100)
    : 0;

  app.innerHTML = `
    ${header()}
    <main class="runner">
      <div class="runner-bar">
        <div class="runner-bar-inner">
          <div class="runner-title">
            <button class="back-button" type="button" data-nav="#/">← 列表</button>
            <h1>${escapeHtml(state.exam?.title || "考试")}</h1>
          </div>
          ${timerMarkup()}
        </div>
      </div>

      <div class="runner-layout">
        <aside class="question-sidebar">
          <div class="sidebar-head">
            <strong>题目导航</strong>
            <span class="progress-label">${answeredCount}/${state.questions.length}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <div class="question-nav">
            ${state.questions
              .map(
                (item, index) => `
                  <button
                    class="question-nav-button ${state.answers[item.id] ? "answered" : ""} ${
                      index === state.currentQuestion ? "active" : ""
                    }"
                    type="button"
                    data-question-index="${index}"
                    aria-label="第 ${index + 1} 题"
                  >${index + 1}</button>
                `,
              )
              .join("")}
          </div>
          <button class="button signal full" type="button" data-submit-exam style="margin-top:18px">
            ${state.submitting ? "交卷中..." : "提交试卷"}
          </button>
        </aside>

        <section class="question-panel">
          <article class="question-card">
            <div class="question-kicker">
              <span>QUESTION ${String(state.currentQuestion + 1).padStart(2, "0")} / ${String(
                state.questions.length,
              ).padStart(2, "0")}</span>
              <span>${question.score} 分</span>
            </div>
            <h2>${escapeHtml(question.title)}</h2>
            ${
              question.content
                ? `<div class="question-content">${escapeHtml(question.content)}</div>`
                : ""
            }
            ${questionMarkup(question)}
            <div class="question-actions">
              <button
                class="button secondary"
                type="button"
                data-question-prev
                ${state.currentQuestion === 0 ? "disabled" : ""}
              >上一题</button>
              <button
                class="button"
                type="button"
                data-question-next
                ${state.currentQuestion === state.questions.length - 1 ? "disabled" : ""}
              >下一题</button>
            </div>
          </article>
        </section>
      </div>
    </main>
    ${footer()}
  `;

  app.querySelectorAll("[data-question-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentQuestion = Number(button.dataset.questionIndex);
      renderRunner();
    });
  });

  app.querySelectorAll("[data-option]").forEach((button) => {
    button.addEventListener("click", () => {
      setAnswer(question.id, button.dataset.option);
    });
  });

  app.querySelector("[data-question-prev]")?.addEventListener("click", () => {
    state.currentQuestion = Math.max(0, state.currentQuestion - 1);
    renderRunner();
  });

  app.querySelector("[data-question-next]")?.addEventListener("click", () => {
    state.currentQuestion = Math.min(state.questions.length - 1, state.currentQuestion + 1);
    renderRunner();
  });

  app.querySelector("[data-submit-exam]")?.addEventListener("click", submitExam);

  const codingInput = app.querySelector("[data-coding-answer]");
  if (codingInput) {
    codingInput.addEventListener("input", () => setAnswer(question.id, codingInput.value, false));
  }
}

function renderResult() {
  const result = state.result;
  app.innerHTML = `
    ${header()}
    <main class="runner">
      <div class="runner-bar">
        <div class="runner-bar-inner">
          <div class="runner-title">
            <button class="back-button" type="button" data-nav="#/">← 考试列表</button>
            <h1>${escapeHtml(state.exam?.title || "考试结果")}</h1>
          </div>
          <span class="status ended">已交卷</span>
        </div>
      </div>
      <div class="runner-layout" style="grid-template-columns:1fr">
        <div>
          <section class="result-panel">
            <p class="eyebrow">RESULT / FINISHED</p>
            <h2>试卷已提交</h2>
            <div class="result-grid">
              <div class="result-cell">
                <strong>${result.correctCount}</strong>
                <span>答对题数</span>
              </div>
              <div class="result-cell">
                <strong>${result.score}</strong>
                <span>获得分数</span>
              </div>
              <div class="result-cell">
                <strong>${result.maxScore}</strong>
                <span>试卷满分</span>
              </div>
            </div>
          </section>
          ${contributeMarkup()}
        </div>
      </div>
    </main>
    ${footer()}
  `;

  bindContributeForm();
}

function header() {
  return `
    <header class="site-header">
      <div class="header-inner">
        <button class="brand" type="button" data-nav="#/">
          <span class="brand-mark">CS</span>
          <span class="brand-copy">
            <strong>考试控制台</strong>
            <span>EdgeOne Pages</span>
          </span>
        </button>
        <div class="header-actions">
          ${
            state.user
              ? `
                <span class="account-chip">
                  <span class="account-dot"></span>
                  <span class="account-name">${escapeHtml(
                    state.user.displayName || state.user.username || state.user.email,
                  )}</span>
                </span>
                <button class="button secondary" type="button" data-logout>
                  ${icon("logout")}退出
                </button>
              `
              : `
                <button class="button" type="button" data-nav="#/login">
                  ${icon("user")}登录
                </button>
              `
          }
        </div>
      </div>
    </header>
  `;
}

function footer() {
  return `
    <footer class="footer">
      <div class="footer-inner">
        <span>CS-WEB / STATIC EXAM CLIENT</span>
        <span class="footer-status">API via Edge Function</span>
      </div>
    </footer>
  `;
}

function tabs() {
  const tabs = [
    ["ongoing", "进行中"],
    ["upcoming", "即将开始"],
    ["ended", "已结束"],
  ];

  return `
    <div class="tabs" role="tablist" aria-label="考试状态">
      ${tabs
        .map(
          ([key, label]) => `
            <button
              class="tab-button ${state.activeTab === key ? "active" : ""}"
              type="button"
              data-tab="${key}"
              role="tab"
              aria-selected="${state.activeTab === key}"
            >${label}</button>
          `,
        )
        .join("")}
    </div>
  `;
}

function examList() {
  if (state.examsLoading) {
    return `<div class="skeleton-grid">${Array.from({ length: 4 }, () => '<div class="skeleton"></div>').join("")}</div>`;
  }

  if (state.examsError) {
    return `
      <div class="error-state">
        <h3>无法连接考试服务</h3>
        <p>${escapeHtml(state.examsError)}</p>
        <button class="button" type="button" data-retry-exams>${icon("refresh")}重试</button>
      </div>
    `;
  }

  const exams = filteredExams();
  if (exams.length === 0) {
    return `
      <div class="empty-state">
        <h3>${tabTitle(state.activeTab)}暂无考试</h3>
        <p>当前分类下没有可展示的考试。切换到其他状态查看。</p>
      </div>
    `;
  }

  return `
    <div class="exam-grid">
      ${exams.map(examCard).join("")}
    </div>
  `;
}

function examCard(exam) {
  const status = examRuntimeStatus(exam);
  const date = exam.startTime
    ? new Date(exam.startTime).toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
      })
    : "随时";

  return `
    <button class="exam-card" type="button" data-nav="#/exam/${encodeURIComponent(exam.id)}">
      <div>
        <div class="exam-card-head">
          <span class="status ${status}">${statusLabel(status)}</span>
          <span class="date-label">${escapeHtml(date)}</span>
        </div>
        <h3>${escapeHtml(exam.title)}</h3>
        ${exam.description ? `<p>${escapeHtml(exam.description)}</p>` : ""}
      </div>
      <div class="exam-meta">
        <span class="meta-pill">${icon("clock")}${formatDuration(exam.durationMinutes)}</span>
        <span class="meta-pill">${icon("graduation")}${exam.questionCount || 0} 题</span>
        ${(exam.techTags || [])
          .slice(0, 3)
          .map((tag) => `<span class="meta-pill">${escapeHtml(tag)}</span>`)
          .join("")}
      </div>
    </button>
  `;
}

function filteredExams() {
  const now = Date.now();
  return state.exams.filter((exam) => examRuntimeStatus(exam, now) === state.activeTab);
}

function examRuntimeStatus(exam, now = Date.now()) {
  if (exam.status === "ended") return "ended";
  if (exam.status !== "published") return "ended";

  const start = exam.startTime ? new Date(exam.startTime).getTime() : null;
  const end = exam.endTime ? new Date(exam.endTime).getTime() : null;

  if (end && end < now) return "ended";
  if (start && start > now) return "upcoming";
  return "ongoing";
}

function statusLabel(status) {
  if (status === "ongoing") return "进行中";
  if (status === "upcoming") return "即将开始";
  return "已结束";
}

function tabTitle(tab) {
  if (tab === "upcoming") return "即将开始";
  if (tab === "ended") return "历史考试";
  return "进行中的考试";
}

function timerMarkup() {
  if (state.timeRemaining === null || state.result) return "";
  const urgent = state.timeRemaining < 300;
  return `
    <span class="timer ${urgent ? "urgent" : ""}">
      ${icon("clock")}${formatClock(state.timeRemaining)}
    </span>
  `;
}

function questionMarkup(question) {
  if (question.type === "coding") {
    return `
      <div class="field">
        <label for="coding-answer">作答内容</label>
        <textarea
          id="coding-answer"
          data-coding-answer
          placeholder="在此输入答案或代码"
        >${escapeHtml(state.answers[question.id] || "")}</textarea>
      </div>
    `;
  }

  return `
    <div class="option-list">
      ${question.options
        .map(
          (option) => `
            <button
              class="option-button ${
                state.answers[question.id] === option.label ? "selected" : ""
              }"
              type="button"
              data-option="${escapeAttribute(option.label)}"
            >
              <span class="option-letter">${escapeHtml(option.label)}</span>
              <span class="option-text">${escapeHtml(option.content)}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function contributeMarkup() {
  if (state.contribute.done) {
    return `
      <section class="contribute-panel">
        <h3>投稿已提交</h3>
        <p>题目已经进入题库，后续随机抽题时可能被其他同学遇到。</p>
      </section>
    `;
  }

  return `
    <section class="contribute-panel">
      <h3>我也出一道题</h3>
      <p>交卷后可以向当前考试题库投稿一道单选题。该功能需要保持登录。</p>
      ${state.contribute.error ? `<div class="form-error">${escapeHtml(state.contribute.error)}</div>` : ""}
      <form id="contribute-form">
        <div class="field">
          <label for="contribute-title">题干</label>
          <input id="contribute-title" name="title" maxlength="255" required />
        </div>
        <div class="option-input-grid">
          ${["A", "B", "C", "D"]
            .map(
              (label) => `
                <div class="field">
                  <label for="contribute-${label}">选项 ${label}</label>
                  <input id="contribute-${label}" name="option-${label}" maxlength="500" required />
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="field">
          <span class="field-label">正确答案</span>
          <div class="correct-options">
            ${["A", "B", "C", "D"]
              .map(
                (label) => `
                  <button class="correct-button" type="button" data-correct="${label}">${label}</button>
                `,
              )
              .join("")}
          </div>
          <input type="hidden" name="correct" required />
        </div>
        <div class="field">
          <label for="contribute-author">出题人（可选）</label>
          <input id="contribute-author" name="author" maxlength="50" />
        </div>
        <button class="button signal" type="submit" ${state.contribute.submitting ? "disabled" : ""}>
          ${state.contribute.submitting ? "提交中..." : "提交投稿"}
        </button>
      </form>
    </section>
  `;
}

function bindContributeForm() {
  const form = document.querySelector("#contribute-form");
  if (!form) return;

  let correct = "";
  form.querySelectorAll("[data-correct]").forEach((button) => {
    button.addEventListener("click", () => {
      correct = button.dataset.correct;
      form.elements.correct.value = correct;
      form.querySelectorAll("[data-correct]").forEach((item) => {
        item.classList.toggle("selected", item.dataset.correct === correct);
      });
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!correct) {
      state.contribute.error = "请选择正确答案";
      renderResult();
      return;
    }

    const data = new FormData(form);
    state.contribute.submitting = true;
    state.contribute.error = null;
    renderResult();

    try {
      await api(`/api/v1/tools/exam/${encodeURIComponent(state.exam.id)}/contribute`, {
        method: "POST",
        body: {
          type: "single_choice",
          title: String(data.get("title") || "").trim(),
          author: String(data.get("author") || "").trim() || undefined,
          options: ["A", "B", "C", "D"].map((label) => ({
            label,
            content: String(data.get(`option-${label}`) || "").trim(),
            is_correct: label === correct,
          })),
        },
      });
      state.contribute.done = true;
      toast("题目投稿成功");
      renderResult();
    } catch (error) {
      state.contribute.error = error.message || "投稿失败";
      state.contribute.submitting = false;
      renderResult();
    }
  });
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  state.login.email = email;
  state.login.loading = true;
  state.login.error = null;
  renderLogin();

  try {
    const data = await api("/api/v1/auth/login-email", {
      method: "POST",
      body: { email, password },
    });

    if (data.requires2FA) {
      state.login.twoFactorToken = data.twoFactorToken;
      state.login.loading = false;
      render();
      return;
    }

    const me = await api("/api/v1/auth/me");
    state.user = me.user;
    toast("登录成功");
    navigate(redirectTarget());
  } catch (error) {
    state.login.error = error.message || "邮箱或密码错误";
    state.login.loading = false;
    render();
  }
}

async function handleTwoFactorSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const code = String(formData.get("code") || "").replace(/\D/g, "").slice(0, 6);

  state.login.loading = true;
  state.login.error = null;
  render();

  try {
    await api("/api/v1/auth/2fa/verify", {
      method: "POST",
      body: {
        code,
        mode: "login",
        twoFactorToken: state.login.twoFactorToken,
      },
    });
    const me = await api("/api/v1/auth/me");
    state.user = me.user;
    toast("登录成功");
    navigate(redirectTarget());
  } catch (error) {
    state.login.error = error.message || "验证码无效";
    state.login.loading = false;
    render();
  }
}

async function logout() {
  try {
    await api("/api/v1/auth/logout", { method: "POST" });
  } catch {
    // Cookie clearing is handled by the edge function even when upstream fails.
  }
  state.user = null;
  toast("已退出登录");
  navigate("#/");
  render();
}

function redirectTarget() {
  const redirect = state.route.query.redirect;
  return redirect && redirect.startsWith("/") ? `#${redirect}` : "#/";
}

function setAnswer(questionId, value, rerender = true) {
  state.answers[questionId] = value;
  saveAnswers();
  if (rerender) {
    renderRunner();
  }
}

async function submitExam() {
  if (state.submitting || !state.run) return;

  const unanswered = state.questions.filter((question) => !state.answers[question.id]);
  if (unanswered.length > 0) {
    toast(`还有 ${unanswered.length} 道题未作答`, "error");
    state.currentQuestion = state.questions.findIndex(
      (question) => !state.answers[question.id],
    );
    renderRunner();
    return;
  }

  state.submitting = true;
  renderRunner();

  try {
    const data = await api(
      `/api/v1/tools/exam/${encodeURIComponent(state.exam.id)}/finish`,
      {
        method: "POST",
        body: {
          run_id: Number(state.run.id),
          answers: state.questions.map((question) => ({
            question_id: Number(question.id),
            answer: state.answers[question.id],
          })),
        },
      },
    );

    state.result = {
      correctCount: Number(data.correct_count ?? 0),
      totalQuestions: Number(data.total_questions ?? state.questions.length),
      score: Number(data.score ?? 0),
      maxScore: Number(data.max_score ?? 0),
    };
    clearSavedAnswers(state.run.id);
    stopTimer();
    toast("交卷成功");
  } catch (error) {
    toast(error.message || "交卷失败", "error");
  } finally {
    state.submitting = false;
    render();
  }
}

function startTimer(exam, run) {
  stopTimer();

  const endTimestamp = exam.endTime
    ? new Date(exam.endTime).getTime()
    : run.startedAt && exam.durationMinutes
      ? new Date(run.startedAt).getTime() + exam.durationMinutes * 60_000
      : null;

  if (!endTimestamp) {
    state.timeRemaining = null;
    return;
  }

  const tick = () => {
    state.timeRemaining = Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000));
    const timer = document.querySelector(".timer");
    if (timer) {
      timer.className = `timer ${state.timeRemaining < 300 ? "urgent" : ""}`;
      timer.innerHTML = `${icon("clock")}${formatClock(state.timeRemaining)}`;
    }
    if (state.timeRemaining === 0) {
      stopTimer();
      toast("考试时间已结束，正在交卷", "error");
      submitExam();
    }
  };

  tick();
  state.timerId = window.setInterval(tick, 1000);
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function normalizeExamSummary(exam) {
  return {
    id: String(exam.id),
    title: exam.title || "未命名考试",
    description: exam.description || "",
    durationMinutes: Number(exam.duration_minutes ?? 0),
    questionCount: Number(exam.question_count ?? 0),
    status: exam.status || "published",
    startTime: exam.start_time || null,
    endTime: exam.end_time || null,
    techTags: Array.isArray(exam.tech_tags) ? exam.tech_tags : [],
  };
}

function normalizeExamDetail(response) {
  const exam = response.exam || response;
  return {
    id: String(exam.id),
    title: exam.title || "未命名考试",
    description: exam.description || "",
    status: exam.status || "published",
    startTime: exam.start_time || null,
    endTime: exam.end_time || null,
    durationMinutes: Number(exam.duration_minutes ?? 0),
    techTags: Array.isArray(exam.tech_tags) ? exam.tech_tags : [],
  };
}

function normalizeRun(response, exam) {
  const questions = Array.isArray(response.questions)
    ? response.questions.map((question) => ({
        id: String(question.id),
        type: question.type || "single_choice",
        title: question.title || "",
        content: question.content_markdown || "",
        score: Number(question.score ?? 0),
        options: Array.isArray(question.options)
          ? question.options.map((option) => ({
              label: String(option.label),
              content: option.content || "",
            }))
          : [],
      }))
    : [];

  return {
    id: String(response.run_id),
    finished: Boolean(response.finished),
    correctCount: Number(response.correct_count ?? 0),
    totalQuestions: Number(response.total_questions ?? questions.length),
    score: Number(response.score ?? 0),
    maxScore: Number(response.max_score ?? 0),
    startedAt: response.started_at || null,
    questions,
  };
}

function saveAnswers() {
  if (!state.run?.id || state.result) return;
  try {
    localStorage.setItem(`cs-exam-run:${state.run.id}`, JSON.stringify(state.answers));
  } catch {
    // Local persistence is a convenience only.
  }
}

function loadSavedAnswers(runId) {
  try {
    const raw = localStorage.getItem(`cs-exam-run:${runId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function clearSavedAnswers(runId) {
  try {
    localStorage.removeItem(`cs-exam-run:${runId}`);
  } catch {
    // Ignore storage failures.
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  let body = options.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body,
    credentials: "same-origin",
    cache: "no-store",
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    throw new ApiError(
      data?.message || data?.detail || httpErrorMessage(response.status),
      response.status,
      data?.errorCode || data?.code,
    );
  }

  return data ?? {};
}

function httpErrorMessage(status) {
  if (status === 401) return "未登录或会话已过期";
  if (status === 403) return "没有权限执行该操作";
  if (status === 404) return "请求的资源不存在";
  if (status >= 500) return "后端服务暂不可用";
  return "请求失败";
}

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function formatDuration(minutes) {
  const value = Number(minutes);
  if (!value || value <= 0) return "不限时";
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function formatClock(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const rest = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function toast(message, variant = "success") {
  const node = document.createElement("div");
  node.className = `toast ${variant === "error" ? "error" : ""}`;
  node.textContent = message;
  toastRegion.append(node);
  window.setTimeout(() => node.remove(), 3600);
}

function bootScreen() {
  return `
    <div class="boot-screen">
      <div class="boot-mark">CS</div>
      <p>正在初始化考试站...</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

document.addEventListener("click", async (event) => {
  const retry = event.target.closest("[data-retry-exams]");
  if (retry) {
    event.preventDefault();
    loadExams();
    return;
  }

  const logoutButton = event.target.closest("[data-logout]");
  if (logoutButton) {
    event.preventDefault();
    await logout();
  }
});
