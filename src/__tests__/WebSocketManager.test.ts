import { Server } from 'http'
import { WebSocketServer } from 'ws'
import { WebSocketManager } from '../WebSocketManager'
import type { MessagesDataItem } from '../types'

global.setInterval = jest.fn()
global.clearInterval = jest.fn()

console.log = jest.fn()
console.error = jest.fn()

// Mock WebSocketServer
jest.mock('ws', () => {
  const mockWebSocket = {
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    terminate: jest.fn(),
    readyState: 1, // OPEN
  }

  const mockWebSocketServer = {
    on: jest.fn(),
    close: jest.fn(),
    clients: new Set(),
  }

  const webSocketFn = jest.fn(() => mockWebSocket)

  // @ts-ignore
  webSocketFn.OPEN = 1
  // @ts-ignore
  webSocketFn.CLOSE = 3

  return {
    WebSocket: webSocketFn,
    WebSocketServer: jest.fn(() => mockWebSocketServer),
  }
})

// Mock HTTP server
const mockServer = {
  close: jest.fn(),
} as unknown as Server

describe('WebSocketManager', () => {
  let wsManager: WebSocketManager
  let mockOnSendToOrchestrator: jest.Mock
  let connectionCallback: any
  let mockWebSocketServer: any
  let mockWebSocket: any
  let mockSetInterval: jest.SpyInstance
  let mockClearInterval: jest.SpyInstance
  let messageCallback: any

  beforeEach(() => {
    jest.useFakeTimers()
    mockOnSendToOrchestrator = jest.fn()
    mockWebSocketServer = {
      on: jest.fn((event: string, callback: any) => {
        if (event === 'connection') {
          connectionCallback = callback
        } else if (event === 'error') {
        }
        return mockWebSocketServer
      }),
      close: jest.fn(),
    } as any
    mockWebSocket = {
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      readyState: 1, // OPEN
      on: jest.fn((event: string, callback: any) => {
        if (event === 'message') {
          messageCallback = callback
        } else if (event === 'close') {
        } else if (event === 'error') {
        }
        return mockWebSocket
      }),
    } as any

    // Reset mocks
    jest.clearAllMocks()
    ;(WebSocketServer as any as jest.Mock).mockReturnValue(mockWebSocketServer)

    mockSetInterval = jest.spyOn(global, 'setInterval')
    mockClearInterval = jest.spyOn(global, 'clearInterval')

    wsManager = new WebSocketManager(mockServer, mockOnSendToOrchestrator)
  })

  afterEach(() => {
    if (wsManager) {
      wsManager.close()
    }
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    mockSetInterval.mockRestore()
    mockClearInterval.mockRestore()
  })

  describe('constructor', () => {
    it('应该初始化WebSocketServer并监听相关事件', () => {
      expect(WebSocketServer).toHaveBeenCalledWith({ server: mockServer })
      expect(mockWebSocketServer.on).toHaveBeenCalledWith(
        'connection',
        expect.any(Function)
      )
      expect(mockWebSocketServer.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      )
    })
  })

  describe('保持连接', () => {
    it('应该保持单个连接', () => {
      // Trigger connection
      connectionCallback(mockWebSocket)

      // Should add client to clients map
      const clients = wsManager.getConnectedClients()
      expect(clients).toHaveLength(1)
      expect(clients[0].id).toMatch(/^client_\d+_/)
    })

    it('应该保持多个连接', () => {
      const mockWs1 = { ...mockWebSocket, on: jest.fn() }
      const mockWs2 = { ...mockWebSocket, on: jest.fn() }

      connectionCallback(mockWs1)
      connectionCallback(mockWs2)

      const clients = wsManager.getConnectedClients()
      expect(clients).toHaveLength(2)
      expect(clients[0].id).not.toBe(clients[1].id)
    })
  })

  describe('消息处理', () => {
    beforeEach(() => {
      connectionCallback(mockWebSocket)
    })

    it('应该处理消息', () => {
      const testMessage = JSON.stringify({ type: 'test', data: 'hello' })

      messageCallback(Buffer.from(testMessage))

      expect(mockOnSendToOrchestrator).toHaveBeenCalledWith(
        JSON.parse(testMessage)
      )
    })

    it('应该处理心跳消息', () => {
      const consoleLogSpy = jest.spyOn(console, 'log')

      messageCallback(Buffer.from('heartbeat'))

      expect(mockOnSendToOrchestrator).not.toHaveBeenCalled()
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('heartbeat')
      )
      consoleLogSpy.mockRestore()
    })

    it('应该在非JSON消息时报错', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error')

      messageCallback(Buffer.from('invalid json'))

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Error)
      )
      consoleErrorSpy.mockRestore()
    })
  })

  describe('广播', () => {
    let mockWs1: any
    let mockWs2: any
    let mockWs3: any

    beforeEach(() => {
      mockWs1 = {
        ...mockWebSocket,
        readyState: WebSocket.OPEN,
        send: jest.fn(),
      }
      mockWs2 = {
        ...mockWebSocket,
        readyState: WebSocket.OPEN,
        send: jest.fn(),
      }
      mockWs3 = {
        ...mockWebSocket,
        readyState: WebSocket.CLOSED,
        send: jest.fn(),
      }

      connectionCallback(mockWs1)
      connectionCallback(mockWs2)
      connectionCallback(mockWs3)
    })

    it('应该给所有打开的连接广播', () => {
      const message = {
        id: '1',
        type: 'broadcast',
        data: { type: 'text' as const },
        timestamp: '',
      }
      wsManager.broadcast(message)

      expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify(message))
      expect(mockWs2.send).toHaveBeenCalledWith(JSON.stringify(message))
      expect(mockWs3.send).not.toHaveBeenCalled() // Closed connection
    })
  })

  describe('receiveData', () => {
    it('应该在收到消息后执行广播', () => {
      const broadcastSpy = jest.spyOn(wsManager, 'broadcast')
      const messageData: MessagesDataItem = { content: 'test data' } as any

      const result = wsManager.receiveData(messageData)

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^msg_\d+_/),
          data: messageData,
          timestamp: expect.any(String),
        })
      )
      expect(result).toBe(false)
    })
  })

  describe('心跳和连接检测', () => {
    it('应该会执行心跳', () => {
      jest.runOnlyPendingTimers()
      expect(mockSetInterval).toHaveBeenCalledWith(
        expect.any(Function),
        wsManager['HEARTBEAT_INTERVAL']
      )
    })

    it('应该断开已关闭的连接', () => {
      const mockWs = {
        ...mockWebSocket,
        readyState: 3, // CLOSED
        send: jest.fn(),
      }
      connectionCallback(mockWs)

      const consoleLogSpy = jest.spyOn(console, 'log')

      jest.advanceTimersByTime(40000)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removing closed connection')
      )

      consoleLogSpy.mockRestore()
    })

    it('应该在超时后断开连接', () => {
      const mockWs = {
        ...mockWebSocket,
        readyState: 1,
        terminate: jest.fn(),
        send: jest.fn(),
      }
      connectionCallback(mockWs)

      const consoleLogSpy = jest.spyOn(console, 'log')

      jest.advanceTimersByTime(130000)

      expect(mockWs.terminate).toHaveBeenCalled()
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('timeout, disconnecting')
      )

      consoleLogSpy.mockRestore()
    })
  })

  describe('关闭', () => {
    it('应该关闭所有连接并清理定时器', () => {
      const mockWs1 = { ...mockWebSocket, close: jest.fn() }
      const mockWs2 = { ...mockWebSocket, close: jest.fn() }

      connectionCallback(mockWs1)
      connectionCallback(mockWs2)

      wsManager.close()

      expect(mockClearInterval).toHaveBeenCalled()
      expect(mockWs1.close).toHaveBeenCalled()
      expect(mockWs2.close).toHaveBeenCalled()
      expect(mockWebSocketServer.close).toHaveBeenCalled()
    })

    it('在没有连接时关闭应该不会报错', () => {
      expect(() => {
        wsManager.close()
      }).not.toThrow()
    })
  })
})
