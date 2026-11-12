# Wellnest – Wellness Challenge Platform

Wellnest is a client-side wellness challenge platform built for the **CSE326 – Internet Programming** course.
Organizations create non-clinical wellness challenges; participants join them, log activities, earn points,
build streaks, unlock badges and compete on leaderboards.

It is built with **only HTML5, CSS3 and vanilla JavaScript (ES6 modules)**. It uses no frameworks, libraries, build tools or backend.
Charts, icons and illustrations are hand-built SVG.

---

## 1. Features

### Participant interface
| Page | What it does |
|------|--------------|
| `index.html` | Landing page with a hero, live platform statistics, featured challenges, how it works, categories, a badge and leaderboard preview, benefits and a call to action |
| `dashboard.html` | Personalized greeting and date, points, active challenges, streak, activity totals, weekly goal rings, daily points chart, challenge progress, recent activity timeline, streak calendar, achievements, reminders and quick actions |
| `challenges.html` | Featured spotlight, search, category chips, status filter, sorting (popularity, reward, duration, ending soon, newest) and join buttons. Filters are kept in SessionStorage |
| `challenge.html?id=…` | Challenge detail with objective, target metrics, guidelines, requirements, your progress, participation stats, a challenge ranking, participants, and a community feed. Supports join and leave with confirmation. Unknown IDs show a custom 404 state |
| `leaderboard.html` | Weekly, overall and per-challenge rankings with a top-three podium, sortable table, search, rank-movement indicators and privacy filtering |
| `profile.html` | Profile header, editable profile and avatar, weekly goals, personal statistics, category donut, participation history, filterable activity history and badges |
| `settings.html` | Privacy toggles, reminder preferences, theme (light, dark or system), demo-participant switcher, JSON export and reset of the demo data |

### Organizer interface (`organizer.html`)
- **Overview:** participants, active and completed challenges, activities logged, a 30-day trend and a list of challenges that need attention.
- **Challenge management:** create and edit challenges (validated form with a cover picker), plus activate, pause, archive and delete-draft actions.
- **Participants:** a searchable table with an engagement filter and a detailed inspection dialog for each member.
- **Analytics:** challenge participation, activity distribution, daily engagement, engagement segments and completion rates.

> The organizer role is a **simulated interface role** for demonstration. It is not secure authentication.

### Cross-cutting features
- A reusable **Log activity** modal that can be opened from any page. It validates input with HTML attributes, JavaScript and regular expressions, and shows a live points preview.
- Reminders can be added, edited, completed, enabled, disabled and deleted. In-app alerts appear when a reminder becomes due.
- A toast notification system and accessible confirmation dialogs.
- Light and dark themes, a responsive layout with a mobile drawer and a bottom tab bar, and loading skeletons and empty states throughout.
- Multiple open tabs stay in sync through the `storage` event.

---

## 2. Design system
The visual identity uses a **midnight ink, warm ivory and champagne gold** palette, with muted clay and stone as supporting neutrals. Every colour is a CSS custom property in `static/css/main.css`:
- **Ink** (`--ink-*`): primary buttons, feature cards and dark sections.
- **Champagne gold** (`--gold-*`, `--gradient-gold`): accents, highlights, charts and achievements.
- **Ivory and stone** (`--color-bg`, `--color-surface-*`): warm, paper-like light-theme surfaces.
- **Category tones**: muted jewel colours (terracotta, steel blue, dusty plum, olive and antique gold).
- **Dark theme**: deep charcoal surfaces with champagne-gold primary actions.

## 3. Technology stack
- **HTML5:** semantic elements (`header`, `nav`, `main`, `section`, `article`, `aside`, `footer`, `form`, `fieldset`, `legend`, `table`, `progress`, `time`, `dl`).
- **CSS3:** custom properties (the design-token system), Grid, Flexbox, positioning, pseudo-classes and pseudo-elements (`:has`, `:focus-visible`, `::before`, `::-webkit-progress-value`), attribute selectors, transitions, keyframe animations, media queries, `prefers-reduced-motion` and print styles.
- **JavaScript (ES6+ modules):** DOM manipulation, event delegation, Fetch API, JSON, LocalStorage, SessionStorage, the Blob download API, regular expressions, `Date` handling, higher-order array methods and `try/catch` error handling.

---

## 4. Folder structure

```
wellness-challenge-platform/
├── index.html  dashboard.html  challenges.html  challenge.html
├── leaderboard.html  profile.html  organizer.html  settings.html
├── README.md
├── data/                      ← read-only JSON seed data
│   ├── users.json  challenges.json  activities.json
│   ├── enrollments.json  badges.json  reminders.json
└── static/
    ├── css/
    │   ├── main.css           ← design tokens, base, layout, header, footer
    │   ├── components.css     ← buttons, forms, modal, toast, cards, charts…
    │   ├── pages.css          ← page-specific layouts
    │   └── responsive.css     ← breakpoints, mobile nav, reduced motion, print
    ├── js/
    │   ├── app.js             ← bootstrap + state holder + commit()
    │   ├── data-service.js    ← fetch & normalise JSON seed data
    │   ├── storage.js         ← LocalStorage / SessionStorage wrapper
    │   ├── engine.js          ← all rules & calculations (points, progress, streaks, badges, leaderboards)
    │   ├── actions.js         ← all state changes with validation
    │   ├── navigation.js      ← header, mobile drawer, tab bar, footer
    │   ├── utils.js           ← DOM, date, formatting, regex & form helpers
    │   ├── theme-init.js      ← applies the saved theme before first paint
    │   ├── components/        ← modal, toast, activity-form, notifications,
    │   │                        reminders, charts, templates
    │   └── pages/             ← one script per HTML page
    └── assets/
        ├── images/ (logo, backgrounds, challenge covers, avatars, badges)
        ├── icons/  (SVG sprite + favicon)
        └── media/
```

---

## 5. JSON data architecture
| File | Contents |
|------|----------|
| `users.json` | 12 participants and 1 organizer: id, name, email, role, avatar, headline, bio, team, join date, weekly goals and privacy preferences |
| `challenges.json` | 12 challenges: id, title, description, objective, category, image, start/end date, duration, activity types, metric (`total` or `days`), target value/unit, daily minimum, reward, status, featured flag, guidelines and requirements |
| `activities.json` | Around 530 activity records: id, user, challenge, type, value, unit, date-time, description and points |
| `enrollments.json` | Enrollment id, user, challenge, enrollment date and status (`active`, `completed` or `left`) |
| `badges.json` | 10 achievements with rule definitions, for example `{ "type": "longestStreak", "threshold": 3 }` |
| `reminders.json` | Demo reminders with time, repeat pattern, category, enabled flag and completion date |

The seed data was written around **12 Nov 2026**. On first load, every date is shifted so that this reference date becomes *today*.
This keeps the demo looking active whenever you open it.

---

## 6. Persistence (LocalStorage)

```
First visit   →  fetch data/*.json → normalise → build state → save to LocalStorage
Later visits  →  read state from LocalStorage (validated)
Any change    →  actions.js → commit() → recalculate → save → re-render
Reset         →  fetch the JSON again → overwrite the saved state
```

- All data is stored under one namespaced key, **`wellnest_app_v1`**. The theme is mirrored in `wellnest_app_v1:theme` so it can be applied before first paint. `localStorage.clear()` is never used.
- If saved data is missing, invalid or corrupted, it is detected and replaced with fresh seed data, and the user sees a notice.
- **SessionStorage** holds per-tab UI state: challenge filters, the active leaderboard and organizer tabs, and which reminder alerts have already been shown.

### Wellness rules (from `engine.js`)
- **Points:** each activity type and unit has a rate. For example, 1 point per 200 steps, 1.5 points per meditation minute and 3 points per glass of water. Each type is capped at **200 points per day**.
- **Validation:** values must be within the per-entry minimum and maximum. Future dates and dates more than 13 days back are rejected, as are duplicate entries.
- **Challenge rules:** an activity counts toward a challenge only if:
  - you are enrolled,
  - the challenge is active,
  - it accepts that activity type and unit, and
  - the date falls inside the challenge window.
- **Completion:** progress is recalculated after every change. Reaching the target marks the enrollment as completed and awards the challenge's bonus points once.
- **Streaks:** a streak counts consecutive active days. If nothing has been logged yet today, the streak still counts from yesterday.
- **Badges:** eligibility is evaluated from the rules after every change. Unlocks are permanent and show their date.
- **Leaderboards:** rankings are computed live. Rank movement compares against standings from 7 days earlier. Members with leaderboard visibility turned off are excluded.

---

## 7. Running locally

The pages load JSON with `fetch()`, so they **must be served over HTTP**. Opening `index.html` directly with `file://` does not work; the app shows an explanatory error if you try.

Choose one of these options:
- **VS Code Live Server:** right-click `index.html` and choose **Open with Live Server**.
- **Python:** run `python3 -m http.server 8000` in this folder, then open `http://localhost:8000`.
- **Node:** run `npx serve .` (optional; no packages are needed by the project itself).

To start fresh at any time, use **Settings → Reset data**.

---

## 8. Deploying to GitHub Pages
1. Push this folder to a GitHub repository. The HTML files must sit at the repository root, or in `/docs`.
2. Open **Settings → Pages** in the repository.
3. Under **Source**, choose *Deploy from a branch*, then select `main` and `/ (root)`.
4. Save. After a minute the site is live at `https://<username>.github.io/<repository>/`.

Every path in the project is relative (`data/…`, `static/…`), so the site works from a GitHub Pages sub-path without any changes.

---

## 9. Accessibility
- Skip link, logical heading hierarchy, a descriptive `<title>` and meta description on every page.
- Labels on all form controls. Errors are linked with `aria-describedby` and flagged with `aria-invalid`, and focus moves to the first invalid field.
- Dialogs use `role="dialog"` and `aria-modal`, trap focus, close with <kbd>Esc</kbd> and return focus afterwards.
- Tabs follow the WAI-ARIA pattern with arrow-key navigation. Sortable tables expose `aria-sort`.
- Live regions announce toasts and filter results. Charts include text alternatives.
- Visible `:focus-visible` outlines, sufficient colour contrast in both themes, and support for `prefers-reduced-motion`.

---

*Wellnest is a non-clinical demonstration. It collects no medical data and gives no medical advice.*
