from __future__ import annotations

import json
import os
import re
import ssl
import time
from datetime import datetime, timezone
from importlib.util import find_spec
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from flask import Flask, g, jsonify, render_template, request


app = Flask(__name__)

GITHUB_API = "https://api.github.com"
REPO_PATTERN = re.compile(
    r"^(?:https?://(?:www\.)?github\.com/|git@github\.com:)?"
    r"(?P<owner>[^/\s:]+)/(?P<repo>[^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$",
    re.IGNORECASE,
)


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/analyze")
def analyze():
    payload = request.get_json(silent=True) or {}
    repo_input = str(payload.get("repository", "")).strip()
    token = str(payload.get("token", "")).strip()
    parsed = parse_repository(repo_input)
    g.analysis_warnings = []

    if not parsed:
        return jsonify({"error": "Enter a repository like owner/name or a GitHub URL."}), 400

    owner, repo = parsed

    try:
        repository = github_get(f"/repos/{owner}/{repo}", token)
        branch = repository.get("default_branch") or "main"
        bundle = fetch_bundle(owner, repo, branch, token)
        analysis = build_analysis(repository, bundle)
        return jsonify(analysis)
    except GitHubError as error:
        return jsonify({"error": str(error)}), error.status_code


def parse_repository(value: str) -> tuple[str, str] | None:
    match = REPO_PATTERN.match(value.strip())
    if not match:
        return None
    return match.group("owner"), match.group("repo")


def fetch_bundle(owner: str, repo: str, branch: str, token: str) -> dict:
    encoded_branch = quote(branch, safe="")
    paths = {
        "languages": f"/repos/{owner}/{repo}/languages",
        "contributors": f"/repos/{owner}/{repo}/contributors?per_page=16",
        "commits": f"/repos/{owner}/{repo}/commits?sha={encoded_branch}&per_page=16",
        "issues": f"/repos/{owner}/{repo}/issues?state=open&per_page=12",
        "pulls": f"/repos/{owner}/{repo}/pulls?state=open&per_page=12",
        "releases": f"/repos/{owner}/{repo}/releases?per_page=8",
        "contents": f"/repos/{owner}/{repo}/contents?ref={encoded_branch}",
        "community": f"/repos/{owner}/{repo}/community/profile",
    }

    return {key: github_get_soft(path, token) for key, path in paths.items()}


def github_get(path: str, token: str):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "GH-Analyzer-Flask",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request_obj = Request(f"{GITHUB_API}{path}", headers=headers)

    try:
        return open_github_request(request_obj)
    except HTTPError as error:
        message = read_error_message(error)
        if error.code == 404:
            message = "Repository not found, or your token does not have access."
        elif error.code == 403:
            message = "GitHub rate limit reached. Add a token or try again later."
        raise GitHubError(message, error.code) from error
    except URLError as error:
        if is_certificate_error(error):
            certifi_context = create_certifi_context()
            if certifi_context:
                try:
                    g.analysis_warnings.append(
                        "Python used the certifi certificate bundle because the system certificate chain could not verify GitHub."
                    )
                    return open_github_request(request_obj, context=certifi_context)
                except HTTPError as retry_error:
                    message = read_error_message(retry_error)
                    raise GitHubError(message, retry_error.code) from retry_error
                except URLError as retry_error:
                    if not is_certificate_error(retry_error):
                        raise GitHubError(f"Could not reach GitHub after certifi retry: {retry_error.reason}", 502) from retry_error

            g.analysis_warnings.append(
                "Python could not verify the local certificate chain, so this local run retried GitHub with certificate verification disabled."
            )
            try:
                return open_github_request(request_obj, context=ssl._create_unverified_context())
            except HTTPError as retry_error:
                message = read_error_message(retry_error)
                raise GitHubError(message, retry_error.code) from retry_error
            except URLError as retry_error:
                raise GitHubError(f"Could not reach GitHub after certificate fallback: {retry_error.reason}", 502) from retry_error
        raise GitHubError(f"Could not reach GitHub: {error.reason}", 502) from error


def open_github_request(request_obj: Request, context=None):
    with urlopen(request_obj, timeout=16, context=context) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else None


def create_certifi_context():
    if not find_spec("certifi"):
        return None

    import certifi

    return ssl.create_default_context(cafile=certifi.where())


def is_certificate_error(error: URLError) -> bool:
    reason = getattr(error, "reason", error)
    return isinstance(reason, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(reason)


def github_get_soft(path: str, token: str) -> dict:
    try:
        return {"ok": True, "value": github_get(path, token), "error": None}
    except GitHubError as error:
        return {"ok": False, "value": None, "error": str(error)}


def read_error_message(error: HTTPError) -> str:
    try:
        payload = json.loads(error.read().decode("utf-8"))
        return payload.get("message") or f"GitHub request failed with status {error.code}."
    except Exception:
        return f"GitHub request failed with status {error.code}."


def build_analysis(repository: dict, bundle: dict) -> dict:
    languages = bundle["languages"]["value"] or {}
    contributors = bundle["contributors"]["value"] or []
    commits = bundle["commits"]["value"] or []
    releases = bundle["releases"]["value"] or []
    issues_raw = bundle["issues"]["value"] or []
    pulls = bundle["pulls"]["value"] or []
    contents = bundle["contents"]["value"] or []
    community = bundle["community"]["value"] or {}
    issues = [issue for issue in issues_raw if "pull_request" not in issue]

    file_names = sorted({item.get("name", "").lower() for item in contents if item.get("name")})
    dependencies = detect_dependencies(file_names)
    signals = build_signals(repository, commits, contributors, releases, community, file_names)
    risks = build_risks(repository, commits, releases, contributors, issues, pulls, file_names)
    score = round((sum(1 for signal in signals if signal["ok"]) / len(signals)) * 100)
    grade = grade_from_score(score)
    recommendations = build_recommendations(signals, risks, dependencies, issues, pulls)

    return {
        "repository": summarize_repository(repository),
        "metrics": build_metrics(repository, commits, releases, issues, pulls),
        "score": {"value": score, "grade": grade, "label": label_from_score(score)},
        "signals": signals,
        "risks": risks,
        "recommendations": recommendations,
        "languages": build_languages(languages),
        "contributors": build_contributors(contributors),
        "commits": build_commits(commits),
        "releases": build_releases(releases),
        "work": build_work(issues, pulls),
        "files": build_files(contents),
        "dependencies": dependencies,
        "report": build_report(repository, score, grade, risks, recommendations),
        "warnings": sorted(set(getattr(g, "analysis_warnings", []))),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def summarize_repository(repository: dict) -> dict:
    license_info = repository.get("license") or {}
    return {
        "name": repository.get("full_name"),
        "description": repository.get("description") or "No description provided.",
        "url": repository.get("html_url"),
        "homepage": repository.get("homepage"),
        "avatar": repository.get("owner", {}).get("avatar_url"),
        "visibility": "private" if repository.get("private") else repository.get("visibility", "public"),
        "default_branch": repository.get("default_branch"),
        "archived": repository.get("archived", False),
        "license": license_info.get("spdx_id") or license_info.get("name"),
    }


def build_metrics(repository: dict, commits: list, releases: list, issues: list, pulls: list) -> list[dict]:
    latest_commit = nested_get(commits, [0, "commit", "committer", "date"])
    latest_release = nested_get(releases, [0, "published_at"])
    return [
        metric("Stars", compact(repository.get("stargazers_count")), "community interest"),
        metric("Forks", compact(repository.get("forks_count")), "copies and experiments"),
        metric("Open Issues", compact(len(issues)), "sampled open issues"),
        metric("Open PRs", compact(len(pulls)), "sampled pull requests"),
        metric("Last Commit", relative_date(latest_commit), format_date(latest_commit)),
        metric("Latest Release", nested_get(releases, [0, "tag_name"]) or "None", relative_date(latest_release)),
        metric("Watchers", compact(repository.get("subscribers_count") or repository.get("watchers_count")), "notification followers"),
        metric("Size", bytes_label((repository.get("size") or 0) * 1024), "repository footprint"),
    ]


def metric(label: str, value: str, caption: str) -> dict:
    return {"label": label, "value": value, "caption": caption}


def build_signals(repository: dict, commits: list, contributors: list, releases: list, community: dict, file_names: list[str]) -> list[dict]:
    latest_commit = nested_get(commits, [0, "commit", "committer", "date"])
    latest_release = nested_get(releases, [0, "published_at"])
    community_files = community.get("files") or {}

    return [
        signal("Recent development", latest_commit and days_since(latest_commit) <= 30, relative_date(latest_commit)),
        signal("Contributor spread", len(contributors) >= 3, f"{len(contributors)} contributors sampled"),
        signal("Release cadence", latest_release and days_since(latest_release) <= 180, relative_date(latest_release)),
        signal("Project metadata", bool(repository.get("description") and repository.get("license")), "description and license"),
        signal("README coverage", bool(community_files.get("readme") or "readme.md" in file_names), "root README or community profile"),
        signal("Contribution path", bool(community_files.get("contributing") or "contributing.md" in file_names), "contribution guide"),
        signal("Security posture", bool(community_files.get("code_of_conduct") or "security.md" in file_names), "conduct or security file"),
        signal("Community pull", (repository.get("stargazers_count") or 0) >= 50 or (repository.get("forks_count") or 0) >= 10, "stars or forks"),
    ]


def signal(label: str, ok: bool, detail: str) -> dict:
    return {"label": label, "ok": bool(ok), "detail": detail or "unknown"}


def build_risks(repository: dict, commits: list, releases: list, contributors: list, issues: list, pulls: list, file_names: list[str]) -> list[dict]:
    risks = []
    latest_commit = nested_get(commits, [0, "commit", "committer", "date"])
    latest_release = nested_get(releases, [0, "published_at"])

    if repository.get("archived"):
        risks.append(risk("critical", "Archived repository", "The repository is read-only and should be treated as historical."))
    if not latest_commit or days_since(latest_commit) > 120:
        risks.append(risk("high", "Stale development", "The default branch has not shown recent commit momentum."))
    if not repository.get("license"):
        risks.append(risk("medium", "Missing license", "Usage rights are unclear without a repository license."))
    if not latest_release:
        risks.append(risk("medium", "No release history", "Consumers may struggle to identify stable versions."))
    elif days_since(latest_release) > 365:
        risks.append(risk("medium", "Old latest release", "The latest sampled release is more than a year old."))
    if len(contributors) <= 1:
        risks.append(risk("medium", "Single-maintainer risk", "The sampled contribution graph is concentrated around one person."))
    if len(issues) >= 10:
        risks.append(risk("medium", "Issue queue pressure", "The sampled open issue queue is busy and may need triage."))
    if len(pulls) >= 8:
        risks.append(risk("medium", "Review bottleneck", "Several sampled pull requests are waiting in the queue."))
    if "readme.md" not in file_names and "readme" not in file_names:
        risks.append(risk("low", "Weak onboarding", "A visible README was not found in the root sample."))

    if not risks:
        risks.append(risk("low", "No major sampled risks", "The visible public signals look balanced."))

    return risks


def risk(level: str, title: str, detail: str) -> dict:
    return {"level": level, "title": title, "detail": detail}


def build_recommendations(signals: list, risks: list, dependencies: list, issues: list, pulls: list) -> list[dict]:
    recommendations = []
    failed = {signal["label"] for signal in signals if not signal["ok"]}
    risk_titles = {risk_item["title"] for risk_item in risks}

    if "README coverage" in failed:
        recommendations.append(action("Improve README", "Add setup, usage, examples, architecture notes, and contribution entry points.", "Documentation"))
    if "Contribution path" in failed:
        recommendations.append(action("Add CONTRIBUTING.md", "Make the first external contribution easier with setup, branch, and PR expectations.", "Community"))
    if "Security posture" in failed:
        recommendations.append(action("Add governance files", "Add SECURITY.md or a code of conduct to improve trust and reporting flow.", "Trust"))
    if "Release cadence" in failed:
        recommendations.append(action("Tag stable releases", "Use GitHub Releases so users can track stable versions and changelogs.", "Operations"))
    if "Issue queue pressure" in risk_titles or len(issues) >= 10:
        recommendations.append(action("Triage issues", "Label, prioritize, and close stale issues to reduce maintainer drag.", "Maintenance"))
    if "Review bottleneck" in risk_titles or len(pulls) >= 8:
        recommendations.append(action("Unblock PR review", "Review older pull requests and document merge expectations.", "Maintenance"))
    if dependencies:
        recommendations.append(action("Audit dependencies", f"Detected {len(dependencies)} ecosystem file(s). Add dependency scanning as the next analyzer module.", "Security"))

    if not recommendations:
        recommendations.append(action("Run deeper code analysis", "The public project signals look healthy. Next value comes from dependency and code-quality inspection.", "Next step"))

    return recommendations[:6]


def action(title: str, detail: str, category: str) -> dict:
    return {"title": title, "detail": detail, "category": category}


def detect_dependencies(file_names: list[str]) -> list[dict]:
    mapping = {
        "package.json": ("Node.js", "npm package manifest"),
        "requirements.txt": ("Python", "pip requirements"),
        "pyproject.toml": ("Python", "modern project metadata"),
        "poetry.lock": ("Python", "Poetry lockfile"),
        "pipfile": ("Python", "Pipenv manifest"),
        "cargo.toml": ("Rust", "Cargo manifest"),
        "go.mod": ("Go", "module manifest"),
        "pom.xml": ("Java", "Maven project"),
        "build.gradle": ("Java", "Gradle project"),
        "composer.json": ("PHP", "Composer manifest"),
        "gemfile": ("Ruby", "Bundler manifest"),
        "dockerfile": ("Container", "Docker build file"),
    }
    return [
        {"file": file_name, "ecosystem": ecosystem, "detail": detail}
        for file_name, (ecosystem, detail) in mapping.items()
        if file_name in file_names
    ]


def build_languages(languages: dict) -> list[dict]:
    total = sum(languages.values()) or 1
    return [
        {"name": name, "bytes": value, "percent": round((value / total) * 100, 1)}
        for name, value in sorted(languages.items(), key=lambda item: item[1], reverse=True)[:9]
    ]


def build_contributors(contributors: list) -> list[dict]:
    return [
        {
            "login": item.get("login"),
            "url": item.get("html_url"),
            "avatar": item.get("avatar_url"),
            "contributions": item.get("contributions", 0),
        }
        for item in contributors[:12]
    ]


def build_commits(commits: list) -> list[dict]:
    return [
        {
            "message": first_line(nested_get(item, ["commit", "message"]) or ""),
            "author": nested_get(item, ["commit", "author", "name"]) or "Unknown",
            "date": nested_get(item, ["commit", "author", "date"]),
            "sha": item.get("sha", "")[:7],
            "url": item.get("html_url"),
        }
        for item in commits[:12]
    ]


def build_releases(releases: list) -> list[dict]:
    return [
        {
            "name": item.get("name") or item.get("tag_name"),
            "tag": item.get("tag_name"),
            "date": item.get("published_at"),
            "prerelease": item.get("prerelease", False),
            "url": item.get("html_url"),
        }
        for item in releases[:8]
    ]


def build_work(issues: list, pulls: list) -> list[dict]:
    items = []
    for item in pulls[:6]:
        items.append(work_item(item, "PR"))
    for item in issues[:6]:
        items.append(work_item(item, "Issue"))
    return sorted(items, key=lambda item: item["created_at"] or "", reverse=True)[:10]


def work_item(item: dict, kind: str) -> dict:
    return {
        "kind": kind,
        "title": item.get("title"),
        "number": item.get("number"),
        "created_at": item.get("created_at"),
        "user": nested_get(item, ["user", "login"]) or "unknown",
        "url": item.get("html_url"),
    }


def build_files(contents: list) -> list[dict]:
    if not isinstance(contents, list):
        return []
    return [
        {
            "name": item.get("name"),
            "type": item.get("type"),
            "size": item.get("size", 0),
            "url": item.get("html_url"),
        }
        for item in contents[:18]
    ]


def build_report(repository: dict, score: int, grade: str, risks: list, recommendations: list) -> str:
    risk_text = "; ".join(risk_item["title"] for risk_item in risks[:3])
    action_text = "; ".join(item["title"] for item in recommendations[:3])
    return (
        f"{repository.get('full_name')} currently scores {score}/100, grade {grade}. "
        f"Top sampled risks: {risk_text}. Recommended next actions: {action_text}."
    )


def nested_get(value, path):
    current = value
    for key in path:
        if isinstance(key, int):
            if not isinstance(current, list) or len(current) <= key:
                return None
            current = current[key]
        elif isinstance(current, dict):
            current = current.get(key)
        else:
            return None
    return current


def first_line(value: str) -> str:
    return value.splitlines()[0] if value else ""


def days_since(value: str | None) -> int:
    if not value:
        return 9999
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return max(0, int((datetime.now(timezone.utc) - date).total_seconds() // 86400))


def relative_date(value: str | None) -> str:
    if not value:
        return "Unknown"
    days = days_since(value)
    if days == 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 30:
        return f"{days} days ago"
    if days < 365:
        return f"{days // 30} months ago"
    return f"{days // 365} years ago"


def format_date(value: str | None) -> str:
    if not value:
        return "Unavailable"
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return date.strftime("%b %d, %Y")


def compact(value) -> str:
    number = int(value or 0)
    if number >= 1_000_000:
        return f"{number / 1_000_000:.1f}M".replace(".0", "")
    if number >= 10_000:
        return f"{number / 1_000:.1f}K".replace(".0", "")
    return f"{number:,}"


def bytes_label(value) -> str:
    number = float(value or 0)
    units = ["B", "KB", "MB", "GB"]
    index = 0
    while number >= 1024 and index < len(units) - 1:
        number /= 1024
        index += 1
    return f"{number:.1f} {units[index]}".replace(".0", "")


def grade_from_score(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 45:
        return "D"
    return "F"


def label_from_score(score: int) -> str:
    if score >= 75:
        return "Healthy"
    if score >= 60:
        return "Promising"
    if score >= 45:
        return "Watchlist"
    return "At risk"


class GitHubError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5173"))
    app.run(host="127.0.0.1", port=port, debug=True)
