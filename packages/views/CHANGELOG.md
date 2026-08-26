# @lilo-moon/views

## 0.1.0

### Minor Changes

- [#92](https://github.com/littleorgans/lilo-moon-template/pull/92) [`7ecf330`](https://github.com/littleorgans/lilo-moon-template/commit/7ecf330079b92ac06774612c71cd4fe06cea70ae) Thanks [@srobinson](https://github.com/srobinson)! - Add the theme preference model and the switcher surfaces. `@lilo-moon/theme` gains the
  cookie-borne `ThemePreference` (parse, serialize, apply-one-field), `THEME_NAMES`, and the
  exported default theme name. The generated stylesheet and the Tailwind dark variant now key
  dark on `data-mode="dark"` instead of the `.dark` class, so applications stamp `<html>` with
  data attributes only. `@lilo-moon/views` gains `ThemeSwitcher`, a no-JavaScript form of
  submit buttons, and `ThemeLab`, the page that renders every component and color token under
  the live preference.

### Patch Changes

- Updated dependencies [[`53a8bcf`](https://github.com/littleorgans/lilo-moon-template/commit/53a8bcf78ff9d59232655c6d9c282a567dbb4f30), [`7ecf330`](https://github.com/littleorgans/lilo-moon-template/commit/7ecf330079b92ac06774612c71cd4fe06cea70ae)]:
  - @lilo-moon/auth@0.1.0
  - @lilo-moon/theme@0.1.0
  - @lilo-moon/ui@0.1.0
