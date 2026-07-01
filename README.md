# GitHub Analyzer

A Python-backed GitHub repository intelligence cockpit. Flask serves the app, Python talks to the GitHub REST API, and the browser renders an immersive analysis dashboard.

## Run

```powershell
python app.py
```

Then open:

```text
http://127.0.0.1:5173
```

Enter any public repository:

- `facebook/react`
- `vercel/next.js`
- `https://github.com/microsoft/vscode`
- `git@github.com:django/django.git`

For private repositories or higher API limits, paste a GitHub token that has access to that repository.

## Current Features

- Flexible repository input parsing
- Optional GitHub token support
- Repository identity summary
- Python API layer with server-side GitHub calls
- Health score and letter grade
- Eight quality signals
- Risk scanner
- Smart recommendations
- Dependency manifest detection
- Language breakdown
- Recent commits
- Release sampling
- Contributor ranking
- Open issue and pull request sampling
- Root file browser
- Immersive interactive dashboard tabs
- Copyable report summary

## Next Upgrades

- Store recent searches locally
- Compare two repositories side by side
- Add deeper dependency/security analysis
- Add local cloned-repository analysis
- Export PDF or Markdown reports
