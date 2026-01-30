import { defineConfig } from 'tsdown'

export default defineConfig({
  exports: true,
  define: {
    // Disable benchmarking instrumentation in production builds
    '__BENCHMARK__': 'false',
  },
})
