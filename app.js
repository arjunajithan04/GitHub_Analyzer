const form = document.querySelector("#repo-form");
const input = document.querySelector("#repo-input");
const tokenInput = document.querySelector("#token-input");
const statusLine = document.querySelector("#status-line");
const overviewGrid = document.querySelector("#overview-grid");
const metricTemplate = document.querySelector("#metric-card-template");
const repoCard = document.querySelector("#repo-card");
const repoAvatar = document.querySelector("#repo-avatar");
const repoName = document.querySelector("#repo-name");
const repoVisibility = document.querySelector("#repo-visibility");
const repoDescription = document.querySelector("#repo-description");
const repoLinks = document.querySelector("#repo-links");
const scoreLabel = document.querySelector("#score-label");
const scoreValue = document.querySelector("#score-value");
const scoreDetail = document.querySelector("#score-detail");
const scoreRing = document.querySelector("#score-ring");
const signalList = document.querySelector("#signal-list");
const actionCount = document.querySelector("#action-count");
const insightList = document.querySelector("#insight-list");
const languageTotal = document.querySelector("#language-total");
const languageList = document.querySelector("#language-list");
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

const apiBase = "https://api.github.com";
const languageColors = ["#2563eb", "#0d9488", "#b7791f", "#7c3aed", "#dc2626", "#475569", "#0891b2"];

const state = {
  currentRepo: null,
  requestId: 0,
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const parsed = parseRepository(input.value);

  if (!parsed) {
    setStatus("Enter a repository like owner/name or a GitHub URL.", true);
    return;
  }

  await analyzeRepository(parsed.owner, parsed.repo);
});

document.querySelectorAll("[data-repo]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.repo;
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

function parseRepository(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:[/?#].*)?$/i);
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i);
  const slashMatch = trimmed.match(/^([^/\s]+)\/([^/\s#?]+)$/);
  const match = urlMatch || sshMatch || slashMatch;

  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ""),
  };
}

async function analyzeRepository(owner, repo) {
  const requestId = ++state.requestId;
  setLoading(true);
  setStatus(`Analyzing ${owner}/${repo}...`);

  try {
    const repository = await getJson(`/repos/${owner}/${repo}`);
    const defaultBranch = repository.default_branch || "main";

    const data = await fetchRepositoryBundle(owner, repo, defaultBranch);
    if (requestId !== state.requestId) return;

    state.currentRepo = repository.full_name;
    renderRepository(repository);
    renderOverview(repository, data);
    renderScore(repository, data);
    renderLanguages(data.languages.value || {});
    renderCommits(data.commits.value || []);
    renderReleases(data.releases.value || []);
    renderContributors(data.contributors.value || []);
    renderOpenWork(data.issues.value || [], data.pulls.value || []);
    renderFiles(data.contents.value || []);
    setStatus(`Showing live public analysis for ${repository.full_name}.`);
  } catch (error) {
    clearDashboard();
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
}

async function fetchRepositoryBundle(owner, repo, branch) {
  const requests = {
    languages: getSettled(`/repos/${owner}/${repo}/languages`),
    contributors: getSettled(`/repos/${owner}/${repo}/contributors?per_page=12`),
    commits: getSettled(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=12`),
    issues: getSettled(`/repos/${owner}/${repo}/issues?state=open&per_page=10`),
    pulls: getSettled(`/repos/${owner}/${repo}/pulls?state=open&per_page=10`),
    releases: getSettled(`/repos/${owner}/${repo}/releases?per_page=6`),
    contents: getSettled(`/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`),
    community: getSettled(`/repos/${owner}/${repo}/community/profile`),
  };

  const entries = await Promise.all(Object.entries(requests).map(async ([key, promise]) => [key, await promise]));
  return Object.fromEntries(entries);
}

async function getSettled(path) {
  try {
    return { ok: true, value: await getJson(path), error: null };
  } catch (error) {
    return { ok: false, value: null, error };
  }
}

async function getJson(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token = tokenInput.value.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${apiBase}${path}`, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Repository not found, or the token does not have access.");
    }
    if (response.status === 403) {
      throw new Error("GitHub rate limit reached. Add a token or try again later.");
    }
    throw new Error(`GitHub request failed with status ${response.status}.`);
  }

  return response.json();
}

function renderRepository(repository) {
  repoCard.classList.remove("hidden");
  repoAvatar.src = repository.owner.avatar_url;
  repoName.textContent = repository.full_name;
  repoVisibility.textContent = repository.private ? "private" : repository.visibility;
  repoDescription.textContent = repository.description || "No description provided.";

  const links = [
    ["Open on GitHub", repository.html_url],
    repository.homepage ? ["Homepage", repository.homepage] : null,
    repository.license ? [repository.license.spdx_id || repository.license.name, repository.license.url] : null,
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

function renderOverview(repository, data) {
  const latestCommit = data.commits.value?.[0]?.commit?.committer?.date;
  const releases = data.releases.value || [];
  const metrics = [
    ["Stars", formatNumber(repository.stargazers_count), "community interest"],
    ["Forks", formatNumber(repository.forks_count), "copies and experiments"],
    ["Open Items", formatNumber(repository.open_issues_count), "issues and pull requests"],
    ["Default Branch", repository.default_branch, "analysis target"],
    ["Last Commit", latestCommit ? relativeDate(latestCommit) : "Unknown", latestCommit ? formatDate(latestCommit) : "commit data unavailable"],
    ["Latest Release", releases[0] ? releases[0].tag_name : "None", releases[0] ? relativeDate(releases[0].published_at) : "no release sampled"],
    ["Watchers", formatNumber(repository.subscribers_count || repository.watchers_count), "notification followers"],
    ["Size", formatBytes(repository.size * 1024), "repository footprint"],
  ];

  overviewGrid.replaceChildren(...metrics.map(([label, value, caption]) => createMetricCard(label, value, caption)));
}

function createMetricCard(label, value, caption) {
  const card = metricTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector("p").textContent = label;
  card.querySelector("strong").textContent = value;
  card.querySelector("span").textContent = caption;
  return card;
}

function renderScore(repository, data) {
  const commits = data.commits.value || [];
  const contributors = data.contributors.value || [];
  const releases = data.releases.value || [];
  const contents = data.contents.value || [];
  const community = data.community.value;
  const latestCommitDate = commits[0]?.commit?.committer?.date;
  const latestReleaseDate = releases[0]?.published_at;
  const fileNames = contents.map((file) => file.name.toLowerCase());

  const signals = [
    {
      label: "Recent development",
      ok: latestCommitDate && daysSince(latestCommitDate) <= 30,
      detail: latestCommitDate ? `${relativeDate(latestCommitDate)}` : "commit data unavailable",
    },
    {
      label: "Contributor spread",
      ok: contributors.length >= 3,
      detail: `${contributors.length} contributors sampled`,
    },
    {
      label: "Release cadence",
      ok: latestReleaseDate && daysSince(latestReleaseDate) <= 180,
      detail: latestReleaseDate ? `${relativeDate(latestReleaseDate)}` : "no releases sampled",
    },
    {
      label: "Project metadata",
      ok: Boolean(repository.description && repository.license),
      detail: repository.license ? "license found" : "license missing",
    },
    {
      label: "Community files",
      ok: Boolean(community?.files?.contributing || fileNames.includes("contributing.md")),
      detail: "contribution guide",
    },
    {
      label: "Documentation",
      ok: Boolean(community?.files?.readme || fileNames.includes("readme.md")),
      detail: "readme coverage",
    },
    {
      label: "Security posture",
      ok: Boolean(community?.files?.code_of_conduct || fileNames.includes("security.md")),
      detail: "conduct or security file",
    },
    {
      label: "Community pull",
      ok: repository.stargazers_count >= 50 || repository.forks_count >= 10,
      detail: `${formatNumber(repository.stargazers_count)} stars`,
    },
  ];

  const score = Math.round((signals.filter((signal) => signal.ok).length / signals.length) * 100);
  const hue = score >= 75 ? "var(--accent)" : score >= 50 ? "var(--amber)" : "var(--red)";
  const label = score >= 75 ? "Strong" : score >= 50 ? "Developing" : "Needs work";

  scoreLabel.textContent = label;
  scoreValue.textContent = score;
  scoreDetail.textContent = `${signals.filter((signal) => signal.ok).length}/${signals.length} signals`;
  scoreRing.style.background = `radial-gradient(circle at center, white 58%, transparent 59%), conic-gradient(${hue} ${score * 3.6}deg, var(--soft) 0deg)`;
  scoreRing.querySelector("strong").textContent = score;

  signalList.replaceChildren(
    ...signals.map((signal) => {
      const item = document.createElement("li");
      const statusClass = signal.ok ? "signal-pass" : "signal-warn";
      item.innerHTML = `<strong>${signal.label}</strong><span class="${statusClass}">${signal.ok ? "OK" : signal.detail}</span>`;
      return item;
    }),
  );

  renderInsights(repository, signals, data);
}

function renderInsights(repository, signals, data) {
  const failed = signals.filter((signal) => !signal.ok);
  const commits = data.commits.value || [];
  const pulls = data.pulls.value || [];
  const issues = data.issues.value || [];
  const insights = [];

  if (failed.some((signal) => signal.label === "Documentation")) {
    insights.push(["Add or improve README", "A strong README helps visitors understand installation, usage, and contribution flow quickly."]);
  }
  if (failed.some((signal) => signal.label === "Release cadence")) {
    insights.push(["Create clearer release rhythm", "Tag stable versions so users can track what changed and adopt updates with confidence."]);
  }
  if (failed.some((signal) => signal.label === "Security posture")) {
    insights.push(["Add governance files", "A code of conduct or security policy makes the project easier to trust and maintain."]);
  }
  if (issues.length >= 8) {
    insights.push(["Triage open issues", "The sampled issue queue is busy. Labels, milestones, and stale cleanup would improve maintainer focus."]);
  }
  if (pulls.length >= 5) {
    insights.push(["Review pull request queue", "Several open pull requests are visible. Review flow may be a bottleneck."]);
  }
  if (commits[0]?.commit?.committer?.date && daysSince(commits[0].commit.committer.date) <= 7) {
    insights.push(["Momentum looks healthy", "The default branch has recent commits, so the repository is still visibly moving."]);
  }
  if (repository.archived) {
    insights.push(["Repository is archived", "Archived repositories are read-only, so treat this analysis as historical."]);
  }

  if (!insights.length) {
    insights.push(["No urgent gaps detected", "The sampled signals look balanced. Next step is deeper code quality and dependency analysis."]);
  }

  actionCount.textContent = `${insights.length} items`;
  insightList.replaceChildren(
    ...insights.map(([title, detail]) => {
      const card = document.createElement("div");
      card.className = "insight-card";
      card.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
      return card;
    }),
  );
}

function renderLanguages(languages) {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  languageTotal.textContent = total ? `${formatBytes(total)} scanned` : "No data";

  if (!entries.length) {
    languageList.innerHTML = `<p class="empty-state">No language data available.</p>`;
    return;
  }

  languageList.replaceChildren(
    ...entries.slice(0, 8).map(([language, bytes], index) => {
      const percent = Math.max(1, Math.round((bytes / total) * 100));
      const item = document.createElement("div");
      item.className = "bar-item";
      item.innerHTML = `
        <div class="bar-meta">${language}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${percent}%; background: ${languageColors[index % languageColors.length]}"></div>
        </div>
        <div class="bar-percent">${percent}%</div>
      `;
      return item;
    }),
  );
}

function renderCommits(commits) {
  commitCount.textContent = `${commits.length} latest`;

  if (!commits.length) {
    commitList.innerHTML = `<p class="empty-state">No recent commits available.</p>`;
    return;
  }

  commitList.replaceChildren(
    ...commits.map((commit) => {
      const item = document.createElement("div");
      item.className = "timeline-item";
      item.innerHTML = `
        <strong><a href="${commit.html_url}" target="_blank" rel="noreferrer">${escapeHtml(firstLine(commit.commit.message))}</a></strong>
        <span>${escapeHtml(commit.commit.author.name)} | ${formatDate(commit.commit.author.date)} | ${commit.sha.slice(0, 7)}</span>
      `;
      return item;
    }),
  );
}

function renderReleases(releases) {
  releaseCount.textContent = `${releases.length} sampled`;

  if (!releases.length) {
    releaseList.innerHTML = `<p class="empty-state">No public releases sampled.</p>`;
    return;
  }

  releaseList.replaceChildren(
    ...releases.map((release) => {
      const item = document.createElement("div");
      item.className = "timeline-item";
      item.innerHTML = `
        <strong><a href="${release.html_url}" target="_blank" rel="noreferrer">${escapeHtml(release.name || release.tag_name)}</a></strong>
        <span>${release.prerelease ? "Pre-release" : "Release"} | ${formatDate(release.published_at)}</span>
      `;
      return item;
    }),
  );
}

function renderContributors(contributors) {
  contributorCount.textContent = `${contributors.length} sampled`;

  if (!contributors.length) {
    contributorList.innerHTML = `<p class="empty-state">No contributor data available.</p>`;
    return;
  }

  contributorList.replaceChildren(
    ...contributors.map((person, index) => {
      const item = document.createElement("div");
      item.className = "person";
      item.innerHTML = `
        <img src="${person.avatar_url}" alt="" />
        <div>
          <strong><a href="${person.html_url}" target="_blank" rel="noreferrer">${person.login}</a></strong>
          <span>${formatNumber(person.contributions)} commits</span>
        </div>
        <span>#${index + 1}</span>
      `;
      return item;
    }),
  );
}

function renderOpenWork(issues, pulls) {
  const visibleIssues = issues.filter((item) => !item.pull_request).slice(0, 5);
  const items = [
    ...pulls.slice(0, 5).map((pull) => ({ ...pull, kind: "PR" })),
    ...visibleIssues.map((issue) => ({ ...issue, kind: "Issue" })),
  ].slice(0, 10);

  workCount.textContent = `${items.length} sampled`;

  if (!items.length) {
    workList.innerHTML = `<p class="empty-state">No sampled open issues or pull requests.</p>`;
    return;
  }

  workList.replaceChildren(
    ...items.map((item) => {
      const entry = document.createElement("div");
      entry.className = "work-item";
      entry.innerHTML = `
        <strong><a href="${item.html_url}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></strong>
        <span>${item.kind} #${item.number} | opened ${relativeDate(item.created_at)} by ${item.user.login}</span>
      `;
      return entry;
    }),
  );
}

function renderFiles(files) {
  const visible = Array.isArray(files) ? files.slice(0, 12) : [];
  fileCount.textContent = `${visible.length} shown`;

  if (!visible.length) {
    fileGrid.innerHTML = `<p class="empty-state">No root files available.</p>`;
    return;
  }

  fileGrid.replaceChildren(
    ...visible.map((file) => {
      const entry = document.createElement("div");
      entry.className = "file-item";
      entry.innerHTML = `
        <strong><a href="${file.html_url}" target="_blank" rel="noreferrer">${escapeHtml(file.name)}</a></strong>
        <span>${file.type}${file.size ? ` | ${formatBytes(file.size)}` : ""}</span>
      `;
      return entry;
    }),
  );
}

function clearDashboard() {
  repoCard.classList.add("hidden");
  overviewGrid.replaceChildren();
  [signalList, insightList, languageList, commitList, releaseList, contributorList, workList, fileGrid].forEach((node) =>
    node.replaceChildren(),
  );
  [scoreLabel, scoreValue, scoreDetail, actionCount, languageTotal, commitCount, releaseCount, contributorCount, workCount, fileCount].forEach(
    (node) => {
      node.textContent = "--";
    },
  );
  scoreRing.querySelector("strong").textContent = "--";
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.style.color = isError ? "var(--red)" : "var(--muted)";
}

function setLoading(isLoading) {
  document.querySelector("#analyze-button").disabled = isLoading;
  input.disabled = isLoading;
}

function firstLine(value) {
  return value.split("\n")[0];
}

function daysSince(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

function relativeDate(date) {
  const days = daysSince(date);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", { notation: Number(value) >= 10000 ? "compact" : "standard" }).format(value || 0);
}

function formatBytes(value) {
  return new Intl.NumberFormat("en", {
    notation: Number(value) >= 10000 ? "compact" : "standard",
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
  }).format(value || 0);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

analyzeRepository("microsoft", "vscode");
