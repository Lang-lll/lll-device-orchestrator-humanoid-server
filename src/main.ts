import { createHumanoidServer } from './createHumanoidServer'

function main() {
  const server = createHumanoidServer('http://localhost:3000/webhook')
  try {
    // 启动服务器
    server.listen(9100, () => {
      console.log(`启动HumanoidServer`)
    })
  } catch (e) {
    console.error(e)
  }
}

main()
