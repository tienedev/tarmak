# Kanwise Improvement Roadmap

Validated on 2026-03-16. Each lot gets its own spec → plan → implementation cycle.

## Lot 1 — Fondations

**Objectif** : Consolider la base technique avant d'ajouter des features.

| Chantier | Description | Fichiers cles |
|----------|-------------|---------------|
| Pool connexions SQLite | Remplacer `Arc<Mutex<Connection>>` par un pool (r2d2, deadpool, ou tokio-rusqlite) | `crates/server/src/db/mod.rs` |
| Background tasks cleanup | Tache Tokio periodique pour purger les sessions expirees et les entrees rate-limiter stales | `crates/server/src/auth/mod.rs`, `crates/server/src/api/rate_limit.rs` |
| WebSocket reconnect client | Reconnexion automatique avec backoff exponentiel quand le WS se deconnecte | `frontend/src/lib/sync.ts`, `frontend/src/hooks/useSync.ts` |

**Statut** : En cours de spec

---

## Lot 2 — Self-hosted essentials

**Objectif** : Outiller les administrateurs self-hosted.

| Chantier | Description |
|----------|-------------|
| CLI `kanwise backup` | Backup SQLite atomique vers un fichier, avec option de chemin de sortie |
| CLI `kanwise restore` | Restaurer une DB depuis un backup |
| CLI `kanwise export` | Export JSON/CSV d'un board (colonnes, taches, labels, subtasks, commentaires) |
| CLI `kanwise import` | Import depuis JSON Kanwise et Trello JSON export |
| CLI `kanwise users list` | Lister les utilisateurs enregistres |
| Documentation ops | Guide backup/restore, config reverse proxy (nginx/caddy), monitoring/health, upgrade entre versions, limites connues |

**Statut** : A faire

---

## Lot 3 — Notifications & collaboration

**Objectif** : Renforcer la collaboration multi-utilisateurs.

| Chantier | Description |
|----------|-------------|
| Notifications persistantes | Table `notifications` en DB, types : mention, assignation, deadline J-1, nouveau commentaire |
| Notification delivery | Push via WebSocket existant + polling fallback |
| UI notifications | Badge dans la nav, panneau de notifications, marquer comme lu |
| Triggers | Declencheurs automatiques lors des mutations (assignation, mention @user dans commentaire, deadline proche) |
| Markdown commentaires | Utiliser Tiptap dans les commentaires (comme les descriptions de tache) |

**Statut** : A faire

---

## Lot 4 — Productivite board

**Objectif** : Ameliorer le workflow quotidien des utilisateurs.

| Chantier | Description |
|----------|-------------|
| Board templates | 3-5 templates predefinis (Sprint, Kanban simple, Bug tracker) + save board as template |
| Duplicate task | Copier une tache (avec labels, subtasks, custom fields) |
| Duplicate board | Copier un board complet (colonnes, templates de taches, labels) |
| Filtres persistants | Saved views par board (filtres nommes, stockes en DB, selectionnables dans le toolbar) |
| Drag-and-drop subtasks | Reordonner les subtasks visuellement avec dnd-kit |

**Statut** : A faire

---

## Lot 5 — Gestion de projet avancee

**Objectif** : Positionner Kanwise comme outil serieux de gestion de projet.

| Chantier | Description |
|----------|-------------|
| Task dependencies | Relations blocked-by / blocks entre taches, visualisation dans la timeline |
| Recurring tasks | Taches recurrentes (daily, weekly, custom cron), generation automatique |
| Time tracking | Timer start/stop par tache, cumul de temps, rapport par board/utilisateur |

**Statut** : A faire

---

## Lot 6 — Extensibilite & portee

**Objectif** : Ouvrir l'ecosysteme et elargir l'audience.

| Chantier | Description |
|----------|-------------|
| Webhooks | Enregistrer des URLs, notifier sur evenements board (task created, moved, completed, etc.) |
| i18n | Systeme de traduction frontend (fr, en minimum), detection langue navigateur |
| Offline mode | Service worker + cache Yjs local, sync au retour en ligne |

**Statut** : A faire

---

## Ordre des lots

```
Lot 1 (Fondations) → Lot 2 (Self-hosted) → Lot 3 (Notifications) → Lot 4 (Productivite) → Lot 5 (Gestion projet) → Lot 6 (Extensibilite)
```

Chaque lot est independant et livrable separement. Une branche, une PR, une release par lot.
