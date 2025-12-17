import { WebSocket } from 'ws'

export interface WebSocketClient {
  id: string
  ws: WebSocket
  connectedAt: Date
  lastHeartbeat: Date
}

export interface MessagesDataItem {
  type: 'tts' | 'text' | 'motor' | 'wait'
  data?: string
  action_id?: string
  action_data?: any
  duration?: number
}

export interface MessageClient {
  id: string
  data: MessagesDataItem
  timestamp: string
}

export interface PluginMetadata {
  plugin_name: string
  version: string
  transportUrl?: string
  capabilities: string[]
  methods: PluginMethod[]
  events: string[]
}
