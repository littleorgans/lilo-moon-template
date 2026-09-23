---
"@littleorgans/theme": minor
"@littleorgans/ui": minor
"@littleorgans/views": minor
---

Add the theme preference model and the switcher surfaces. `@littleorgans/theme` gains the
cookie-borne `ThemePreference` (parse, serialize, apply-one-field), `THEME_NAMES`, and the
exported default theme name. The generated stylesheet and the Tailwind dark variant now key
dark on `data-mode="dark"` instead of the `.dark` class, so applications stamp `<html>` with
data attributes only. `@littleorgans/views` gains `ThemeSwitcher`, a no-JavaScript form of
submit buttons, and `ThemeLab`, the page that renders every component and color token under
the live preference.
