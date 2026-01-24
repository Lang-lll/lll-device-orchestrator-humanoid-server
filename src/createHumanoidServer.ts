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

  // TODO: 断连
  const sendMessageToOrchestrator = (
    message: any,
    options?: { onSuccess?: () => void; onError?: (e: any) => void },
  ) => {
    const { onSuccess, onError } = options || {}
    axios({
      method: 'post',
      url: orchestratorUrl,
      data: {
        type: 'publish',
        to_plugin: ['cognitive_core'],
        message,
      },
    })
      .then(() => void onSuccess?.())
      .catch((err) => {
        console.log(err)
        onError?.(err)
      })
  }

  // 创建WebSocket管理器
  const wsManager = new WebSocketManager(server, (data) => {
    return new Promise((resolve) => {
      sendMessageToOrchestrator(data, {
        onSuccess() {
          resolve(true)
        },
        onError() {
          resolve(false)
        },
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
      if (typeof req.body === 'object' && req.body.type === 'registered') {
        isRegistered = true

        res.json({
          success: true,
          message: 'ok',
        })

        // 首次连接更新状态
        sendMessageToOrchestrator({
          type: 'publish_status',
        })
        console.log('接收到注册消息', req.body)
        return
      } else if (
        typeof req.body === 'object' &&
        req.body.type === 'heartbeat'
      ) {
        lastHeartbeatTime = new Date()

        res.json({
          success: true,
          message: 'ok',
        })
        console.log('接收到心跳消息', req.body)
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

  const pluginCheck = async () => {
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
        console.log('发送Orchestrator心跳消息')
        await axios({
          method: 'post',
          url: orchestratorUrl,
          data: {
            type: 'heartbeat',
            plugin_name: pluginMetadata.plugin_name,
          },
        })
      } else {
        console.log('发送Orchestrator注册消息')
        await axios({
          method: 'post',
          url: orchestratorUrl,
          data: {
            type: 'register',
            message: pluginMetadata,
          },
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      runHeartbeat()
    }
  }

  const runHeartbeat = () => {
    heartbeatInterval = setTimeout(pluginCheck, HEARTBEAT_INTERVAL)
  }

  return {
    listen(...args) {
      if (heartbeatInterval) {
        clearTimeout(heartbeatInterval)
      }

      setTimeout(() => {
        pluginCheck()
      })

      return server.listen(...(args as any))
    },
    close,
  }
}
