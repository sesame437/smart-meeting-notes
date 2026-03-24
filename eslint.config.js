const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        test: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        document: "readonly"
      }
    },
    rules: {
      "no-console": "error",
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "no-process-exit": "off"
    }
  },
  {
    ignores: ["node_modules/**", "public/**", "coverage/**"]
  }
];
