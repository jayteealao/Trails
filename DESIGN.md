# Design

## Overview
A calm reading app on standard Material 3, in navy and sky blue. Token file: none.

## Colors
The Android app uses a navy and sky-blue palette (`android/app/src/main/java/com/jayteealao/trails/screens/theme/Color.kt`), mapped to Material 3 roles in `Theme.kt`. It supports light and dark mode. Dark mode follows an in-app Settings toggle, not the system setting. Dynamic colour exists in `TrailsTheme(dynamicColor)` but is off by default. Each role below has a light value and a dark value. The Material 3 role it maps to is named in "Used for".

### Token roles
| Role | Kind | Light (light) | Dark (dark) | Used for |
|---|---|---|---|---|
| ground | color | #F5FBFF | #00111F | page background (`background`, Cloud / Ink) |
| surface | color | #FFFFFF | #001B33 | cards, list items, the bottom bars (`surface`) |
| raised | color | #E5F4FD | #0F2A45 | dialog containers (`surfaceContainerHigh`) |
| surface-variant | color | #E5F4FD | #0F2A45 | unselected chips, quiet containers (`surfaceVariant`) |
| text | color | #03045E | #CAF0F8 | body text and titles (`onSurface`) |
| text-secondary | color | #023E8A | #B7CCE0 | domains, secondary labels (`onSurfaceVariant`) |
| accent | color | #023E8A | #00B4D8 | primary action, current selection, applied tag label (`primary`) |
| accent-text | color | #FFFFFF | #03045E | text on a filled accent button (`onPrimary`) |
| accent-container | color | #CAF0F8 | #005D85 | selected nav item pill, selected segment, tonal button (`primaryContainer`) |
| inverse-surface | color | #00111F | #CAF0F8 | snackbar container (`inverseSurface`) |
| inverse-text | color | #CAF0F8 | #00111F | snackbar text (`inverseOnSurface`) |
| inverse-accent | color | #00B4D8 | #023E8A | snackbar action (`inversePrimary`) |
| chip-applied | color | #D7E0EC | #00344D | applied tag chip fill: primary at 16% on surface |
| border | color | #B7CCE0 | #20374E | dividers and chip outlines (`outlineVariant`) |
| outline | color | #51708A |  | field and segment outlines, unchecked switch (`outline`) |
| focus | color | #0077B6 | #56C7E5 | focus ring |
| scrim | color | #00111F99 |  | scrim behind a sheet, a dialog or a menu |
| error | color | #BA1A1A | #FFB4AB | error state (`error`) |
| warning | color | #7A4F00 | #FFB95C | warning state; no product use yet |
| success | color | #1B6B3A | #86D9A0 | success state; no product use yet |
| info | color | #0077B6 | #56C7E5 | info state; no product use yet |

## Typography
Google Downloadable Fonts (`screens/theme/Type.kt`). Piazzolla SemiBold is used for `titleMedium` (article titles, sheet headings), and Norican (script) for `titleLarge` (the app name only). `bodyLarge` is the default family (Roboto on device) at 16/24 sp. Every other style is the Material 3 default. Tag chips use `labelSmall`, which is 11 sp in Material 3, but the chips render it larger on device.

### Token roles
| Role | Kind | Light (light) | Dark (dark) | Used for |
|---|---|---|---|---|
| font-body | font | Roboto, system-ui, sans-serif |  | body text, labels, chips |
| font-display | font | Piazzolla, Georgia, serif |  | article titles, sheet, empty and error headings |
| font-script | font | Norican, cursive |  | the app name in the top bar and sign-in |
| text-xs | type | 12px |  | captions |
| text-sm | type | 13px |  | chips, domains |
| text-md | type | 16px |  | body, buttons, menu items |
| text-h3 | type | 19px |  | reader heading 3 |
| text-lg | type | 20px |  | article titles in the list, sheet title |
| text-bar | type | 22px |  | top bar title of a detail screen |
| text-h2 | type | 23px |  | reader heading 2 |
| text-xl | type | 28px |  | app name, reader heading 1 |
| weight-regular | weight | 400 |  | body |
| weight-medium | weight | 500 |  | labels, buttons |
| weight-semibold | weight | 600 |  | titles |
| leading-tight | leading | 1.3 |  | headings |
| leading-body | leading | 1.5 |  | body text |

## Layout
Phone-first single column, with list-detail on wide screens (`AdaptiveArticleGrid`). List items have a thumbnail at left and the title and domain at right, a tag row below, and a full-width hairline divider between items. The spacing rhythm uses a 4 dp base.

### Token roles
| Role | Kind | Light (light) | Dark (dark) | Used for |
|---|---|---|---|---|
| space-1 | space | 4px |  | chip gaps, icon-to-label |
| space-2 | space | 8px |  | inside chips, between rows of chips |
| space-3 | space | 12px |  | inside list items |
| space-4 | space | 16px |  | screen gutters, between sections |
| space-5 | space | 24px |  | button sides, list indents, dialog padding |
| space-6 | space | 32px |  | between groups |
| space-7 | space | 64px |  | above an empty state |
| space-8 | space | 96px |  | above a reader notice |
| size-icon-sm | size | 18px |  | icon in a chip |
| size-icon | size | 24px |  | icon |
| size-icon-lg | size | 40px |  | icon of a notice |
| size-chip | size | 32px |  | chip and nav pill height |
| size-control | size | 40px |  | button height |
| size-target | size | 48px |  | smallest touch target, menu row |
| size-field | size | 56px |  | text field height |
| size-tab | size | 64px |  | archive tab height, nav pill width |
| size-tab-min | size | 90px |  | narrowest archive tab |
| size-thumb | size | 112px |  | list thumbnail |
| size-menu | size | 280px |  | widest menu |
| size-dialog | size | 360px |  | widest dialog |
| size-measure | size | 680px |  | reading measure |
| size-column | size | 720px |  | single column on wide screens |

## Elevation & Depth
Material 3 tonal elevation defaults; there is no custom elevation system. Depth shows through tonal surfaces, and through one soft shadow for overlays: the bottom sheet and the menu.

### Token roles
| Role | Kind | Light (light) | Dark (dark) | Used for |
|---|---|---|---|---|
| shadow-raised | shadow | 0 2px 8px #00111F33 |  | menus and snackbars |
| shadow-overlay | shadow | 0 2px 8px #00111F33 |  | sheets and dialogs |
| layer-overlay | layer | 5 |  | scrim |
| layer-sheet | layer | 6 |  | sheet, dialog, menu |
| layer-toast | layer | 7 |  | snackbar over an overlay |

## Shapes
Material 3 shapes are set per component. Chips are 8 dp, cards and thumbnails 16 dp, and the sheet's top corners 28 dp. Buttons are full pills, as in Material 3 defaults.

### Token roles
| Role | Kind | Light (light) | Dark (dark) | Used for |
|---|---|---|---|---|
| radius-xs | radius | 4px |  | fields, snackbars |
| radius-sm | radius | 8px |  | chips, menus |
| radius-md | radius | 16px |  | thumbnails, cards |
| radius-lg | radius | 28px |  | sheets and dialogs |
| radius-full | radius | 999px |  | buttons, pills |

## Components
Jetpack Compose with Material 3 (Compose BOM 2026.06.01), and Navigation 3 with list-detail, dialog and bottom-sheet scene strategies. Shared components: `TrailScaffold`, `TrailsTopAppBar`, `AdaptiveArticleGrid`, `ArticleListItem`, `TagSection`, `ArticleThumbnail`. Dialogs use the Material 3 alert dialog through the dialog scene strategy; `LogoutConfirmationDialog` is the reference. Images load with Coil 3. Tags use one shared tag chip on the list and in the tag sheet. An applied or selected tag is filled with `chip-applied` and labelled with `accent`. A suggested tag has no fill, a 1 dp dashed `accent` outline and a `text-secondary` label, and it sits after the applied tags. An available tag in the sheet uses `surface-variant` with a `border` outline. An auto-added tag carries a small sparkle mark in the sheet only. Approve and dismiss go through a small menu on the chip, followed by a snackbar with Undo.

## Do's and Don'ts
- Do use standard Material 3 components, so every surface looks like one app.
- Do keep organisation calm: no badges, counts or notification dots on the list.
- Don't signal a state by colour alone; pair it with a shape, an outline style or a label.

## Notes
- Icons come from three sets (Material Symbols drawables, Material Icons, CSS.gg); new UI uses Material Symbols.
- `android/UI_DESIGN_SPEC.md` (2025-11-17) holds earlier specs for Settings and Auth.
- The Warg web dashboard is a separate surface with its own dark palette (Inter, JetBrains Mono, teal accent) and shares no tokens with the app.
