const form = document.querySelector("#repo-form");
const repoInput = document.querySelector("#repo-input");
const tokenInput = document.querySelector("#token-input");
const statusLine = document.querySelector("#status-line");
const analyzeButton = document.querySelector("#analyze-button");
const identityCard = document.querySelector("#identity-card");
const repoAvatar = document.querySelector("#repo-avatar");
const repoName = document.querySelector("#repo-name");
const repoVisibility = document.querySelector("#repo-visibility");
const repoDescription = document.querySelector("#repo-description");
const repoLinks = document.querySelector("#repo-links");
const copyReport = document.querySelector("#copy-report");
const metricsGrid = document.querySelector("#metrics-grid");
const metricTemplate = document.querySelector("#metric-template");
const heroGrade = document.querySelector("#hero-grade");
const scoreLabel = document.querySelector("#score-label");
const scoreValue = document.querySelector("#score-value");
const scoreGrade = document.querySelector("#score-grade");
const scoreOrb = document.querySelector("#score-orb");
const signalList = document.querySelector("#signal-list");
const recommendationCount = document.querySelector("#recommendation-count");
const recommendationList = document.querySelector("#recommendation-list");
const riskCount = document.querySelector("#risk-count");
const riskList = document.querySelector("#risk-list");
const languageTotal = document.querySelector("#language-total");
const languageMap = document.querySelector("#language-map");
const dependencyGrid = document.querySelector("#dependency-grid");
const commitCount = document.querySelector("#commit-count");
const commitList = document.querySelector("#commit-list");
const releaseCount = document.querySelector("#release-count");
const releaseList = document.querySelector("#release-list");
const contributorCount = document.querySelector("#contributor-count");
const contributorList = document.querySelector("#contributor-list");
const workCount = document.querySelector("#work-count");
const workList = document.querySelector("#work-list");
const fileCount = document.querySelector("#file-count");
const fileGrid = document.querySelector("#file-grid");

const colors = ["#2dd4bf", "#60a5fa", "#a78bfa", "#fbbf24", "#fb7185", "#86efac", "#38bdf8", "#c084fc"];
let latestReport = "";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await analyze(repoInput.value);
});

document.querySelectorAll("[data-repo]").forEach((button) => {
  button.addEventListener("click", () => {
    repoInput.value = button.dataset.repo;
    form.requestSubmit();
  });
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#tab-${button.dataset.tab}`).classList.add("active");
  });
});

copyReport.addEventListener("click", async () => {
  if (!latestReport) return;
  await navigator.clipboard.writeText(latestReport);
  setStatus("Report summary copied to clipboard.");
});

async function analyze(repository) {
  setLoading(true);
  setStatus(`Python is analyzing ${repository}...`);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repository, token: tokenInput.value.trim() }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Analysis failed.");
    }

    renderAnalysis(payload);
    if (payload.warnings?.length) {
      setStatus(`Analysis ready for ${payload.repository.name}. Warning: ${payload.warnings[0]}`, true);
    } else {
      setStatus(`Analysis ready for ${payload.repository.name}.`);
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
}

function renderAnalysis(data) {
  latestReport = data.report;
  renderIdentity(data.repository);
  renderMetrics(data.metrics);
  renderScore(data.score, data.signals);
  renderRecommendations(data.recommendations);
  renderRisks(data.risks);
  renderLanguages(data.languages, data.dependencies);
  renderTimeline(data.commits, data.releases);
  renderCommunity(data.contributors, data.work);
  renderFiles(data.files);
}

function renderIdentity(repository) {
  identityCard.classList.remove("hidden");
  repoAvatar.src = repository.avatar;
  repoName.textContent = repository.name;
  repoVisibility.textContent = repository.archived ? "archived" : repository.visibility;
  repoDescription.textContent = repository.description;

  const links = [
    ["GitHub", repository.url],
    repository.homepage ? ["Homepage", repository.homepage] : null,
    repository.license ? [`License: ${repository.license}`, repository.url] : null,
  ].filter(Boolean);

  repoLinks.replaceChildren(
    ...links.map(([label, href]) => {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = label;
      return anchor;
    }),
  );
}

function renderMetrics(metrics) {
  metricsGrid.replaceChildren(
    ...metrics.map((metric) => {
      const card = metricTemplate.content.firstElementChild.cloneNode(true);
      card.querySelector("span").textContent = metric.label;
      card.querySelector("strong").textContent = metric.value;
      card.querySelector("p").textContent = metric.caption;
      return card;
    }),
  );
}

function renderScore(score, signals) {
  const hue = score.value >= 75 ? "var(--cyan)" : score.value >= 60 ? "var(--amber)" : "var(--red)";
  heroGrade.textContent = score.grade;
  scoreLabel.textContent = score.label;
  scoreValue.textContent = score.value;
  scoreGrade.textContent = `Grade ${score.grade}`;
  scoreOrb.style.background = `radial-gradient(circle at center, var(--surface-strong) 0 58%, transparent 59%), conic-gradient(${hue} ${score.value * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;

  signalList.replaceChildren(
    ...signals.map((signal) => {
      const item = document.createElement("div");
      item.className = "signal-item";
      item.innerHTML = `<strong>${escapeHtml(signal.label)}</strong><span class="${signal.ok ? "ok" : "warn"}">${signal.ok ? "OK" : escapeHtml(signal.detail)}</span>`;
      return item;
    }),
  );
}

function renderRecommendations(recommendations) {
  recommendationCount.textContent = `${recommendations.length} items`;
  recommendationList.replaceChildren(
    ...recommendations.map((item) => {
      const card = document.createElement("div");
      card.className = "recommendation";
      card.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span><span class="pill">${escapeHtml(item.category)}</span>`;
      return card;
    }),
  );
}

function renderRisks(risks) {
  riskCount.textContent = `${risks.length} risks`;
  riskList.replaceChildren(
    ...risks.map((item) => {
      const card = document.createElement("div");
      card.className = `risk risk-${item.level}`;
      card.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span><span class="pill">${escapeHtml(item.level)}</span>`;
      return card;
    }),
  );
}

function renderLanguages(languages, dependencies) {
  languageTotal.textContent = `${languages.length} languages`;

  if (!languages.length) {
    languageMap.innerHTML = `<p class="empty-state">No language data available.</p>`;
  } else {
    languageMap.replaceChildren(
      ...languages.map((language, index) => {
        const row = document.createElement("div");
        row.className = "language-row";
        row.innerHTML = `
          <strong>${escapeHtml(language.name)}</strong>
          <div class="language-track">
            <div class="language-fill" style="width: ${Math.max(1, language.percent)}%; background: ${colors[index % colors.length]}"></div>
          </div>
          <span>${language.percent}%</span>
        `;
        return row;
      }),
    );
  }

  if (!dependencies.length) {
    dependencyGrid.innerHTML = `<p class="empty-state">No common dependency manifests detected in the root sample.</p>`;
    return;
  }

  dependencyGrid.replaceChildren(
    ...dependencies.map((item) => {
      const card = document.createElement("div");
      card.className = "dependency";
      card.innerHTML = `<strong>${escapeHtml(item.ecosystem)}</strong><span>${escapeHtml(item.file)} | ${escapeHtml(item.detail)}</span>`;
      return card;
    }),
  );
}

function renderTimeline(commits, releases) {
  commitCount.textContent = `${commits.length} commits`;
  releaseCount.textContent = `${releases.length} releases`;

  commitList.replaceChildren(...commits.map((commit) => timelineItem(commit.message, `${commit.author} | ${formatDate(commit.date)} | ${commit.sha}`, commit.url)));

  if (!commits.length) {
    commitList.innerHTML = `<p class="empty-state">No recent commits sampled.</p>`;
  }

  releaseList.replaceChildren(
    ...releases.map((release) =>
      timelineItem(release.name, `${release.prerelease ? "Pre-release" : "Release"} | ${formatDate(release.date)} | ${release.tag}`, release.url),
    ),
  );

  if (!releases.length) {
    releaseList.innerHTML = `<p class="empty-state">No releases sampled.</p>`;
  }
}

function renderCommunity(contributors, work) {
  contributorCount.textContent = `${contributors.length} people`;
  workCount.textContent = `${work.length} items`;

  contributorList.replaceChildren(
    ...contributors.map((person, index) => {
      const card = document.createElement("div");
      card.className = "person";
      card.innerHTML = `
        <img src="${person.avatar}" alt="" />
        <div>
          <strong><a href="${person.url}" target="_blank" rel="noreferrer">${escapeHtml(person.login)}</a></strong>
          <span>${person.contributions.toLocaleString()} contributions</span>
        </div>
        <span>#${index + 1}</span>
      `;
      return card;
    }),
  );

  if (!contributors.length) {
    contributorList.innerHTML = `<p class="empty-state">No contributors sampled.</p>`;
  }

  workList.replaceChildren(
    ...work.map((item) => {
      const card = document.createElement("div");
      card.className = "work-item";
      card.innerHTML = `<strong><a href="${item.url}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></strong><span>${item.kind} #${item.number} | ${formatDate(item.created_at)} | ${escapeHtml(item.user)}</span>`;
      return card;
    }),
  );

  if (!work.length) {
    workList.innerHTML = `<p class="empty-state">No sampled open work.</p>`;
  }
}

function renderFiles(files) {
  fileCount.textContent = `${files.length} shown`;

  if (!files.length) {
    fileGrid.innerHTML = `<p class="empty-state">No root files sampled.</p>`;
    return;
  }

  fileGrid.replaceChildren(
    ...files.map((file) => {
      const card = document.createElement("div");
      card.className = "file-item";
      card.innerHTML = `<strong><a href="${file.url}" target="_blank" rel="noreferrer">${escapeHtml(file.name)}</a></strong><span>${escapeHtml(file.type)} | ${formatBytes(file.size)}</span>`;
      return card;
    }),
  );
}

function timelineItem(title, detail, url) {
  const card = document.createElement("div");
  card.className = "timeline-item";
  card.innerHTML = `<strong><a href="${url}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></strong><span>${escapeHtml(detail)}</span>`;
  return card;
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.style.color = isError ? "var(--red)" : "var(--muted)";
}

function setLoading(isLoading) {
  analyzeButton.disabled = isLoading;
  repoInput.disabled = isLoading;
}

function formatDate(value) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB"];
  let number = Number(value || 0);
  let index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index += 1;
  }
  return `${number.toFixed(number >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

analyze(repoInput.value);
