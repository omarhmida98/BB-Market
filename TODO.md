# TODO - Afficher qui a approuvé/rejeté une commande (superadmin uniquement)

## Étapes

### 1. shared/db-schema.ts - Ajouter les colonnes
- [x] Ajouter `approvedBy`, `approvedAt`, `rejectedBy`, `rejectedAt` à `pgMessages`
- [x] Ajouter `approvedBy`, `approvedAt`, `rejectedBy`, `rejectedAt` à `sqliteMessages`

### 2. server/db.ts - Migration SQLite
- [x] Ajouter `ensureSqliteColumns` pour les colonnes sur la table `messages`

### 3. shared/schema.ts - Étendre le type Message
- [x] Ajouter `approvedBy`, `approvedAt`, `rejectedBy`, `rejectedAt` au type `Message`
- [x] Mettre à jour `messageSchema`

### 4. server/storage.ts - Méthode de mise à jour du statut avec acteur
- [x] Créer `updateMessageStatusWithActor(id, status, actorUsername)`
- [x] Enregistrer le username + date selon le statut

### 5. server/routes.ts - Enregistrer l'admin acteur
- [x] Appeler la nouvelle méthode dans `PATCH /api/messages/:id/status`

### 6. client/src/pages/Admin.tsx - Afficher l'info (superadmin)
- [x] Afficher "Approuvé par X le date" / "Rejeté par X le date" dans la modale
- [x] Restreindre l'affichage aux superadmins

### 7. Vérification
- [x] Vérifier que le projet compile (TypeScript) sans erreur

