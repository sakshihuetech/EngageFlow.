# EngageFlow design system

EngageFlow uses a compact, enterprise-oriented visual language. CSS theme variables in `frontend/src/styles/index.css` are the source of truth and generate semantic Tailwind utilities.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `sidebar` | `#090D16` | Main navigation |
| `sidebar-soft` | `#0F172A` | Dark secondary surface |
| `primary` | `#16A34A` | Primary actions and focus |
| `primary-secondary` | `#22C55E` | Supporting green |
| `primary-soft` | `#ECFDF3` | Soft brand surface |
| `primary-border` | `#BBF7D0` | Subtle emerald borders |
| `primary-highlight` | `#6EE7B7` | Dark-surface emerald highlights |
| `success-soft` | `#DCFCE7` | Positive badge surface |
| `background` | `#F8FAFC` | App background |
| `surface` | `#FFFFFF` | Cards and controls |
| `text-primary` | `#0F172A` | Primary content |
| `text-secondary` | `#64748B` | Supporting content |
| `border` | `#E2E8F0` | Dividers and control borders |
| `border-strong` | `#CBD5E1` | Hovered and emphasized control borders |
| `danger` | `#DC2626` | Failures and destructive actions |
| `danger-border` | `#FECACA` | Soft-danger borders |
| `danger-hover` | `#FEE2E2` | Soft-danger hover surface |
| `warning` | `#B45309` | Warning text with accessible contrast |
| `info` | `#2563EB` | Informational states |

## Typography

The font stack prefers Inter when installed on the user's system and falls back to the native system sans-serif. Page titles are 28 px at weight 700, scaling to 26 px on narrow screens. Section headings use 17–18 px at weight 600. Card titles are 15–16 px; body and controls are 13–14 px; tables use 13–14 px; helper text is 11–12 px. Tight negative tracking is reserved for headings and brand text.

## Spacing and radius

The layout follows a four-pixel spacing rhythm. Controls are 40 px tall, cards use 20–24 px responsive padding, and primary page sections use 32 px gaps. Controls use the centralized 12 px `control` radius and cards use the 16 px `card` radius. Borders provide primary surface definition; low-opacity layered shadows add depth without making surfaces look elevated unnecessarily.

## Elevation and motion

The theme defines semantic `control`, `card`, `card-hover`, `topbar`, `emerald`, `sidebar-active`, and `float` shadows. Emerald shadow is limited to primary brand actions. Modal and drawer surfaces use the stronger float shadow.

Color, border, shadow, and transform interactions use 150–200 ms transitions with an ease-out curve. Buttons use a one-pixel pressed state, navigation has a restrained horizontal pressed state, and overlays use short fade/slide movement. The global reduced-motion media query minimizes animations and transitions for users who request it.

## Components

- Buttons support primary, secondary, ghost, and soft-danger variants with visible emerald keyboard focus.
- Inputs, selects, and textareas use a soft slate resting surface, white focused surface, stronger hover border, and subtle emerald focus ring.
- Cards provide the standard surface, border, radius, and shadow.
- Tables are framed by `TableShell`; data rendering remains feature-owned.
- Status badges map semantic states to success, warning, danger, info, or neutral colors.
- Loading, error, and empty states use consistent layout and language.
- Modal and drawer shells use subtle, reduced-motion-aware entrance transitions.

## Responsive behavior

The desktop sidebar appears at the existing large-screen breakpoint. Tablet and mobile widths continue to use the existing drawer interaction. Main content padding scales from 16 px on mobile to 32 px on desktop, page titles scale down slightly on narrow screens, and card grids stack without changing content hierarchy. Table overflow remains contained within the table surface.

Components consume semantic tokens instead of introducing one-off colors.
