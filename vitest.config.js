import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.js'],
    environment: 'jsdom', // the modules touch localStorage lazily; jsdom gives them a harmless one
  },
});
