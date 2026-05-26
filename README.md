# Expenses Manager

PWA mobile-first para administrar cuentas, ingresos, gastos fijos y variables, opciones de corte e historico. La app comparte una sola UI y una sola logica de negocio entre dos modos:

- `qa`: sin OAuth ni D1, con datos mock y persistencia en `localStorage`.
- `prod`: preparada para Cloudflare Pages + Functions, Google OAuth y D1.

## Stack

- React + Vite + TypeScript
- `vite-plugin-pwa`
- Recharts para historico
- Framer Motion para transiciones suaves
- Cloudflare Pages Functions
- D1 para persistencia

## Scripts

```bash
npm install
npm run dev:qa
npm run build
npm run test
npm run lint
npm run cf:typegen
npm run cf:check
```

## QA local

El modo QA es el flujo principal para live testing. Usa el mismo layout, formularios y calculos que produccion, pero con un repositorio local.

```bash
npm run dev:qa
```

La app queda disponible normalmente en `http://localhost:5173/`.

## Produccion en Cloudflare

### 1. Crear la base D1

```bash
wrangler d1 create expenses-manager
```

Actualiza `wrangler.jsonc` con el `database_id` real que devuelva Cloudflare.

### 2. Aplicar migraciones

```bash
wrangler d1 execute expenses-manager --file migrations/0001_init.sql
wrangler d1 execute expenses-manager --file migrations/0002_add_projected_expenses.sql
wrangler d1 execute expenses-manager --file migrations/0003_add_cycle_archives.sql
```

Para desarrollo local con D1 puedes usar `--local`.

### 3. Configurar secretos

En Cloudflare Pages añade estos secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_BASE_URL`

Y deja `VITE_APP_MODE=prod` en el entorno de Pages.

### 4. Configurar Google OAuth

En Google Cloud Console:

- crea un cliente OAuth web
- añade como redirect URI:

```text
https://TU-DOMINIO/api/auth/callback
```

### 5. Deploy por GitHub

1. Sube este repo a GitHub.
2. En Cloudflare, crea un proyecto Pages conectado al repo.
3. Usa estos valores:
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Añade el binding D1 al proyecto Pages usando el mismo nombre `DB`.

## Estructura

- `src/domain/`: tipos y calculos de saldo, ciclos e historico.
- `src/data/runtime.ts`: adaptador QA/prod.
- `src/server/`: utilidades de sesion y repositorio D1 para Functions.
- `functions/api/[[path]].ts`: API edge central.
- `migrations/`: esquema inicial de D1 y cambios evolutivos como gastos proyectados.

## Estado actual

- QA local funcional
- UI moderna con efecto glass y animaciones suaves
- historico con graficas
- runtime Cloudflare preparado
- Google OAuth preparado a nivel de endpoints
- migracion D1 creada

## Nota

El bundle actual compila correctamente, aunque Vite avisa de que el chunk principal es grande. Si quieres, el siguiente paso natural es dividir rutas y charts con `lazy()` para reducir el peso inicial.
