import { spawn } from 'child_process';
import path from 'path';
import { describe, expect, test } from '@jest/globals';

const SERVER_PATH = path.join(__dirname, '..', '..', 'tools', 'kotor-vr-mcp', 'server.js');

describe('KotOR-VR MCP Server', () => {
  test('handles initialize and tools/list via JSON-RPC stdio', async () => {
    const proc = spawn(process.execPath, [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses: any[] = [];
    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l: string) => l.trim().length > 0);
      for (const line of lines) {
        try {
          responses.push(JSON.parse(line));
        } catch {
          // ignore non-json log lines
        }
      }
    });

    // 1. Send initialize
    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test-client' } },
    }) + '\n';
    proc.stdin.write(initReq);

    // 2. Send tools/list
    const listReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }) + '\n';
    proc.stdin.write(listReq);

    // Wait for responses
    await new Promise((resolve) => setTimeout(resolve, 800));
    proc.kill();

    expect(responses.length).toBeGreaterThanOrEqual(2);

    // Verify initialize response
    const initRes = responses.find((r) => r.id === 1);
    expect(initRes).toBeDefined();
    expect(initRes.result.serverInfo.name).toBe('kotor-vr-mcp');
    expect(initRes.result.capabilities.tools).toBeDefined();

    // Verify tools/list response
    const listRes = responses.find((r) => r.id === 2);
    expect(listRes).toBeDefined();
    const toolNames = listRes.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('vr_get_engine_state');
    expect(toolNames).toContain('vr_inspect_interaction_targets');
    expect(toolNames).toContain('vr_simulate_input');
    expect(toolNames).toContain('vr_toggle_debug_gizmos');
    expect(toolNames).toContain('vr_record_trace');
    expect(toolNames).toContain('vr_replay_trace');
    expect(toolNames).toContain('vr_capture_screenshot');
  });

  test('reports clean error on tools/call when session is not connected', async () => {
    const proc = spawn(process.execPath, [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses: any[] = [];
    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l: string) => l.trim().length > 0);
      for (const line of lines) {
        try {
          responses.push(JSON.parse(line));
        } catch {}
      }
    });

    const callReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'vr_get_engine_state', arguments: {} },
    }) + '\n';
    proc.stdin.write(callReq);

    const start = Date.now();
    while (Date.now() - start < 4500 && !responses.some((r) => r.id === 10)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    proc.kill();

    const callRes = responses.find((r) => r.id === 10);
    expect(callRes).toBeDefined();
    expect(callRes.isError).toBe(true);
    expect(callRes.result.content[0].text).toContain('Could not connect to KotOR VR session');
  });
});
