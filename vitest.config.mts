import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  // server-only يمنع الاستيراد من المتصفح؛ في الاختبارات يُستبدل بوحدة فارغة
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'tests/server-only-stub.ts') } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, fileParallelism: false },
});
