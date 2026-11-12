export default {
  extends: [
    'stylelint-config-standard',
    'stylelint-config-standard-scss',
    'stylelint-config-recess-order',
    'stylelint-prettier/recommended',
  ],
  rules: {
    'selector-class-pattern': [
      '^([a-z][a-z0-9]*)(-[a-z0-9]+)*$|^[a-z][a-zA-Z0-9]+$',
      {
        message: 'Expected class selector to be kebab-case or camelCase',
      },
    ],
    'at-rule-no-unknown': null,
    'scss/at-rule-no-unknown': [
      true,
      {
        // `theme` 是 Tailwind v4 的 CSS-first 配置入口（断点对齐），
        // 见 src/styles/index.scss。
        ignoreAtRules: ['tailwind', 'apply', 'variants', 'responsive', 'screen', 'layer', 'theme'],
      },
    ],
    'number-max-precision': 6,
    'function-no-unknown': [
      true,
      {
        ignoreFunctions: ['theme'],
      },
    ],
    'import-notation': 'string',
    'no-descending-specificity': null,
    'selector-pseudo-class-no-unknown': [
      true,
      {
        ignorePseudoClasses: ['global', 'local'],
      },
    ],
  },
  ignoreFiles: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
};
