import { WebSocket, WebSocketServer } from 'ws'
import type { Server as HTTPServer } from 'http'
import type { MessagesDataItem, WebSocketClient, MessageClient } from './types'

export class WebSocketManager {
  private wss: WebSocketServer
  private clients: Map<string, WebSocketClient>
  private onSendToOrchestrator?: (data: any) => Promise<boolean>
  private heartbeatInterval: NodeJS.Timeout | null = null
  private readonly HEARTBEAT_INTERVAL = 40000 // 40秒心跳检查间隔
  private readonly CONNECTION_TIMEOUT = 80000 // 80秒无响应断开

  constructor(
    server: HTTPServer,
    onSendToOrchestrator?: (data: any) => Promise<boolean>
  ) {
    this.wss = new WebSocketServer({ server })
    this.clients = new Map()
    this.onSendToOrchestrator = onSendToOrchestrator
    this.initialize()
    this.startHeartbeat()
  }

  private initialize(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const nowDate = new Date()
      const clientId = this.generateClientId()
      const client: WebSocketClient = {
        id: clientId,
        ws,
        connectedAt: nowDate,
        lastHeartbeat: nowDate,
      }

      this.clients.set(clientId, client)

      console.log(`Client ${clientId} connected`)

      // 处理消息
      ws.on('message', async (data: Buffer) => {
        try {
          if (this.clients.has(clientId)) {
            this.clients.get(clientId)!.lastHeartbeat = new Date()
          }

          const message = data.toString()
          console.log(`Received from ${clientId}:`, message)

          if (this.isHeartbeatMessage(message)) {
            console.log(`Received heartbeat from ${clientId}`)
            return
          }

          if (!this.onSendToOrchestrator) {
            return
          }

          // 解析消息
          let parsedData = JSON.parse(message)

          // 转发到外部服务
          const success = await this.onSendToOrchestrator(parsedData)

          if (success) {
            this.receiveData(parsedData, 'pilot')
          }
        } catch (error) {
          console.error('Error processing message:', error)
        }
      })

      // 处理断开连接
      ws.on('close', () => {
        console.log(`Client ${clientId} disconnected`)
        this.clients.delete(clientId)
      })

      // 错误处理
      ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error)
      })
    })

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error)
    })
  }

  // 启动心跳检测
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.checkConnections()
      this.sendHeartbeat()
    }, this.HEARTBEAT_INTERVAL)
  }

  public broadcast(message: MessageClient): void {
    const messageStr = JSON.stringify(message)

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr)
      }
    })
  }

  // 从HTTP接口接收消息
  public receiveData(
    message: MessagesDataItem,
    source: 'pilot' | 'humanoid'
  ): boolean {
    const webSocketMessage: MessageClient = {
      id: this.generateMessageId(),
      type: message.type,
      data: message,
      timestamp: new Date().toISOString(),
      source,
    }

    this.broadcast(webSocketMessage)

    return false
  }

  // 获取所有连接的客户端
  public getConnectedClients(): Array<{ id: string; connectedAt: Date }> {
    return Array.from(this.clients.values()).map(({ id, connectedAt }) => ({
      id,
      connectedAt,
    }))
  }

  private checkConnections(): void {
    const now = new Date()

    this.clients.forEach((client, clientId) => {
      const timeSinceLastActivity =
        now.getTime() - client.lastHeartbeat.getTime()

      // 如果连接已经关闭，移除
      if (client.ws.readyState !== WebSocket.OPEN) {
        console.log(`Removing closed connection: ${clientId}`)
        this.clients.delete(clientId)
        return
      }

      // 超过超时时间直接断开
      if (timeSinceLastActivity > this.CONNECTION_TIMEOUT) {
        console.log(`Client ${clientId} timeout, disconnecting`)
        client.ws.terminate()
        this.clients.delete(clientId)
      }
    })
  }

  private sendHeartbeat(): void {
    this.clients.forEach((client, clientId) => {
      client.ws.send('heartbeat', (err) => {
        if (err) {
          this.clients.delete(clientId)

          console.log(`Client ${clientId} heartbeat error`, err)
        }
      })
    })
  }

  // 生成客户端ID
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // 生成消息ID
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  // 检查心跳消息
  private isHeartbeatMessage(message: string): boolean {
    return message === 'heartbeat'
  }

  // 关闭所有连接
  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close()
      }
    })
    this.clients.clear()
    this.wss.close()
  }
}
