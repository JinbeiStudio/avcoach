const js = require('@eslint/js');

module.exports = [
  { ignores: ['node_modules/**', 'static/**'] },

  // Fichiers Node.js (serveur, scripts, tests)
  {
    files: ['server.js', 'build-static.js', 'database/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'readonly', exports: 'readonly',
        __dirname: 'readonly', __filename: 'readonly',
        process: 'readonly', console: 'readonly',
        setTimeout: 'readonly', Buffer: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
    }
  },

  // Fichiers navigateur (public/js/)
  {
    files: ['public/js/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        fetch: 'readonly', alert: 'readonly', confirm: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        IntersectionObserver: 'readonly', FileReader: 'readonly',
        // Globaux définis dans d'autres scripts chargés sur la même page
        Auth: 'readonly', Editor: 'readonly',
        setEditButtonText: 'readonly', toggleEdit: 'readonly',
        logout: 'readonly', toggleMenu: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
    }
  },

  // Tests Jest
  {
    files: ['tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'readonly', process: 'readonly',
        __dirname: 'readonly', console: 'readonly',
        describe: 'readonly', test: 'readonly', expect: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly', jest: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
    }
  }
];
