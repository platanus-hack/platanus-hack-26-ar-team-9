# ALETH·IA — Frontend

> *"Las noticias del día, mapeadas por su veracidad."*

ALETH·IA no es un agregador de noticias más. Es una **newsletter visual**: en lugar de listar artículos, mostramos el paisaje narrativo del día como un **mapa de embeddings (t-SNE)**. Cada nodo es un evento (cluster de artículos sobre un mismo hecho); su **tamaño** indica cuántos medios lo cubrieron y su **color** revela el grado de discrepancia entre las versiones que dan los distintos medios.

Mensaje implícito: leer un solo medio te deja con la mitad de la película.

---

## Stack

- **Next.js 16** (App Router) + **React 19**
- **TypeScript** estricto
- **Tailwind CSS v4** + **shadcn/ui** (Radix primitives)
- **Zustand** para el estado de filtros (search + topic + medios)
- **Canvas 2D + D3** (`d3-scale`) para el mapa t-SNE
- **lucide-react** para íconos
- **next/font** con **Fraunces** (serif editorial) + **Inter** (sans)
- **pnpm** como package manager

---

## Setup local

```bash
cd front_end
pnpm install
pnpm dev
```

Abrí [http://localhost:3000](http://localhost:3000).

Otros scripts:

```bash
pnpm build   # build de producción (genera estáticos para cada /event/[id])
pnpm start   # servir el build
pnpm lint    # eslint
```

> **Nota sobre `pnpm-workspace.yaml`**: contiene `allowBuilds` para `sharp` (optimización de imágenes) y `unrs-resolver` (resolver interno de Next.js). pnpm 11 lo necesita para no abortar el install. No lo borres.

---

## Estructura de carpetas

```
front_end/
├── app/
│   ├── layout.tsx                    # Fuentes + metadata + body global
│   ├── page.tsx                      # Home: wordmark, search, mapa, paneles
│   ├── globals.css                   # Tokens (--color-*) + base oscura
│   └── event/[id]/page.tsx           # Detalle del evento (3 bloques)
├── components/
│   ├── Wordmark.tsx                  # ALETH · IA en serif
│   ├── SearchBar.tsx                 # Búsqueda fuzzy
│   ├── EmbeddingMap.tsx              # Canvas + D3 (corazón del producto)
│   ├── MapLegend.tsx                 # Popover ⓘ con leyenda
│   ├── TrendingTopicsPanel.tsx       # Chips single-select
│   ├── MediaFilterPanel.tsx          # Checkboxes multi-select
│   ├── ConsensusBlock.tsx            # 🟢 Verdad consensuada
│   ├── IsolatedDataBlock.tsx         # 🟡 Datos aislados
│   ├── DiscrepanciesBlock.tsx        # 🔴 Discrepancias entre medios
│   └── ui/                           # Primitivos shadcn (popover, checkbox)
├── lib/
│   ├── types.ts                      # Event, EventDetail, Filters
│   ├── colors.ts                     # divergence → token
│   ├── filterStore.ts                # Zustand: search/topic/media
│   ├── mockData.ts                   # Loaders + filtro AND
│   └── cn.ts                         # clsx + tailwind-merge
└── public/data/
    ├── events.json                   # Lista de eventos (12 mock)
    └── event-{id}.json               # Detalle por evento (4 ricos)
```
