# CPW Piauí #3 — Programação

App web estático e mobile-first com a programação da **Campus Party Piauí #3** (21 e 22 de novembro de 2026), feito com Vite + TypeScript puro + CSS. Sem backend, sem cadastro e sem analytics: os favoritos ficam apenas no `localStorage` do aparelho.

## Rodando

```sh
npm install
npm run dev      # servidor local do Vite
npm run build    # checagem de tipos + build em dist/
npm run preview  # servir o dist/ localmente
```

## Dados

O snapshot fica em `public/schedule.json` e é versionado, então **o build não depende da rede**. Para atualizar a programação:

```sh
npm run extract  # node scripts/extract.mjs
```

O script consulta o endpoint público usado pelo iframe oficial em
`https://app.4.events/c/SlN3elFGUXRJeXhnQ21BSw==/108/programacao-evento.html`:

```
GET https://api.4.events/activities/schedule/18443/108/v2
```

- `client_id = 18443`, `event_id = 108`.
- 99 atividades e 132 palestrantes no snapshot atual.
- Horários são normalizados para ISO com offset de `America/Fortaleza` (`-03:00`).
- As trilhas vêm do campo `tags` de cada atividade. Atividades sem tag aparecem como **GERAL** e só entram na agenda sem filtro ativo (não fazem parte das nove trilhas oficiais).
- Atividades com mais de uma tag aparecem em todos os filtros correspondentes.

## Funcionalidades

- **Agenda** por dia, em timeline vertical; atividades simultâneas ficam lado a lado em colunas (empacotamento guloso de intervalos). A timeline rola na horizontal quando há muitas salas, com colunas de largura mínima legível.
- **Linha "Agora"** no dia atual, atualizada a cada minuto e com rolagem automática ao abrir.
- **Filtros** por trilha em chips multi-seleção (nenhuma selecionada = tudo). Nove trilhas oficiais, cada uma com cor própria.
- **Detalhes** em bottom sheet: horário, duração, sala, descrição e palestrantes com foto, cargo e bio.
- **Favoritos** com estrela nos cards e no sheet, persistidos em `localStorage` (`cpw-piaui3-favorites`). A aba Favoritos lista por horário e avisa quando dois favoritos se sobrepõem.
- Estados de carregamento, erro e vazio; manifest PWA simples.

## Estrutura

```
scripts/extract.mjs   extração e normalização dos dados
public/schedule.json  snapshot versionado
public/manifest.webmanifest
public/icon.svg
src/main.ts           telas, filtros, favoritos e bottom sheet
src/data.ts           tipos de apoio, categorias, cores e formatação
src/timeline.ts       algoritmo de colunas por sobreposição
src/styles.css        tema escuro mobile-first (360–430 px)
```

## Decisões e limites

- UI em português, pensada para 360–430 px de largura (centralizada até 480 px em telas maiores).
- Aplicativo somente leitura: não há inscrição, login, notificações ou backend.
- Fotos de palestrantes são carregadas das URLs oficiais do 4.events; quando falham, aparecem as iniciais.
- As datas do cabeçalho são derivadas do snapshot, não fixas no código.
