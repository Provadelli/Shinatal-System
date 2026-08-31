---
name: Tropical Festive Narrative
colors:
  surface: '#f4fafc'
  surface-dim: '#d5dbdd'
  surface-bright: '#f4fafc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff5f6'
  surface-container: '#e9eff0'
  surface-container-high: '#e3e9eb'
  surface-container-highest: '#dde3e5'
  on-surface: '#161d1e'
  on-surface-variant: '#3c494c'
  inverse-surface: '#2b3133'
  inverse-on-surface: '#ecf2f3'
  outline: '#6c797c'
  outline-variant: '#bbc9cc'
  surface-tint: '#006876'
  primary: '#006876'
  on-primary: '#ffffff'
  primary-container: '#00bcd4'
  on-primary-container: '#004650'
  inverse-primary: '#44d8f1'
  secondary: '#006e1c'
  on-secondary: '#ffffff'
  secondary-container: '#91f78e'
  on-secondary-container: '#00731e'
  tertiary: '#8f4e00'
  on-tertiary: '#ffffff'
  tertiary-container: '#f19640'
  on-tertiary-container: '#633400'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a1efff'
  primary-fixed-dim: '#44d8f1'
  on-primary-fixed: '#001f25'
  on-primary-fixed-variant: '#004e59'
  secondary-fixed: '#94f990'
  secondary-fixed-dim: '#78dc77'
  on-secondary-fixed: '#002204'
  on-secondary-fixed-variant: '#005313'
  tertiary-fixed: '#ffdcc2'
  tertiary-fixed-dim: '#ffb77b'
  on-tertiary-fixed: '#2e1500'
  on-tertiary-fixed-variant: '#6d3a00'
  background: '#f4fafc'
  on-background: '#161d1e'
  surface-variant: '#dde3e5'
  christmas-red: '#C62828'
  festive-gold: '#FBC02D'
  surface-glass: rgba(255, 255, 255, 0.7)
  rio-deep-blue: '#1E61B7'
typography:
  headline-xl:
    fontFamily: Montserrat
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Montserrat
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Montserrat
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  headline-lg-mobile:
    fontFamily: Montserrat
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-max: 1200px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
---

## Brand & Style

The design system for the Shinatal internal event platform balances the corporate reliability of Shine Rio with the seasonal warmth of a Christmas celebration in Rio de Janeiro. The brand personality is professional and modern, yet remains organic by incorporating fluid lines inspired by Rio's landscape.

The chosen style is **Glassmorphism**, which provides a "frosted" aesthetic that serves two purposes: it creates a modern, high-tech interface while simultaneously evoking a sense of cool, wintery frost—a subtle nod to Christmas motifs within a tropical context. This is layered over a backdrop that features the iconic Sugarloaf Mountain silhouette, rendered in organic, flowing lines to maintain a "Shine Rio" identity. The overall mood is festive, clean, and sophisticated.

## Colors

This design system utilizes a vibrant teal and green foundation to represent the Shine Rio brand, ensuring the internal tool feels like an extension of the corporate identity. To signal the festive "Shinatal" theme, deep red and warm gold are used strategically as accent colors for high-priority notifications, "special edition" event badges, and festive decorations.

The color mode is set to light to maintain a fresh, daytime "beachy" feel, using a heavily desaturated teal or neutral gray for background surfaces to let the glassmorphism effects pop. The primary teal (#00BCD4) is used for action items, while the secondary green (#4CAF50) signifies success and positive status indicators.

## Typography

Typography in the design system is clean and accessible. **Montserrat** is used for headlines to provide a bold, geometric presence that matches the modern brand identity. Its wide apertures and modern feel work well for the "Shinatal" headers and value displays.

**Inter** is utilized for all body text, labels, and status indicators. It was chosen for its exceptional legibility at small sizes, ensuring that attendance lists and technical status details remain readable even on mobile devices. All labels use a slightly tighter tracking or increased weight to distinguish them from standard body prose.

## Layout & Spacing

The design system employs a **fixed grid** approach for desktop (12 columns) to ensure content remains centered and professional on larger monitors. On mobile, the system transitions to a fluid, single-column layout with generous margins to account for touch targets.

A consistent 8px base unit (linear scale) governs all spacing decisions. Navigation is responsive, utilizing a horizontal top-bar on desktop that collapses into a bottom-anchored "floating" tab bar on mobile to ensure ergonomic reachability. The Sugarloaf silhouette is used as a fixed background element, anchored to the bottom right of the viewport, scaling subtly to never obstruct core content.

## Elevation & Depth

Hierarchy is achieved through **Glassmorphism** and subtle backdrop filters. Surfaces do not use traditional heavy shadows; instead, they use a `backdrop-filter: blur(12px)` and a thin, semi-transparent white border (1px) to separate layers.

Depth tiers:
1.  **Background:** The base layer with the organic Rio silhouette and soft festive gradients.
2.  **Muted Layer:** Content areas with `rgba(255, 255, 255, 0.4)` blur, used for grouping minor elements.
3.  **Active Cards:** High-contrast glass surfaces `rgba(255, 255, 255, 0.8)` with a soft `0px 10px 30px rgba(0, 0, 0, 0.05)` shadow to signify interactivity.
4.  **Floating Elements:** Buttons and status indicators use solid colors to "punch through" the glass layers, ensuring they are the highest point in the visual hierarchy.

## Shapes

The shape language is **Rounded**, mirroring the organic curves found in the Shine Rio logo and the Sugarloaf Mountain silhouette. This softness contrasts with the technical nature of an internal event system, making the tool feel more welcoming and "festive." 

Large container cards use `rounded-xl` (24px) to emphasize the "pod" or "capsule" look of glassmorphism. Smaller elements like buttons and input fields follow the `rounded-lg` (16px) standard, while chips and status tags are fully pill-shaped.

## Components

### Glassmorphic Cards
Cards are the primary container. They must feature a blurred background and a subtle top-to-bottom white gradient border. Festive motifs (like a single snowflake or a golden light string) can be anchored to the top-right corner of "Featured Event" cards.

### Navigation
Desktop navigation is transparent and fixed to the top. Upon scrolling, it gains a glassmorphic background. Mobile navigation uses a floating dock with icons for "Events," "My Status," and "Notifications."

### Buttons
Primary actions use the Brand Teal. "Join Event" or "Confirm Attendance" buttons use a slight golden inner glow to feel "special." Secondary buttons are ghost-style with a 1.5px teal border.

### Status Indicators
Warnings (absences) use the Christmas Red (#C62828) in a soft, tinted container with bold red text. Success states use the Brand Green (#4CAF50). These indicators should be pill-shaped and located in the top-right of the card component.

### Dynamic Value Displays
Large counters (e.g., "Days until Shinatal") should use Montserrat Bold in the Christmas Gold (#FBC02D), appearing to "float" above the glass containers.

### Input Fields
Inputs are semi-transparent with a 1px border that turns Brand Teal on focus. Labels are always positioned above the field in Inter Bold (12px).