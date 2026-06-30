import { beforeAll } from "vitest"

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-for-vitest-at-least-32-chars"
})
