# Protocolo de actualización de Linki upstream

Este repositorio es un fork personalizado de Linki con automatización y soporte de interfaz en inglés, español y portugués (`en`, `es`, `pt-BR`). Las versiones nuevas de `moaljumaa/linki` deben integrarse; nunca deben copiarse encima del proyecto ni desplegarse directamente en producción.

## Preparación única

1. Mantener `origin` apuntando al fork de InHubFlow, sin tokens incrustados en la URL.
2. Autenticarse con Git Credential Manager o `gh auth login`.
3. Configurar el repositorio oficial como remoto de sólo lectura:

```bash
git remote add upstream https://github.com/moaljumaa/linki.git
git remote -v
```

4. Proteger `main` y exigir PR para cambios upstream.
5. No ejecutar `git reset --hard upstream/main`, `git push --force` ni copiar un ZIP oficial sobre el proyecto.

## 1. Evaluar la versión

Antes de integrar:

- Leer release notes, changelog y commits upstream.
- Identificar cambios de SQLite, dependencias, variables de entorno, Next.js, Playwright y LinkedIn.
- Revisar especialmente:
  - `lib/linkedin/connect.ts`
  - `lib/linkedin/runner.ts`
  - `lib/linkedin/sync-accepted.ts`
  - `lib/linkedin/session.ts`
  - `lib/db.ts`
  - `pages/inbox.tsx`
  - `pages/api/inbox/**`
  - `lib/i18n/LanguageContext.tsx`
  - `lib/i18n/types.ts`
  - `lib/i18n/locales/en.json`
  - `lib/i18n/locales/es.json`
  - `lib/i18n/locales/pt-BR.json`
- Si upstream toca uno de estos archivos, tratar la actualización como de riesgo alto aunque Git no genere un conflicto textual.

## 2. Crear punto de restauración

El árbol debe estar limpio:

```bash
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

El resultado de `git status --short` debe estar vacío. Después:

```bash
git branch backup/pre-upstream-AAAA-MM-DD
git tag backup-pre-upstream-AAAA-MM-DD
```

Antes del merge:

- Tomar un snapshot externo del volumen de producción.
- Respaldar `linki.db` y el estado persistente de sesiones/autenticación fuera del repositorio y del servidor.
- Verificar que el respaldo de SQLite se pueda abrir.
- No subir a GitHub bases de datos, `.env`, cookies, sesiones, tokens o backups.

## 3. Integrar en una rama aislada

```bash
git fetch --all --prune
git switch -c update/linki-AAAA-MM-DD
git merge --no-ff upstream/main
```

Reglas para conflictos:

- No usar “Accept all incoming” ni “Accept all current”.
- Resolver cada conflicto manualmente y comprender ambas versiones.
- Preservar el comportamiento personalizado, no necesariamente el texto antiguo exacto.
- Si upstream rediseñó un módulo, trasladar nuestras garantías a la arquitectura nueva.
- Revisar el diff completo con `git diff main...HEAD`.
- Confirmar que no desaparecieron idiomas, validaciones, límites, horarios, filtros por slot ni sincronizaciones.

## 4. Verificación técnica

```bash
npm ci
npx tsc --noEmit
npx eslint lib/linkedin lib/i18n pages/inbox.tsx pages/api/inbox
npm run build
git diff --check
git status --short
```

Además:

- Explicar cambios en `package-lock.json`.
- Probar las migraciones sobre una copia de la base real, nunca primero en producción.
- Verificar login, persistencia de sesiones, arranque del runner, límites diarios, horarios e inbox.
- No aprobar errores nuevos, warnings críticos ni migraciones no comprendidas.

## 5. Matriz EN / ES / PT-BR

Probar en staging, una acción a la vez; no ejecutar varios `Run now` simultáneamente.

### Interfaz

- Cambiar entre inglés, español y portugués y recargar.
- Verificar navegación, campañas, contactos, inbox, settings, errores y persistencia del idioma.
- Comparar las claves de `en.json`, `es.json` y `pt-BR.json`.

### LinkedIn

- Perfil con `Connect/Conectar` visible.
- Perfil Creator con `Follow/Seguir` y `Connect/Conectar` dentro de `...`.
- Perfil con acción personalizada (`Agende uma reunião`).
- Confirmar que el `vanityName` pertenece al target, nunca a una recomendación.
- Probar modal sin nota, correo obligatorio, invitación pendiente, error y límite semanal.
- Registrar éxito sólo cuando LinkedIn muestre `Pending/Pendente` tras recargar.
- Aceptar una invitación controlada y verificar `degree = 1`, avance y mensaje posterior.

### Inbox y runner

- Probar bandeja general y filtro por cada slot.
- Confirmar cuenta de origen en LinkedIn, email, ambos y datos históricos.
- Verificar que el reply detiene outreach cuando corresponde.
- Confirmar que email/hilo/respuesta usan la cuenta de origen.
- Un fallo no debe marcar falsamente `connection_requested_at` ni duplicar mensajes.

## 6. PR y staging

```bash
git push -u origin update/linki-AAAA-MM-DD
```

El PR debe documentar:

- SHA/versión upstream;
- conflictos resueltos;
- migraciones y dependencias;
- personalizaciones adaptadas;
- resultados EN/ES/PT-BR;
- plan de rollback.

Desplegar primero la rama en staging y completar un ciclo funcional. Requerir aprobación humana antes del merge y del deploy productivo.

## 7. Producción

- Fusionar sin reescribir el historial de `main`.
- Crear una etiqueta de release interna.
- Pausar campañas si cambia el esquema o el runner.
- Tomar un último snapshot.
- Desplegar en una ventana supervisada.
- Reactivar primero una campaña y contacto controlados; ampliar gradualmente.

## 8. Rollback

Ante errores de datos, autenticación, duplicados, idiomas o automatización:

1. Pausar campañas y runner.
2. No lanzar varios `Run now` para intentar corregirlo.
3. Redeplegar el SHA/etiqueta estable anotado.
4. Si cambió el esquema o los datos, restaurar el snapshot compatible.
5. Verificar login, contactos, campañas e inbox antes de reanudar.
6. Registrar hora, target, idioma, SHA y pasos de reproducción.

## Criterio de aprobación

Una actualización sólo puede llegar a producción cuando:

- todos los conflictos están explicados;
- TypeScript, lint focalizado, build y `diff --check` pasan;
- la migración se probó sobre una copia;
- EN, ES y PT-BR pasan la matriz;
- conexión directa y Creator fueron confirmadas en LinkedIn;
- inbox general y filtros por slot funcionan;
- existe un backup verificado y rollback documentado;
- el PR fue aprobado y staging permaneció estable.
