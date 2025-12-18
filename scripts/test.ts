import { createJestConfig, runJest } from '@l-comedy/jest-preset'

function test() {
  const { unit } = createJestConfig()

  runJest(unit)
}

test()
