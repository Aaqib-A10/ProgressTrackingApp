# Colour themes

Every colour in the app comes from here. Screens never use a fixed colour; `npm run colors:check -w client` fails if one does.

## How it fits together

- `roles.ts`: the colour **roles** every theme fills in: page, card, sidebar, text, border, accent, the five statuses (success, warning, error, info, highlight), 8 named hues, a grey scale and 6 chart colours.
- `themes/`: the themes. `metriq.ts` is the original look (the default). The others come from Meta's Astryx themes (MIT, `palettes/astryx.generated.ts`), turned into Metriq roles by `palettes/fromAstryx.ts`. Astryx's y2k theme is left out.
- `build.ts`: turns a theme into CSS. It also makes every theme readable (WCAG AA). Text reaches 4.5:1 on what it sits on, button text reads on the button and on its hover colour, and pale surfaces stay pale.
- `theme.css`: **generated**. Run `npm run theme:build -w client` after changing a theme; never edit it by hand.
- `brand.ts`: a company's own brand colour in place of the accent (buttons, links, selection, focus), worked out per theme so it always reads.
- `lib/theme.ts`: what shows. Light or dark is per device. The colour theme is the person's own pick (Settings), else their company's (Company Settings → Look), else Metriq. The public website always shows Metriq.

## Using colours in a screen

| Want | Use |
|---|---|
| Page, card, border, text | `bg-bg`, `bg-card`, `border-line`, `text-ink`, `text-ink-muted` |
| Main button | `bg-primary text-primary-on` (or `<Button>`) |
| A link or accent text | `text-primary-ink` |
| Status chip | `bg-success-muted text-success-ink` (or `<Badge tone="success">`) |
| Solid status (button, dot) | `bg-danger text-danger-on` |
| A category colour | `bg-orange-subtle`, `text-blue-ink`, `bg-teal-vivid text-teal-on`, `border-purple-ring` |
| Chart series (SVG) | `CHART.*` / `SERIES_COLORS`, or `themeColor('c-chart-1')` |
| Inline style | `role('accent')`, `tone('success')`, `dataTint(color)` from `theme/css.ts` |

Never use numbered colours (`bg-orange-50`), hex values, or a solid status colour as text (`text-warning`). `ui:check` rejects all three.

## Checks

- `npm run colors:check -w client`: theme.css is up to date. Every theme, light and dark, passes 55 contrast pairs. 10 sample brand colours pass in every theme. No screen uses a fixed colour.
- `npm test` (root) runs it after the server tests.

## Adding a theme

1. Add it to `themes/index.ts` (and its id to `server/src/lib/themes.ts`, the list the server accepts).
2. `npm run theme:build -w client`, then `npm run colors:check -w client`.
