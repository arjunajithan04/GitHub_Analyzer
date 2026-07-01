# GitHub Analyzer

A modern, dependency-free GitHub repository analyzer that runs directly in the browser and uses the GitHub REST API.

## Run

Open `index.html` in a browser, then enter any public repository:

- `facebook/react`
- `vercel/next.js`
- `https://github.com/microsoft/vscode`
- `git@github.com:django/django.git`

For private repositories or higher API limits, expand **Optional access token** and paste a GitHub token that has access to that repository.

## Current Features

- Flexible repository input parsing
- Optional GitHub token support
- Repository identity summary
- Health score with eight quality signals
- Recommended actions
- Language breakdown
- Recent commits
- Release sampling
- Contributor ranking
- Open issue and pull request sampling
- Root file browser
- Interactive dashboard tabs

## Next Upgrades

- Store recent searches locally
- Compare two repositories side by side
- Add dependency/security analysis
- Add real charts once the project moves to React or another frontend framework
