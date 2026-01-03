import express from 'express'
import { createServer } from 'http'
import cors from 'cors'
import helmet from 'helmet'
import axios from 'axios'
import { WebSocketManager } from './WebSocketManager'
import { pluginMetadata } from './constants'
import type { Express, Request, Response } from 'express'

const HEARTBEAT_INTERVAL = 30000
axios.defaults.timeout = 30000

export function createHumanoidServer(orchestratorUrl: string): {
  close: () => void
  listen: ReturnType<typeof createServer>['listen']
} {
  const app: Express = express()
  const server = createServer(app)
  let isRegistered = false
  let heartbeatInterval: NodeJS.Timeout | null = null
  let lastHeartbeatTime: Date = new Date()

  // 中间件
  app.use(helmet())
  app.use(cors())
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // 创建WebSocket管理器
  const wsManager = new WebSocketManager(server, (data) => {
    return new Promise((resolve) => {
      axios({
        method: 'post',
        url: orchestratorUrl,
        data: {
          type: 'publish',
          to_plugin: 'cognitive_core',
          message: data,
        },
      })
        .then(() => void resolve(true))
        .catch((err) => {
          console.log(err)
          resolve(false)
        })
    })
  })

  // 健康检查端点
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      connectedClients: wsManager.getConnectedClients().length,
    })
  })

  // 获取连接的客户端列表
  app.get('/api/clients', (_req: Request, res: Response) => {
    res.json({
      success: true,
      clients: wsManager.getConnectedClients(),
    })
  })

  // 接收orchestrator的消息
  app.post('/webhook/orchestrator', async (req: Request, res: Response) => {
    try {
      if (typeof req.body === 'object' && req.body.cmd === 'registered') {
        isRegistered = true

        res.json({
          success: true,
          message: 'ok',
        })
        return
      }

      const success = wsManager.receiveData(req.body, 'humanoid')

      if (success) {
        res.json({
          success: true,
          message: 'ok',
        })
      } else {
        res.json({
          success: false,
          error: `Error or not connected`,
        })
      }
    } catch (error) {
      console.error('Error sending message:', error)
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  // 404处理
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
    })
  })

  // 错误处理中间件
  app.use((error: Error, _req: Request, res: Response) => {
    console.error('Server error:', error)
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    })
  })

  const close = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
    }

    wsManager.close()
    server.close(() => {
      console.log('Server closed')
      process.exit(0)
    })
  }

  // 优雅关闭
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...')
    close()
  })

  process.on('SIGINT', () => {
    console.log('SIGINT received. Closing server...')
    close()
  })

  const runHeartbeat = () => {
    heartbeatInterval = setTimeout(async () => {
      try {
        /** 超过3次没心跳响应时间，断开连接 */
        if (
          isRegistered &&
          new Date().getTime() - lastHeartbeatTime.getTime() >
            HEARTBEAT_INTERVAL * 3
        ) {
          isRegistered = false
        }

        if (isRegistered) {
          await axios({
            method: 'post',
            url: orchestratorUrl,
            data: {
              type: 'heartbeat',
              plugin_name: pluginMetadata.plugin_name,
            },
          })

          lastHeartbeatTime = new Date()
        } else {
          await axios({
            method: 'post',
            url: orchestratorUrl,
            data: {
              type: 'register',
              ...pluginMetadata,
            },
          })
        }
      } catch (e) {
        console.error(e)
      } finally {
        runHeartbeat()
      }
    }, HEARTBEAT_INTERVAL)
  }

  return {
    listen(...args) {
      if (heartbeatInterval) {
        clearTimeout(heartbeatInterval)
      }

      runHeartbeat()

      return server.listen(...(args as any))
    },
    close,
  }
}
