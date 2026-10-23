# Mock Jira

A small, dependency-free Jira-style issue tracker that runs entirely in the browser.
Data is stored in your browser's `localStorage`, so there is no server or sign-up.

**Live demo:** https://lcmbryan-dev.github.io/mock-jira/

## Features

- Kanban **board** with To Do / In Progress / In Review / Done columns and drag-and-drop
- **Backlog** list view
- Create, edit and delete issues (keys like `MJ-1`)
- Issue types (Story, Bug, Task, Epic), priorities, assignees, story points and labels
- Comments on each issue
- Search and filter by type, assignee and priority
- Export / import all data as JSON, and reset to sample data

## Run locally

Open `index.html` in a browser. No build step is needed.

## Notes

Data lives only in your own browser, so each browser/device has its own copy. Use Export to back it up or move it.
