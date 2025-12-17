import packages from '../package.json'
import type { PluginMetadata } from './types'

export const pluginMetadata: PluginMetadata = {
  plugin_name: 'humanoid_server',
  version: packages.version,
  capabilities: [],
  methods: [],
  events: [],
  transportUrl: 'http://localhost:9100',
}
